export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const TYPE_LABEL = { homework: '作业', exam: '考试', node: '活动节点', todo: '待办' };
export const STATUS_LABEL = { notstarted: '未开始', doing: '进行中', ready: '待提交', submitted: '已提交', done: '已完成', cancelled: '已取消' };
export const PHASE_LABEL = { preparing: '准备中', ongoing: '进行中', ended: '已结束', cancelled: '已取消' };
export const ACT_TYPE_LABEL = { lecture: '讲座', contest: '比赛', club: '社团活动', other: '其他' };
export const CAT_LABEL = { courseware: '课件', reference: '参考资料', other: '其他', poster: '海报/通知', signup: '报名凭证', checkin: '签到照片', checkout: '签退照片', work: '作品/成果', cert: '证书' };
export const SLOT_STATUS_LABEL = { pending: '待执行', done: '已完成', skipped: '已跳过', obsolete: '不再需要' };
export const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const WD_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtBytes(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' MB';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + ' KB';
  return n + ' B';
}
export function fmtDateCN(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${m}月${d}日`;
}
export function fmtDateFull(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日 · ${wd}`;
}
export function weekdayCN(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
export function addDaysStr(dateStr, n) {
  return new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
export function dayDiff(a, b) {
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
export function fmtDateTime(dt) { // ISO/local 'YYYY-MM-DDTHH:MM'
  if (!dt) return '时间待定';
  const [d, t] = dt.split('T');
  return `${fmtDateCN(d)}${t ? ' ' + t.slice(0, 5) : ''}`;
}
export function relTime(iso, nowMs) {
  const diff = nowMs - Date.parse(iso);
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return Math.floor(diff / 60_000) + ' 分钟前';
  if (diff < 86400_000) return Math.floor(diff / 3600_000) + ' 小时前';
  if (diff < 30 * 86400_000) return Math.floor(diff / 86400_000) + ' 天前';
  return iso.slice(0, 10);
}

// 截止徽标：{text, cls} —— 文字与颜色同时表达紧急程度
export function dueBadge(task, now) {
  if (!task.due || !task.due.date) return null;
  const { date, time, dateOnly } = task.due;
  const today = now.date;
  const diff = dayDiff(date, today);
  const isExam = task.type === 'exam';
  const verb = isExam ? '考试' : '截止';
  let overdue;
  if (dateOnly) overdue = diff < 0;
  else overdue = diff < 0 || (diff === 0 && now.time > (time || '23:59'));
  const dateOnlyTag = dateOnly ? '仅日期 · ' : '';
  if (overdue) {
    return { text: isExam ? '考试时间已过' : `${dateOnlyTag}已逾期`, cls: 'over', overdue: true };
  }
  const timePart = dateOnly ? '' : ' ' + time;
  if (diff === 0) return { text: `${dateOnlyTag}今天${timePart} ${verb}`, cls: 'soon', soon: true };
  if (diff === 1) return { text: `${dateOnlyTag}明天${timePart} ${verb}`, cls: 'soon', soon: true };
  if (diff <= 3) return { text: `${dateOnlyTag}${fmtDateCN(date)}${timePart} ${verb}`, cls: 'soon', soon: true };
  return { text: `${dateOnlyTag}${fmtDateCN(date)}${timePart} ${verb}`, cls: 'normal' };
}

export function countdownText(task, now) {
  if (!task.due?.date) return '';
  const diff = dayDiff(task.due.date, now.date);
  if (task.due.dateOnly) {
    if (diff < 0) return `逾期 ${-diff} 天`;
    if (diff === 0) return '今天内';
    return `剩 ${diff} 天`;
  }
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff === 0) {
    const [h1, m1] = now.time.split(':').map(Number);
    const [h2, m2] = (task.due.time || '23:59').split(':').map(Number);
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    if (mins <= 0) return '已过时刻';
    if (mins < 60) return `剩 ${mins} 分钟`;
    return `剩 ${Math.floor(mins / 60)} 小时`;
  }
  return `剩 ${diff} 天`;
}

export const isEnded = t => ['submitted', 'done', 'cancelled'].includes(t.status);
export const isOverdue = (t, now) => {
  if (!t.due?.date || isEnded(t)) return false;
  const diff = dayDiff(t.due.date, now.date);
  if (t.due.dateOnly) return diff < 0;
  return diff < 0 || (diff === 0 && now.time > (t.due.time || '23:59'));
};

export function fileKind(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'img';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}
export function fileExt(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ext.length <= 4 ? ext : 'file';
}
export const canPreview = (name) => ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'].includes((name.split('.').pop() || '').toLowerCase());

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}