import { icon } from '../icons.js';
import { esc, fmtDateCN, fmtDateTime, weekdayCN, fmtBytes, isEnded, isOverdue, dayDiff, WD } from '../util.js';
import { S, now, course, activity, ownerLabel, unfinishedTasks, nearestDue, taskCategory, catPillHtml } from '../state.js';
import { taskRow, bindTaskRows, empty, toast } from '../ui.js';
import { openCourseForm, openActivityForm, openTaskForm, openTaskMenu, quickComplete } from '../forms.js';
import { openAI } from './ai.js';
import { setPlanAnchor } from './plan.js';

const CAT_COLORS = ['green', 'blue', 'peach', 'lilac'];
const ACT_BAND = { lecture: 'green', contest: 'peach', club: 'blue', other: 'lilac' };
const ACT_ICON = { lecture: 'mic', contest: 'award', club: 'users', other: 'flag' };
const ACT_EN = { lecture: 'LECTURE', contest: 'CONTEST', club: 'CLUB', other: 'EVENT' };

let termFilter = '';
let showArchived = false;

function greeting() {
  const h = +now().time.split(':')[0];
  if (h < 6) return '夜深了，早点休息，明天再继续。';
  if (h < 11) return '新的一天，按自己的节奏来。';
  if (h < 14) return '午后的时间，适合推进一小步。';
  if (h < 18) return '给学习，留一点从容。';
  return '晚上好，把今天收个尾吧。';
}

function recentDdl() {
  const n = now();
  const limit = dayDiff(n.date, n.date) + 7;
  const ts = S.tasks.filter(t => {
    if (isEnded(t) || !t.due?.date) return false;
    const diff = dayDiff(t.due.date, n.date);
    return diff <= 7; // 含所有逾期（diff<0）与今天起 7 天
  });
  ts.sort((a, b) => {
    const ao = isOverdue(a, n), bo = isOverdue(b, n);
    if (ao !== bo) return ao ? -1 : 1;
    return (a.due.date + (a.due.time || '23:59')).localeCompare(b.due.date + (b.due.time || '23:59'));
  });
  return ts;
}

export function areaFilters() { return { term: termFilter, archived: showArchived }; }
export function setAreaFilters(patch) {
  if ('term' in patch) termFilter = patch.term;
  if ('archived' in patch) showArchived = patch.archived;
}

export function courseCards() {
  let cs = S.courses.filter(c => showArchived ? true : !c.archived);
  if (termFilter) cs = cs.filter(c => c.term === termFilter);
  const currentTerm = '2026秋';
  cs.sort((a, b) => {
    const at = a.term === currentTerm ? 0 : 1, bt = b.term === currentTerm ? 0 : 1;
    if (at !== bt) return at - bt;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  if (!cs.length) {
    return empty('book', showArchived || termFilter ? '这个筛选下还没有课程' : '还没有课程',
      '一门课的作业和课件，值得放在一起管理。',
      `<button class="btn primary" id="home-add-course">${icon('plus', 15)} 新增课程</button>`);
  }
  return `<div class="card-grid three">` + cs.map((c, i) => {
    const un = unfinishedTasks('course', c.id).length;
    const nd = nearestDue('course', c.id);
    return `
    <div class="course-card" data-course="${c.id}">
      <div class="cc-top">
        <div class="cat-icon ${CAT_COLORS[i % 4]}">${icon('book')}</div>
        <span class="cc-chevron">${icon('chevR', 15)}</span>
      </div>
      <div class="cc-name">${esc(c.name)} ${c.archived ? '<span class="pill gray">已归档</span>' : ''}</div>
      <div class="cc-teacher">${c.teacher ? esc(c.teacher) : '教师未填写'}${c.term ? ' · ' + esc(c.term) : ''}</div>
      <div class="cc-foot">
        <span class="cc-count">${un} 项待完成</span><span class="spacer"></span>
        <span>${nd ? '最近 ' + fmtDateCN(nd.due.date) : '暂无截止'}</span>
      </div>
    </div>`;
  }).join('') + `
    <button class="add-card" id="home-add-course">${icon('plus', 22)}<span>新增课程</span></button>
  </div>`;
}

export function activityCards() {
  let as = S.activities.filter(a => showArchived ? true : !a.archived);
  const n = now();
  const group = a => {
    if (!a.start) return 1;
    return a.start.slice(0, 10) >= n.date ? 0 : 2;
  };
  as.sort((a, b) => {
    const ga = group(a), gb = group(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0) return (a.start || '').localeCompare(b.start || '');
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });
  if (!as.length) {
    return empty('flag', '还没有活动', '讲座、比赛、社团——凭证和节点都可以归档在这里。',
      `<button class="btn primary" id="home-add-act">${icon('plus', 15)} 新增活动</button>`);
  }
  return `<div class="card-grid">` + as.map(a => {
    const un = unfinishedTasks('activity', a.id).length;
    return `
    <div class="activity-card" data-activity="${a.id}">
      <div class="ac-band ${ACT_BAND[a.type] || 'lilac'}">
        ${icon(ACT_ICON[a.type] || 'flag', 33)}<span class="ac-type">${ACT_EN[a.type] || 'EVENT'}</span>
        <span class="ac-ring"></span>
      </div>
      <div class="ac-body">
        <div class="ac-name">${esc(a.name)} ${a.archived ? '<span class="pill gray">已归档</span>' : ''}</div>
        <div class="ac-meta">
          <span>${icon('clock', 10)} ${a.start ? fmtDateTime(a.start) : '时间待定'}${a.end ? ' — ' + fmtDateTime(a.end) : ''}</span>
          ${a.location ? `<span>${esc(a.location)}</span>` : ''}
        </div>
        <div class="ac-foot"><span class="cc-count" style="color:var(--green);font-weight:600">${un} 个未完成节点</span><span class="spacer"></span><span class="pill ${{ preparing: 'gray', ongoing: 'green', ended: 'blue', cancelled: 'red' }[a.phase]}">${{ preparing: '准备中', ongoing: '进行中', ended: '已结束', cancelled: '已取消' }[a.phase]}</span></div>
      </div>
    </div>`;
  }).join('') + `
    <button class="add-card" id="home-add-act">${icon('plus', 22)}<span>新增活动</span></button>
  </div>`;
}

function miniCalendar() {
  const n = now();
  const [y, m] = n.date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const startWd = (first.getUTCDay() + 6) % 7; // 周一开头
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const eventDays = new Set();
  for (const s of S.slots) if (s.status !== 'obsolete') eventDays.add(s.date);
  for (const t of S.tasks) if (!isEnded(t) && t.due?.date) eventDays.add(t.due.date);
  for (const a of S.activities) if (a.start) eventDays.add(a.start.slice(0, 10));
  let cells = '';
  for (let i = 0; i < startWd; i++) cells += '<span class="mc-day other"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells += `<span class="mc-day ${ds === n.date ? 'today' : ''}" data-day="${ds}">${d}${eventDays.has(ds) ? '<span class="ev-dot"></span>' : ''}</span>`;
  }
  return `
  <div class="rail-card mini-cal-card">
    <div class="mini-cal-head"><span class="mc-label">${y} 年 ${m} 月</span><button class="text-btn" id="mc-today">回到今天</button></div>
    <div class="mini-cal">${['一', '二', '三', '四', '五', '六', '日'].map(w => `<span class="mc-wd">${w}</span>`).join('')}${cells}</div>
  </div>`;
}

function todayTimeline() {
  const n = now();
  const slots = S.slots.filter(s => s.date === n.date && s.status === 'pending')
    .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99')).slice(0, 5);
  return `
  <div class="rail-card today-card">
    <div class="rail-title">${icon('calendar', 15)} 今天的计划</div>
    <div class="tc-body">
      ${slots.length ? `<div class="timeline">${slots.map(s => {
        const t = S.tasks.find(x => x.id === s.taskId);
        return `<div class="tl-item clickable" data-open-task="${s.taskId}">
          <div class="tl-time">${s.start ? s.start + ' – ' + s.end : '全天 · 无具体时间'}</div>
          <div class="tl-title">${esc(s.title || t?.title || '计划时段')}</div>
          <div class="tl-meta">${catPillHtml(taskCategory(t))}<span>${esc(t ? ownerLabel(t) : '独立待办')}</span></div>
        </div>`;
      }).join('')}</div>`
      : `<div class="tiny muted" style="line-height:1.9">今天还没有安排时段。<br>不必排满，留白也是计划的一部分。</div>`}
      <button class="text-btn mt-sm" id="rail-plan">打开计划中心 →</button>
    </div>
  </div>`;
}

export async function renderHome(root) {
  const n = now();
  const name = (S.user.email || '同学').split('@')[0];
  const ddl = recentDdl();
  const unfinished = S.tasks.filter(t => !isEnded(t)).length;
  const soon = ddl.filter(t => !isOverdue(t, n)).length;
  const todaySlots = S.slots.filter(s => s.date === n.date && s.status === 'pending').length;
  const terms = [...new Set(S.courses.map(c => c.term).filter(Boolean))];
  const usedPct = Math.min(100, (S.usage.used / S.usage.limit) * 100);

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow">A LITTLE MORE ORGANIZED</div>
        <h1>你好，${esc(name)} 同学</h1>
        <div class="ph-meta">${n.date.replace(/-/g, ' / ')} · ${weekdayCN(n.date)} · ${greeting()}</div>
      </div>
      <div class="ph-actions">
        <button class="btn" id="home-ai">${icon('sparkles', 16)} AI 快速录入</button>
        <button class="btn primary" id="home-add-task">${icon('plus', 16)} 添加待办</button>
      </div>
    </div>

    <div class="overview">
      <div>
        <div class="ov-quote">把琐事放好，把时间留给自己。</div>
        <div class="ov-sub">一件事，连着它的资料、它的时间，和你打算什么时候去做。</div>
      </div>
      <div class="ov-stats">
        <div class="ov-stat"><div class="ov-num">${unfinished}</div><div class="ov-label">未完成事项</div></div>
        <div class="ov-stat"><div class="ov-num">${soon}</div><div class="ov-label">7 天内截止</div></div>
        <div class="ov-stat"><div class="ov-num">${todaySlots}</div><div class="ov-label">今日计划时段</div></div>
      </div>
      <div class="ov-paper"><div class="sheet s1"></div><div class="sheet s2"></div></div>
    </div>

    <div class="home-grid">
      <div class="home-main">
        <section class="home-section">
          <div class="section-title">
            <h2>近期截止</h2><span class="st-sub">${ddl.length} 项 · 逾期在前 · 今天起 7 天</span><span class="spacer"></span>
            <button class="text-btn" id="ddl-all">查看全部 →</button>
          </div>
          <div class="panel deadline-list" id="ddl-list">
            ${ddl.length ? ddl.slice(0, 5).map(t => taskRow(t)).join('')
              : empty('sun', '最近没有截止事项', '难得的空档，适合预习、整理，或者好好休息。', `<button class="btn soft" id="ddl-add">${icon('plus', 15)} 添加待办</button>`)}
          </div>
        </section>

        <section class="home-section">
          <div class="section-title">
            <h2>我的作业</h2><span class="st-sub">按课程管理作业和课件</span><span class="spacer"></span>
            <select class="input" id="term-filter" style="width:auto;min-height:34px;font-size:11px">
              <option value="">全部学期</option>${terms.map(t => `<option value="${esc(t)}" ${termFilter === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
            </select>
            <label class="row tiny muted" style="gap:6px;cursor:pointer"><input type="checkbox" id="arch-toggle" ${showArchived ? 'checked' : ''}> 含归档</label>
          </div>
          <div id="course-area">${courseCards()}</div>
        </section>

        <section class="home-section">
          <div class="section-title"><h2>我的活动</h2><span class="st-sub">节点、凭证与成果，按活动归档</span></div>
          <div id="act-area">${activityCards()}</div>
        </section>
      </div>

      <div class="home-rail">
        ${miniCalendar()}
        ${todayTimeline()}
        <div class="focus-card">
          ${icon('leaf', 22)}
          <div class="focus-quote">不必一口气做完所有事。</div>
          <div class="focus-sub">先挑一件最小的开始：整理一页课件、写一段初稿。完成一个时段，就值得给自己一个勾。</div>
        </div>
        <div class="rail-card clickable" id="rail-storage">
          <div class="rail-title">${icon('inbox', 15)} 存储容量</div>
          <div class="storage-bar"><div class="storage-fill" style="width:${usedPct}%"></div></div>
          <div class="storage-meta"><span>已用 ${fmtBytes(S.usage.used)}</span><span>共 ${fmtBytes(S.usage.limit)}</span></div>
        </div>
      </div>
    </div>`;

  // 事件
  root.querySelector('#home-ai').addEventListener('click', openAI);
  root.querySelector('#home-add-task').addEventListener('click', () => openTaskForm({ preset: { type: 'todo', needsSubmit: false } }));
  root.querySelector('#ddl-all').addEventListener('click', () => { setPlanAnchor(n.date, 'ddl'); location.hash = '#/plan'; });
  root.querySelector('#ddl-add')?.addEventListener('click', () => openTaskForm({ preset: { type: 'todo', needsSubmit: false } }));
  root.querySelector('#term-filter').addEventListener('change', e => { termFilter = e.target.value; rerenderAreas(); });
  root.querySelector('#arch-toggle').addEventListener('change', e => { showArchived = e.target.checked; rerenderAreas(); });
  root.querySelector('#rail-plan').addEventListener('click', () => { location.hash = '#/plan'; });
  root.querySelector('#rail-storage').addEventListener('click', () => { location.hash = '#/settings'; });
  root.querySelector('#mc-today').addEventListener('click', () => { setPlanAnchor(n.date, 'day'); location.hash = '#/plan'; });
  root.querySelectorAll('[data-day]').forEach(el => el.addEventListener('click', () => { setPlanAnchor(el.dataset.day, 'day'); location.hash = '#/plan'; }));
  root.querySelectorAll('[data-open-task]').forEach(el => el.addEventListener('click', () => { location.hash = '#/task/' + el.dataset.openTask; }));

  function rerenderAreas() {
    root.querySelector('#course-area').innerHTML = courseCards();
    root.querySelector('#act-area').innerHTML = activityCards();
    bindAreas();
  }
  function bindAreas() {
    root.querySelectorAll('[data-course]').forEach(el => el.addEventListener('click', () => { location.hash = '#/course/' + el.dataset.course; }));
    root.querySelectorAll('[data-activity]').forEach(el => el.addEventListener('click', () => { location.hash = '#/activity/' + el.dataset.activity; }));
    root.querySelector('#home-add-course')?.addEventListener('click', () => openCourseForm());
    root.querySelector('#home-add-act')?.addEventListener('click', () => openActivityForm());
  }
  bindAreas();
  bindTaskRows(root.querySelector('#ddl-list'), { onMenu: openTaskMenu, onCheck: quickComplete });
}