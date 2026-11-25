import { icon } from '../icons.js';
import { esc, fmtDateCN, fmtDateTime, weekdayCN, addDaysStr, dayDiff, isEnded, isOverdue, WD_SHORT, TYPE_LABEL, STATUS_LABEL } from '../util.js';
import { S, now, task, refresh, course, activity, ownerLabel, taskCategory, activityCategory, slotCategory, taskMatchesOwner, catPillHtml, PLAN_CATS, CAT_SHORT } from '../state.js';
import { taskRow, bindTaskRows, empty, toast, dueBadgeHtml, statusPill, confirmDialog } from '../ui.js';
import { openTaskForm, openSlotForm, openTaskMenu, quickComplete } from '../forms.js';
import { api } from '../api.js';

let anchor = null;   // YYYY-MM-DD
let view = 'week';   // day | week | month | ddl
let cat = 'all';     // all | study | activity | contest | other
let ownerFilter = null; // { type: 'course'|'activity', id }
let ddlCards = false;
let showHistory = false;
let selectedDay = null;

export function setPlanAnchor(date, v, opts = null) {
  anchor = date; if (v) view = v;
  selectedDay = date;
  if (opts) {
    if (opts.cat) cat = opts.cat;
    ownerFilter = opts.owner || null;
  }
}

function mondayOf(date) {
  const wd = (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return addDaysStr(date, -wd);
}

function catOkTask(t) {
  return (cat === 'all' || taskCategory(t) === cat) && taskMatchesOwner(t, ownerFilter);
}
function slotsOn(date) {
  return S.slots.filter(s => s.date === date && (showHistory || ['pending', 'done'].includes(s.status)) && catOkTask(task(s.taskId)))
    .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));
}
function activitiesOn(date) {
  return S.activities.filter(a => a.start && a.start.slice(0, 10) <= date && (!a.end || a.end.slice(0, 10) >= date) && !a.archived
    && (cat === 'all' || activityCategory(a) === cat)
    && (!ownerFilter || (ownerFilter.type === 'activity' && ownerFilter.id === a.id)));
}
function dueOn(date) {
  return S.tasks.filter(t => t.due?.date === date && !isEnded(t) && catOkTask(t));
}

function evChipList(date) {
  const chips = [];
  const tag = c => `<span class="ev-cat">${CAT_SHORT[c] || '其'}</span>`;
  for (const s of slotsOn(date)) {
    const t = task(s.taskId);
    chips.push(`<div class="ev-chip plan" data-slot-chip="${s.id}" title="${esc(s.title || t?.title || '')}">${tag(slotCategory(s))}<span class="ev-t">${s.start ? s.start + ' ' : ''}${esc(s.title || t?.title || '学习')}</span></div>`);
  }
  for (const t of dueOn(date)) {
    chips.push(`<div class="ev-chip ${t.type === 'exam' ? 'exam' : 'due'}" data-task-chip="${t.id}" title="${esc(t.title)}">${tag(taskCategory(t))}<span class="ev-t">${t.due.dateOnly ? '' : (t.due.time || '') + ' '}${esc(t.title)}</span></div>`);
  }
  for (const a of activitiesOn(date)) {
    chips.push(`<div class="ev-chip activity" data-act-chip="${a.id}" title="${esc(a.name)}">${tag(activityCategory(a))}<span class="ev-t">${esc(a.name)}</span></div>`);
  }
  return chips;
}
function evChips(date) { return evChipList(date).join(''); }

function slotCardHtml(s) {
  const t = task(s.taskId);
  return `
  <div class="slot-card ${s.status}">
    <div class="slot-time ${s.start ? '' : 'allday'}">${s.start ? s.start + ' – ' + s.end : '无具体时间'}</div>
    <div class="slot-main clickable" data-task-chip="${s.taskId}">
      <div class="slot-title">${esc(s.title || t?.title || '学习时段')}</div>
      <div class="slot-sub">${catPillHtml(slotCategory(s))} ${esc(t?.title || '')} · ${esc(ownerLabel(t))} · ${{ pending: '待执行', done: '已完成', skipped: '已跳过', obsolete: '不再需要' }[s.status]}</div>
    </div>
    <div class="file-actions">
      ${s.status === 'pending' ? `<button class="icon-btn" data-slot-done="${s.id}" title="完成时段" aria-label="完成时段">${icon('check', 16)}</button>` : ''}
      <button class="icon-btn" data-slot-edit="${s.id}" aria-label="编辑时段">${icon('edit', 16)}</button>
      <button class="icon-btn" data-slot-del="${s.id}" aria-label="删除时段">${icon('trash', 16)}</button>
    </div>
  </div>`;
}

function daySection(date) {
  const slots = slotsOn(date);
  const timed = slots.filter(s => s.start);
  const allday = slots.filter(s => !s.start);
  const acts = activitiesOn(date);
  const dues = dueOn(date);
  return `
    <div class="day-group-title">执行安排 · ${fmtDateCN(date)} ${weekdayCN(date)}</div>
    <div class="day-list">
      ${timed.map(slotCardHtml).join('') || '<div class="tiny muted" style="padding:6px 2px">还没有具体时段。</div>'}
    </div>
    ${allday.length ? `<div class="day-group-title">无具体时间</div><div class="day-list">${allday.map(slotCardHtml).join('')}</div>` : ''}
    ${acts.length ? `<div class="day-group-title">活动时间</div><div class="day-list">${acts.map(a => `
      <div class="slot-card clickable" data-act-chip="${a.id}">
        <div class="slot-time allday">${a.start.slice(11, 16) || '全天'}</div>
        <div class="slot-main"><div class="slot-title">${esc(a.name)}</div><div class="slot-sub">${catPillHtml(activityCategory(a))} ${a.location ? esc(a.location) : '地点待定'} · 活动事件（非节点截止）</div></div>
      </div>`).join('')}</div>` : ''}
    ${dues.length ? `<div class="day-group-title">当日截止</div><div class="panel"><div class="panel-body flush">${dues.map(t => taskRow(t)).join('')}</div></div>` : ''}
    <button class="btn soft mt" data-add-slot="${date}">${icon('plus', 15)} 在 ${fmtDateCN(date)} 添加时段</button>`;
}

function weekView() {
  const mon = mondayOf(anchor);
  const today = now().date;
  const days = Array.from({ length: 7 }, (_, i) => addDaysStr(mon, i));
  const cols = days.map(d => `
    <div class="week-col ${d === today ? 'today' : ''}">
      <div class="wc-head">${WD_SHORT[(new Date(d + 'T00:00:00Z').getUTCDay())]}<strong class="wc-num">${+d.slice(8)}</strong></div>
      <div class="wc-body">
        ${evChips(d) || '<div class="tiny muted" style="opacity:0.6">—</div>'}
        <button class="text-btn mt-sm" data-add-slot="${d}">+ 安排</button>
      </div>
    </div>`).join('');
  const rows = days.map(d => `
    <div class="week-row ${d === today ? 'today' : ''}">
      <div class="wr-head"><div class="wr-wd">${WD_SHORT[(new Date(d + 'T00:00:00Z').getUTCDay())]}</div><div class="wr-date">${fmtDateCN(d)}</div></div>
      <div class="wr-events">${evChips(d) || '<span class="tiny muted">没有安排</span>'}<button class="text-btn" data-add-slot="${d}">+ 安排时段</button></div>
    </div>`).join('');
  return `<div class="week-grid">${cols}</div><div class="week-rows">${rows}</div>`;
}

function monthView() {
  const [y, m] = anchor.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const startWd = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = now().date;
  let cells = '';
  const start = addDaysStr(first, -startWd);
  for (let i = 0; i < 42; i++) {
    const d = addDaysStr(start, i);
    const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
    const chips = evChipList(d);
    cells += `<div class="month-cell ${inMonth ? '' : 'other'} ${d === today ? 'today' : ''} ${d === selectedDay ? 'selected' : ''}" data-month-day="${d}">
      <div class="mo-num">${+d.slice(8)}</div>
      ${chips.slice(0, 2).join('')}
      ${chips.length > 2 ? `<button class="mo-more" data-month-day="${d}">另 ${chips.length - 2} 项</button>` : ''}
    </div>`;
    if (i >= 35 && addDaysStr(start, i + 1).slice(0, 7) !== anchor.slice(0, 7)) break;
  }
  return `
    <div class="month-grid">
      ${['一', '二', '三', '四', '五', '六', '日'].map(w => `<div class="month-wd">${w}</div>`).join('')}
      ${cells}
    </div>
    <div class="mt-lg" id="month-day-detail">${selectedDay ? daySection(selectedDay) : '<div class="tiny muted">点选日期，展开当天的完整安排。</div>'}</div>`;
}

function ddlTasks() {
  const n = now();
  return S.tasks.filter(t => t.due?.date && !isEnded(t) && catOkTask(t)).sort((a, b) => {
    const ao = isOverdue(a, n), bo = isOverdue(b, n);
    if (ao !== bo) return ao ? -1 : 1;
    return (a.due.date + (a.due.time || '')).localeCompare(b.due.date + (b.due.time || ''));
  });
}
function ddlView() {
  const ts = ddlTasks();
  if (!ts.length) return empty('sun', cat === 'all' && !ownerFilter ? '没有待截止的事项' : '该类别下没有待截止的事项', '所有事情都安排妥当了，享受这份从容。');
  if (!ddlCards) return `<div class="panel"><div class="panel-body flush">${ts.map(t => taskRow(t)).join('')}</div></div>`;
  return `<div class="card-grid three">${ts.map(t => `
    <div class="course-card" data-task-chip="${t.id}">
      <div class="cc-name">${esc(t.title)}</div>
      <div class="cc-teacher">${catPillHtml(taskCategory(t))} ${esc(t.ownerType ? (S.courses.find(c => c.id === t.ownerId)?.name || S.activities.find(a => a.id === t.ownerId)?.name || '') : '独立待办')} · ${TYPE_LABEL[t.type]}</div>
      <div class="cc-foot">${dueBadgeHtml(t)}<span class="spacer"></span>${statusPill(t)}</div>
    </div>`).join('')}</div>`;
}

function countInView() {
  if (view === 'ddl') return ddlTasks().length;
  const dates = view === 'day' ? [anchor]
    : view === 'week' ? Array.from({ length: 7 }, (_, i) => addDaysStr(mondayOf(anchor), i))
    : Array.from({ length: new Date(Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7), 0)).getUTCDate() }, (_, i) => `${anchor.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`);
  let n = 0;
  for (const d of dates) n += slotsOn(d).length + dueOn(d).length + activitiesOn(d).length;
  return n;
}

function unscheduled() {
  const ts = S.tasks.filter(t => !isEnded(t) && !S.slots.some(s => s.taskId === t.id && s.status !== 'obsolete') && catOkTask(t));
  if (!ts.length) return '';
  return `
  <div class="panel mt-lg">
    <div class="panel-header"><h3>待安排</h3><span class="ph-sub">${ts.length} 项没有计划时段的未完成任务 · 安排后仍保留 DDL</span></div>
    <div class="panel-body flush">
      ${ts.map(t => `
        <div class="task-row">
          <div class="task-main" data-task-chip="${t.id}">
            <div class="task-title">${esc(t.title)}</div>
            <div class="task-meta">${catPillHtml(taskCategory(t))}<span class="dot"></span><span>${esc(t.ownerType ? (S.courses.find(c => c.id === t.ownerId)?.name || S.activities.find(a => a.id === t.ownerId)?.name || '') : '独立待办')}</span><span class="dot"></span><span>${TYPE_LABEL[t.type]}</span></div>
          </div>
          ${dueBadgeHtml(t)}
          <button class="btn sm soft" data-add-slot-task="${t.id}">${icon('calendar', 13)} 安排</button>
        </div>`).join('')}
    </div>
  </div>`;
}

export async function renderPlan(root) {
  const n = now();
  if (!anchor) anchor = n.date;
  if (!selectedDay) selectedDay = anchor;
  const label = view === 'day' ? `${fmtDateCN(anchor)} · ${weekdayCN(anchor)}`
    : view === 'week' ? `${fmtDateCN(mondayOf(anchor))} — ${fmtDateCN(addDaysStr(mondayOf(anchor), 6))}`
    : view === 'month' ? `${anchor.slice(0, 4)} 年 ${+anchor.slice(5, 7)} 月`
    : 'DDL 列表';
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 0;

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow">PLAN CENTER</div>
        <h1>计划中心</h1>
        <div class="ph-meta">执行安排是“打算何时做”，截止是“最迟何时交”，活动时间是“活动何时发生”——三者各自独立。</div>
      </div>
      <div class="ph-actions">
        <button class="btn" id="p-new-todo">${icon('plus', 15)} 新增待办</button>
        <button class="btn primary" id="p-new-slot">${icon('calendar', 15)} 安排时段</button>
      </div>
    </div>
    <div class="plan-toolbar">
      <div class="seg" id="p-cats">
        ${PLAN_CATS.map(([k, v]) => `<button data-cat="${k}" class="${cat === k ? 'active' : ''}">${v}</button>`).join('')}
      </div>
      <div class="seg" id="p-views">
        ${[['day', '日'], ['week', '周'], ['month', '月'], ['ddl', 'DDL 列表']].map(([k, v]) => `<button data-view="${k}" class="${view === k ? 'active' : ''}">${v}</button>`).join('')}
      </div>
      ${view !== 'ddl' ? `
      <div class="plan-nav">
        <button class="icon-btn" id="p-prev" aria-label="上一段">${icon('chevL')}</button>
        <div class="plan-label">${label}</div>
        <button class="icon-btn" id="p-next" aria-label="下一段">${icon('chevR')}</button>
        <button class="btn sm" id="p-today">今天</button>
      </div>` : `
      <div class="seg" id="p-ddl-style">
        <button data-style="list" class="${!ddlCards ? 'active' : ''}">${icon('list', 14)} 列表</button>
        <button data-style="card" class="${ddlCards ? 'active' : ''}">${icon('grid', 14)} 卡片</button>
      </div>`}
      <span class="spacer"></span>
      <label class="row tiny muted" style="gap:6px;cursor:pointer"><input type="checkbox" id="p-history" ${showHistory ? 'checked' : ''}> 显示已跳过 / 不再需要</label>
    </div>
    ${ownerFilter ? `
    <div class="owner-filter-row">
      <span class="pill blue">仅看：${esc(ownerFilter.type === 'course' ? course(ownerFilter.id)?.name : activity(ownerFilter.id)?.name)}</span>
      <button class="text-btn" id="p-owner-clear">清除对象筛选</button>
      <span class="tiny muted">对象筛选只影响显示，不改变任务归属。</span>
    </div>` : ''}
    <div class="tiny muted" id="p-count" style="margin:0 2px 10px">当前范围 ${countInView()} 项安排</div>
    <div id="p-body">
      ${view === 'day' ? daySection(anchor) : view === 'week' ? weekView() : view === 'month' ? monthView() : ddlView()}
    </div>
    ${view !== 'ddl' ? unscheduled() : ''}`;

  root.querySelector('#p-new-todo').addEventListener('click', () => openTaskForm({
    ownerType: ownerFilter?.type || null, ownerId: ownerFilter?.id || null,
    preset: { type: 'todo', needsSubmit: false, stay: true, planCategory: cat === 'all' ? 'other' : cat },
  }));
  root.querySelector('#p-new-slot').addEventListener('click', () => openSlotForm({ date: anchor, category: cat, owner: ownerFilter }));
  root.querySelector('#p-cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    cat = b.dataset.cat;
    if (ownerFilter && cat !== 'all') {
      const ownerCat = ownerFilter.type === 'course' ? 'study' : activityCategory(activity(ownerFilter.id));
      if (ownerCat !== cat) ownerFilter = null;
    }
    renderPlan(root);
  });
  root.querySelector('#p-owner-clear')?.addEventListener('click', () => { ownerFilter = null; renderPlan(root); });
  root.querySelector('#p-views').addEventListener('click', e => {
    const b = e.target.closest('[data-view]'); if (!b) return;
    view = b.dataset.view; renderPlan(root);
  });
  root.querySelector('#p-ddl-style')?.addEventListener('click', e => {
    const b = e.target.closest('[data-style]'); if (!b) return;
    ddlCards = b.dataset.style === 'card'; renderPlan(root);
  });
  root.querySelector('#p-prev')?.addEventListener('click', () => { shift(-1); });
  root.querySelector('#p-next')?.addEventListener('click', () => { shift(1); });
  root.querySelector('#p-today')?.addEventListener('click', () => { anchor = n.date; selectedDay = n.date; renderPlan(root); });
  root.querySelector('#p-history').addEventListener('change', e => { showHistory = e.target.checked; renderPlan(root); });

  function shift(dir) {
    if (view === 'month') {
      const [y, m] = anchor.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      anchor = d.toISOString().slice(0, 10);
    } else anchor = addDaysStr(anchor, dir * step);
    selectedDay = anchor;
    renderPlan(root);
  }

  const body = root.querySelector('#p-body');
  body.addEventListener('click', async e => {
    const slotChip = e.target.closest('[data-slot-chip]');
    if (slotChip) { openSlotForm({ slot: S.slots.find(s => s.id === slotChip.dataset.slotChip) }); return; }
    const taskChip = e.target.closest('[data-task-chip]');
    if (taskChip) { location.hash = '#/task/' + taskChip.dataset.taskChip; return; }
    const actChip = e.target.closest('[data-act-chip]');
    if (actChip) { location.hash = '#/activity/' + actChip.dataset.actChip; return; }
    const md = e.target.closest('[data-month-day]');
    if (md) { selectedDay = md.dataset.monthDay; renderPlan(root); return; }
    const addSlot = e.target.closest('[data-add-slot]');
    if (addSlot) { openSlotForm({ date: addSlot.dataset.addSlot, category: cat, owner: ownerFilter }); return; }
    const addSlotTask = e.target.closest('[data-add-slot-task]');
    if (addSlotTask) { openSlotForm({ taskId: addSlotTask.dataset.addSlotTask, date: anchor }); return; }
    const done = e.target.closest('[data-slot-done]');
    if (done) {
      const s = S.slots.find(x => x.id === done.dataset.slotDone);
      await api.patch('/api/slots/' + s.id, { status: 'done', v: s.v });
      toast('时段已完成'); await refresh(); return;
    }
    const ed = e.target.closest('[data-slot-edit]');
    if (ed) { openSlotForm({ slot: S.slots.find(x => x.id === ed.dataset.slotEdit) }); return; }
    const del = e.target.closest('[data-slot-del]');
    if (del) {
      const ok = await confirmDialog({ title: '删除该时段', message: '只删除这个执行时段，不删除任务，也不改变截止时间。', confirmText: '删除时段', danger: true });
      if (!ok) return;
      await api.del('/api/slots/' + del.dataset.slotDel);
      toast('时段已删除'); await refresh();
    }
  });
  body.querySelectorAll('.panel-body.flush').forEach(el => bindTaskRows(el, { onMenu: openTaskMenu, onCheck: quickComplete }));
}