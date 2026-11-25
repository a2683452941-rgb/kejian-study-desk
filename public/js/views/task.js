import { icon } from '../icons.js';
import { esc, fmtDateFull, fmtDateTime, relTime, STATUS_LABEL, TYPE_LABEL, SLOT_STATUS_LABEL, countdownText, isEnded } from '../util.js';
import { S, now, task, ownerOf, slotsOf, resourcesOf, taskCategory, catPillHtml } from '../state.js';
import { statusPill, typePill, dueBadgeHtml, empty, toast, confirmDialog } from '../ui.js';
import { openTaskForm, openSlotForm, setTaskStatus, confirmDeleteTask, quickComplete } from '../forms.js';
import { mountUpload, resourceListHtml, bindResourceList } from '../upload.js';
import { api } from '../api.js';

const FLOW_SUBMIT = ['notstarted', 'doing', 'ready', 'submitted'];
const FLOW_DONE = ['notstarted', 'doing', 'done'];

export async function renderTask(root, id) {
  const t = task(id);
  if (!t) { root.innerHTML = empty('inbox', '任务不存在或已被删除', '回到首页看看其他事项。', '<button class="btn primary" data-nav="#/">回到首页</button>'); return; }
  const n = now();
  const owner = ownerOf(t);
  const slots = slotsOf(t.id).sort((a, b) => (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
  const res = resourcesOf('task', t.id).map(r => ({ r, from: null }));
  const flow = t.needsSubmit ? FLOW_SUBMIT : FLOW_DONE;
  const ended = isEnded(t);
  const verb = t.type === 'exam' ? '考试开始时间' : '截止时间';

  root.innerHTML = `
    <button class="text-btn mb" id="t-back">← 返回${owner ? (t.ownerType === 'course' ? '课程' : '活动') : '首页'}</button>
    <div class="detail-head">
      <div class="dh-text">
        <div class="eyebrow">TASK · ${TYPE_LABEL[t.type]}</div>
        <h1>${esc(t.title)}</h1>
        <div class="detail-meta">
          ${catPillHtml(taskCategory(t))} ${typePill(t)} ${statusPill(t)} ${dueBadgeHtml(t)}
          ${owner ? `<button class="pill blue clickable" id="t-owner" style="border:none;cursor:pointer">${esc(owner.name)} →</button>` : '<span class="pill gray">独立待办</span>'}
          ${t.due && !ended ? `<span class="tiny muted">${countdownText(t, n)}</span>` : ''}
        </div>
      </div>
      <div class="ph-actions">
        <button class="btn" id="t-edit">${icon('edit', 15)} 编辑</button>
        <button class="btn primary" id="t-slot">${icon('calendar', 15)} 安排时段</button>
      </div>
    </div>

    <div class="panel mb">
      <div class="panel-header"><h3>状态</h3><span class="ph-sub">${t.needsSubmit ? '上传文件 ≠ 已提交，需主动确认' : '完成后停止未来提醒'}</span></div>
      <div class="panel-body">
        <div class="status-flow">
          ${flow.map(s => `<button class="status-btn ${t.status === s ? 'current' : ''}" data-status="${s}">${STATUS_LABEL[s]}</button>`).join('')}
          <button class="status-btn ${t.status === 'cancelled' ? 'current' : ''}" data-status="cancelled">已取消</button>
          ${ended && t.status !== 'cancelled' ? `<button class="btn sm soft" id="t-reopen">${icon('undo', 14)} 重新打开</button>` : ''}
        </div>
        ${t.status === 'ready' ? '<div class="field-hint mt-sm">文件可能已写完，但尚未确认提交——提醒会继续，直到你确认。</div>' : ''}
        ${t.type === 'exam' && t.due && !ended && countdownText(t, n) === '已过时刻' ? '<div class="field-hint mt-sm">考试时间已过，请确认是否已完成。</div>' : ''}
      </div>
    </div>

    <div class="detail-grid">
      <div class="detail-main">
        <div class="panel">
          <div class="panel-header"><h3>要求与来源</h3></div>
          <div class="panel-body">
            ${t.note ? `<div class="note-box">${esc(t.note)}</div>` : '<div class="tiny muted">未填写要求说明。</div>'}
            ${t.sourceText ? `<details class="opt mt"><summary>${icon('chevR', 15)} 通知原文</summary><div class="opt-body"><div class="note-box">${esc(t.sourceText)}</div></div></details>` : ''}
            ${t.sourceLink ? `<div class="mt-sm"><a href="${esc(t.sourceLink)}" target="_blank" rel="noopener noreferrer" class="link-btn">${icon('link', 13)} 打开来源链接</a></div>` : ''}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h3>附件</h3><span class="ph-sub">上传不会自动改变状态</span></div>
          <div class="panel-body">
            <div id="t-upload" class="mb"></div>
            <div id="t-res">${resourceListHtml(res)}</div>
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h3>执行时段</h3><span class="ph-sub">打算何时做 · 与截止时间独立</span>
            <button class="btn sm soft" id="t-add-slot">${icon('plus', 14)} 添加时段</button></div>
          <div class="panel-body" id="t-slots">
            ${slots.length ? slots.map(s => `
              <div class="slot-card ${s.status}" data-slot="${s.id}">
                <div class="slot-time ${s.start ? '' : 'allday'}">${s.date.slice(5).replace('-', '/')}${s.start ? '<br>' + s.start + '–' + s.end : '<br>全天'}</div>
                <div class="slot-main">
                  <div class="slot-title">${esc(s.title || t.title)}</div>
                  <div class="slot-sub">${SLOT_STATUS_LABEL[s.status]}</div>
                </div>
                <div class="file-actions">
                  ${s.status === 'pending' ? `<button class="icon-btn" data-slot-done="${s.id}" title="完成该时段" aria-label="完成时段">${icon('check', 16)}</button>
                  <button class="icon-btn" data-slot-skip="${s.id}" title="跳过" aria-label="跳过时段">${icon('skip', 16)}</button>` : ''}
                  <button class="icon-btn" data-slot-edit="${s.id}" aria-label="编辑时段">${icon('edit', 16)}</button>
                  <button class="icon-btn" data-slot-del="${s.id}" aria-label="删除时段">${icon('trash', 16)}</button>
                </div>
              </div>`).join('')
            : empty('calendar', '还没有安排时段', '安排“打算何时做”，不改变截止时间。', '')}
          </div>
        </div>
      </div>

      <div class="detail-side">
        <div class="panel">
          <div class="panel-header"><h3>时间</h3></div>
          <div class="panel-body">
            <div class="info-list">
              <div class="info-item"><span class="ii-label">${verb}</span><span class="ii-val">${t.due ? fmtDateFull(t.due.date) + (t.due.dateOnly ? ' · 仅日期' : ' ' + t.due.time) : '未设置（不进入倒计时）'}</span></div>
              <div class="info-item"><span class="ii-label">创建</span><span class="ii-val">${relTime(t.createdAt, n.ms)}</span></div>
              <div class="info-item"><span class="ii-label">最近更新</span><span class="ii-val">${relTime(t.updatedAt, n.ms)}</span></div>
            </div>
          </div>
        </div>

        ${t.members?.length ? `
        <div class="panel">
          <div class="panel-header"><h3>分工</h3><span class="ph-sub">仅文字记录</span></div>
          <div class="panel-body">${t.members.map(m => `<div class="member-row"><span class="member-name">${esc(m.name)}</span><span class="member-role">${esc(m.role || '')}</span></div>`).join('')}</div>
        </div>` : ''}

        ${t.score ? `
        <div class="panel">
          <div class="panel-header"><h3>成绩</h3></div>
          <div class="panel-body">
            <span class="score-big">${t.score.value}</span><span class="score-max"> / ${t.score.max}</span>
            ${t.score.feedback ? `<div class="note-box mt-sm">${esc(t.score.feedback)}</div>` : ''}
            <div class="field-hint mt-sm">录入成绩不会自动完成或提交任务。</div>
          </div>
        </div>` : ''}

        <div class="panel">
          <div class="panel-header"><h3>提醒</h3><button class="text-btn" id="t-remind-edit">修改</button></div>
          <div class="panel-body">
            <div class="info-list">
              <div class="info-item"><span class="ii-label">渠道</span><span class="ii-val">${{ inapp: '仅站内', both: '站内 + 邮件', off: '已关闭主动提醒' }[t.remind?.channel] || '默认'}</span></div>
              <div class="info-item"><span class="ii-label">频率</span><span class="ii-val">${t.remind?.freq === 'custom' ? '提前 ' + (t.remind.days || []).join('、') + ' 天' : '每天 · 提前 ' + (t.remind?.lead ?? 7) + ' 天开始'}</span></div>
              <div class="info-item"><span class="ii-label">逾期提醒</span><span class="ii-val">${t.remind?.overdue === false ? '关闭' : '开启'}</span></div>
              <div class="info-item"><span class="ii-label">计划当日</span><span class="ii-val">${t.remind?.planDaily === false ? '关闭' : '开启'}</span></div>
            </div>
          </div>
        </div>

        ${t.statusHistory?.length ? `
        <div class="panel">
          <div class="panel-header"><h3>状态历史</h3></div>
          <div class="panel-body">
            ${[...t.statusHistory].reverse().slice(0, 8).map(h => `<div class="tiny muted" style="padding:4px 0">${relTime(h.at, n.ms)} · ${h.from ? STATUS_LABEL[h.from] + ' → ' : ''}${STATUS_LABEL[h.to] || h.to}${h.note ? '（' + h.note + '）' : ''}</div>`).join('')}
          </div>
        </div>` : ''}

        <button class="btn block danger" id="t-delete">${icon('trash', 15)} 删除任务…</button>
      </div>
    </div>`;

  root.querySelector('#t-back').addEventListener('click', () => {
    location.hash = owner ? `#/${t.ownerType}/${t.ownerId}` : '#/';
  });
  root.querySelector('#t-owner')?.addEventListener('click', () => { location.hash = `#/${t.ownerType}/${t.ownerId}`; });
  root.querySelector('#t-edit').addEventListener('click', () => openTaskForm({ task: t }));
  root.querySelector('#t-remind-edit').addEventListener('click', () => openTaskForm({ task: t }));
  root.querySelector('#t-slot').addEventListener('click', () => openSlotForm({ taskId: t.id }));
  root.querySelector('#t-add-slot').addEventListener('click', () => openSlotForm({ taskId: t.id }));
  root.querySelector('#t-delete').addEventListener('click', () => confirmDeleteTask(t));
  root.querySelector('#t-reopen')?.addEventListener('click', () => quickComplete(t.id));
  root.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => setTaskStatus(t, b.dataset.status)));

  const slotArea = root.querySelector('#t-slots');
  slotArea.addEventListener('click', async e => {
    const done = e.target.closest('[data-slot-done]');
    if (done) {
      const s = S.slots.find(x => x.id === done.dataset.slotDone);
      await api.patch('/api/slots/' + s.id, { status: 'done', v: s.v });
      toast('时段已完成（不影响整项任务）'); await import('../state.js').then(m => m.refresh()); return;
    }
    const skip = e.target.closest('[data-slot-skip]');
    if (skip) {
      const s = S.slots.find(x => x.id === skip.dataset.slotSkip);
      await api.patch('/api/slots/' + s.id, { status: 'skipped', v: s.v });
      toast('已跳过，不会自动顺延'); await import('../state.js').then(m => m.refresh()); return;
    }
    const ed = e.target.closest('[data-slot-edit]');
    if (ed) { openSlotForm({ slot: S.slots.find(x => x.id === ed.dataset.slotEdit) }); return; }
    const del = e.target.closest('[data-slot-del]');
    if (del) {
      const ok = await confirmDialog({ title: '删除该时段', message: '只删除这个执行时段，<b>不删除任务</b>，也不改变截止时间。', confirmText: '删除时段', danger: true });
      if (!ok) return;
      await api.del('/api/slots/' + del.dataset.slotDel);
      toast('时段已删除'); await import('../state.js').then(m => m.refresh());
    }
  });

  mountUpload(root.querySelector('#t-upload'), { ownerType: 'task', ownerId: t.id, category: 'other' });
  bindResourceList(root.querySelector('#t-res'), { ownerType: 'task', ownerId: t.id });
}