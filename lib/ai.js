// AI 辅助通知录入 —— 本地规则识别引擎。
// 仅处理用户本次粘贴的文字；结果为草稿，须人工确认后才写入正式任务。
import { dayDiff, weekdayOf, addDays } from './store.js';

const TASK_WORDS = /作业|报告|论文|提交|上交|考试|测验|报名|签到|签退|讲座|比赛|竞赛|实验|预习|复习|阅读|完成|填写|上传|截止|汇报|展示|答辩|材料|作品|还书|归还|借书|领取|办理|缴费|注册|参加|出席|会议|值班|记得|务必/;
const AMBIGUOUS = /下课前|下课后|课上|课后|尽快|另行通知|时间待定|待定/;

function splitSegments(text) {
  const lines = text.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    const parts = line.split(/(?=(?:\d{1,2}[.、．)]|[①②③④⑤⑥⑦⑧⑨⑩])\s*)/).map(s => s.trim()).filter(Boolean);
    if (parts.length > 1) out.push(...parts);
    else out.push(line);
  }
  return out;
}

function findDates(seg, baseDate) {
  const found = [];
  let m;
  const reFull = /(\d{4})\s*[年/\-.]\s*(\d{1,2})\s*[月/\-.]\s*(\d{1,2})\s*[日号]?/g;
  while ((m = reFull.exec(seg))) {
    found.push({ date: `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`, text: m[0], basis: 'explicit' });
  }
  const reMD = /(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g;
  while ((m = reMD.exec(seg))) {
    const date = `${baseDate.slice(0, 4)}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
    if (!found.some(f => f.text.includes(m[0]))) found.push({ date, text: m[0], basis: 'interpreted', note: '原文未写年份，按基准日期所在年份解释' });
  }
  const reWeek = /(下|本|这)?\s*(?:周|星期)\s*([一二三四五六日天])/g;
  while ((m = reWeek.exec(seg))) {
    const map = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };
    const target = map[m[2]];
    const baseW = weekdayOf(baseDate);
    let delta = (target - baseW + 7) % 7;
    if (m[1] === '下') delta += 7 - (baseW === 0 ? 0 : 0); // 下周：下一自然周
    if (m[1] === '下') {
      const mondayThis = addDays(baseDate, -((baseW + 6) % 7));
      const date = addDays(mondayThis, 7 + ((target + 6) % 7));
      found.push({ date, text: m[0], basis: 'interpreted', note: '相对日期，按通知基准日期解释' });
      continue;
    }
    if (!m[1] && delta === 0) delta = 7;
    found.push({ date: addDays(baseDate, delta), text: m[0], basis: 'interpreted', note: '相对日期，按通知基准日期解释' });
  }
  const relMap = { 今天: 0, 今日: 0, 今晚: 0, 明天: 1, 明日: 1, 后天: 2 };
  for (const [w, n] of Object.entries(relMap)) {
    if (seg.includes(w)) found.push({ date: addDays(baseDate, n), text: w, basis: 'interpreted', note: '相对日期，按通知基准日期解释' });
  }
  const reNDays = /(\d{1,2})\s*天(?:后|之内|内)/g;
  while ((m = reNDays.exec(seg))) {
    found.push({ date: addDays(baseDate, +m[1]), text: m[0], basis: 'interpreted', note: '相对日期，按通知基准日期解释' });
  }
  // 去重（同一日期保留依据最强的一条）
  const uniq = [];
  for (const f of found) {
    const ex = uniq.find(u => u.date === f.date);
    if (!ex) uniq.push(f);
    else if (ex.basis !== 'explicit' && f.basis === 'explicit') Object.assign(ex, f);
  }
  return uniq;
}

function findTime(seg) {
  let m = seg.match(/(晚上|下午|中午|上午|早上|凌晨)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (m) return applyPeriod(m[2] + ':' + m[3], m[1], m[0]);
  m = seg.match(/(晚上|下午|中午|上午|早上|凌晨)?\s*(\d{1,2})\s*点\s*(半|\d{1,2}分?)?/);
  if (m) {
    const min = m[3] === '半' ? '30' : m[3] ? String(parseInt(m[3])).padStart(2, '0') : '00';
    return applyPeriod(`${m[2]}:${min}`, m[1], m[0]);
  }
  m = seg.match(/(晚上|下午|中午)\s*(\d{1,2})\s*[时点]/);
  if (m) return applyPeriod(`${m[2]}:00`, m[1], m[0]);
  return null;
}
function applyPeriod(hm, period, text) {
  let [h, mi] = hm.split(':').map(Number);
  if ((period === '下午' || period === '晚上') && h < 12) h += 12;
  if (period === '中午' && h < 11) h += 12;
  if (h > 23 || mi > 59) return null;
  return { time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, text: text.trim() };
}

function detectType(seg) {
  if (/考试|测验|期中|期末|闭卷|开卷/.test(seg)) return 'exam';
  if (/报名|签到|签退|初赛|复赛|决赛|讲座|比赛|竞赛/.test(seg)) return 'node';
  if (/作业|报告|论文|习题|实验|读书|阅读|预习|复习/.test(seg)) return 'homework';
  return 'todo';
}

function cleanTitle(seg) {
  let t = seg.replace(/^(?:\d{1,2}[.、．)]|[①②③④⑤⑥⑦⑧⑨⑩]|[-•·])\s*/, '');
  t = t.replace(/(?:请|务必|记得|需要|要求)?(?:大家|同学们|各位)?/g, '');
  t = t.split(/[。；;]/)[0];
  t = t.replace(/(\d{4})\s*[年/\-.]\s*\d{1,2}\s*[月/\-.]\s*\d{1,2}\s*[日号]?/, '');
  t = t.replace(/\d{1,2}\s*月\s*\d{1,2}\s*[日号]?/, '');
  t = t.replace(/(下|本|这)?\s*(?:周|星期)\s*[一二三四五六日天]/, '');
  t = t.replace(/(?:今天|今晚|明天|明日|后天)(?:之内|内)?|\d{1,2}\s*天(?:后|之内|内)/, '');
  t = t.replace(/(晚上|下午|中午|上午|早上)?\s*\d{1,2}\s*[:：点]\s*(\d{2}|半)?\s*(分|之前|前|截止)?/g, '');
  t = t.replace(/截止|之前|前提交|提交至.*$|发送到.*$|上传到.*$/g, '');
  t = t.replace(/^在[^，。；]{2,20}?(?:进行|举行|开展)/, '');
  t = t.replace(/[，,、：:（(].*$/, (s) => s.length > 24 ? '' : s);
  t = t.trim().replace(/^[，,、：:\s]+|[，,、：:\s于在至到]+$/g, '');
  if (!t) t = seg.slice(0, 40);
  return t.slice(0, 60);
}

export function extractNotice(text, baseDate, courses = []) {
  const segments = splitSegments(text.slice(0, 10000));
  const candidates = [];
  let idx = 0;
  for (const seg of segments) {
    if (!TASK_WORDS.test(seg)) continue;
    if (seg.length < 4) continue;
    const dates = findDates(seg, baseDate);
    const time = findTime(seg);
    const ambiguousHit = seg.match(AMBIGUOUS);
    const type = detectType(seg);
    const segCourses = courses.filter(c => seg.includes(c.name));
    const courseIds = (segCourses.length ? segCourses : courses.filter(c => text.includes(c.name))).map(c => c.id);
    const url = seg.match(/https?:\/\/[^\s，。；）)]+/);
    const submitHint = seg.match(/(?:提交至|提交到|发送到|上传到|发至|交至)[^\s，。；]{0,40}/);
    let due = null, dueBasis = 'missing', evidence = [], ambiguous = false, note = '';
    if (dates.length > 1 && new Set(dates.map(d => d.date)).size > 1) {
      ambiguous = true; note = '原文出现多个不同日期，请确认哪个是截止时间';
      due = { date: dates[0].date, time: time?.time || null, dateOnly: !time };
      dueBasis = 'ambiguous';
      evidence = dates.map(d => ({ text: d.text, kind: 'conflict' }));
    } else if (dates.length === 1) {
      const d = dates[0];
      due = { date: d.date, time: time?.time || null, dateOnly: !time };
      dueBasis = d.basis;
      evidence.push({ text: d.text, kind: d.basis, note: d.note || '' });
      if (time) evidence.push({ text: time.text, kind: 'explicit' });
      else note = '原文只给出日期，保留“仅日期”，不推断具体时刻';
      if (ambiguousHit) {
        ambiguous = true;
        evidence.push({ text: ambiguousHit[0], kind: 'ambiguous', note: '该时间表述缺少课程时间依据，请确认或暂不设 DDL' });
      }
    } else if (ambiguousHit) {
      ambiguous = true; dueBasis = 'ambiguous';
      evidence.push({ text: ambiguousHit[0], kind: 'ambiguous', note: '缺少可计算的时间依据，请确认或暂不设 DDL' });
    } else if (time) {
      evidence.push({ text: time.text, kind: 'explicit' });
      note = '只识别到时刻，未识别到日期，请补充';
      ambiguous = true; dueBasis = 'ambiguous';
    }
    const needsSubmit = type === 'homework' || /提交|上交|上传|发送/.test(seg);
    candidates.push({
      key: 'c' + (idx++),
      title: cleanTitle(seg),
      type,
      requirement: seg,
      courseIds: [...new Set(courseIds)],
      due, dueBasis, evidence, ambiguous, note,
      needsSubmit: type === 'exam' ? false : needsSubmit,
      sourceLink: url ? url[0] : '',
      submitHint: submitHint ? submitHint[0] : '',
    });
  }
  const needsBaseConfirm = candidates.some(c => c.evidence.some(e => e.kind === 'interpreted'));
  return { candidates, needsBaseConfirm, baseDate };
}