import { icon } from '../icons.js';
import { esc, TYPE_LABEL, STATUS_LABEL, fmtDateCN, SLOT_STATUS_LABEL } from '../util.js';
import { S, now, refresh, task } from '../state.js';
import { api } from '../api.js';
import { empty, toast, dueBadgeHtml, statusPill, typePill } from '../ui.js';

const SECTIONS = [
  { id: 'overdue', title: '已逾期', sub: '错过的截止时间，先看看还来不来得及', ic: 'alert', tone: 'red' },
  { id: 'today', title: '今日到期', sub: '今天之内要交的事', ic: 'clock', tone: 'peach' },
  { id: 'upcoming', title: '即将到期', sub: '按你设置的提前天数提醒', ic: 'bell', tone: 'blue' },
  { id: 'plan', title: '今日计划', sub: '今天安排了执行时段的任务', ic: 'calendar', tone: 'green' },
];

function rowHtml(r) {
  const t = task(r.taskId);
  if (!t) return '';
  const slots = r.slotIds.map(id => S.slots.find(s => s.id === id)).filter(Boolean);
  const slotText = slots.map(s => `${s.date === now().date ? '' : fmtDateCN(s.date) + ' '}${s.start ? `${s.start}–${s.end}` : '全天'} · ${SLOT_STATUS_LABEL[s.status]}`).join('；');
  return `
  <div class="reminder-row ${r.read ? '' : 'unread'}" data-key="${esc(r.key)}">
    <div class="rr-main" data-open="${t.id}">
      <div class="rr-title">${esc(t.title)} ${r.section === 'plan' && r.overdueFlag ? '<span class="pill red">已逾期</span>' : ''}</div>
      <div class="rr-sub">${esc(TYPE_LABEL[t.type])} · ${esc(STATUS_LABEL[t.status])}${slotText ? ' · ' + esc(slotText) : ''}</div>
    </div>
    ${r.section !== 'plan' ? dueBadgeHtml(t) : ''}
    ${r.read ? '<span class="pill gray">已读</span>' : `<button class="btn sm soft" data-read="${esc(r.key)}">标为已读</button>`}
    <button class="icon-btn" data-open2="${t.id}" aria-label="打开任务">${icon('chevR', 16)}</button>
  </div>`;
}

export async function renderAlerts(root) {
  const items = S.reminders.filter(r => task(r.taskId));
  const unread = items.filter(r => !r.read);
  const grouped = SECTIONS.map(sec => ({ ...sec, rows: items.filter(r => r.section === sec.id) })).filter(g => g.rows.length);

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow">GENTLE REMINDERS</div>
        <h1>提醒中心</h1>
        <div class="ph-meta">按北京时间 ${esc(now().date)} 计算 · 已读只是“看过了”，不代表任务完成</div>
      </div>
      <div class="ph-actions">
        ${unread.length ? `<button class="btn" id="a-readall">${icon('check', 16)} 全部标为已读（${unread.length}）</button>` : ''}
        <a class="btn soft" href="#/settings">${icon('settings', 16)} 提醒偏好</a>
      </div>
    </div>
    ${grouped.length ? grouped.map(g => `
      <div class="reminder-section">
        <div class="rs-head">
          <span class="cat-icon ${g.tone === 'red' ? 'peach' : g.tone}" style="width:30px;height:30px;border-radius:8px">${icon(g.ic, 16)}</span>
          <h3>${g.title}</h3>
          <span class="rs-count">${g.rows.length} 项</span>
          <span class="tiny muted" style="margin-left:auto">${g.sub}</span>
        </div>
        ${g.rows.map(rowHtml).join('')}
      </div>`).join('')
    : empty('leaf', '今天没有需要提醒的事', '不必一口气做完所有事。有截止或计划安排时，这里会安静地列出来。',
        '<a class="btn soft" href="#/plan">看看计划中心</a>')}
    <div class="tiny muted" style="margin-top:18px;line-height:1.9">
      提醒规则可以在每个任务里单独调整；每日邮件摘要在 <a href="#/settings" style="color:var(--green)">设置</a> 中开启。逾期是时间状态，不会自动改变任务进度。
    </div>`;

  root.querySelector('#a-readall')?.addEventListener('click', async () => {
    try {
      await api.post('/api/reminders/read', {});
      await refresh();
      toast('已全部标为已读');
    } catch (e) { toast(e.message, 'err'); }
  });
  root.addEventListener('click', async e => {
    const rd = e.target.closest('[data-read]');
    if (rd) {
      try {
        await api.post('/api/reminders/read', { keys: [rd.dataset.read] });
        await refresh();
      } catch (err) { toast(err.message, 'err'); }
      return;
    }
    const open = e.target.closest('[data-open],[data-open2]');
    if (open) location.hash = '#/task/' + (open.dataset.open || open.dataset.open2);
  });
}