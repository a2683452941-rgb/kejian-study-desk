import { icon } from './icons.js';
import { esc, TYPE_LABEL, STATUS_LABEL, dueBadge, isEnded } from './util.js';
import { now, ownerLabel, taskCategory, catPillHtml } from './state.js';

// ---------- Toast ----------
export function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'err' ? ' err' : '');
  el.innerHTML = icon(type === 'err' ? 'alert' : 'check', 16) + `<span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 320); }, 3400);
}

// ---------- Dialog ----------
export function openDialog({ title, eyebrow, body = '', footer = '', wide = false, onClose }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'dlg' + (wide ? ' wide' : '');
  dlg.innerHTML = `
    <div class="dlg-head">
      <div style="flex:1;min-width:0">
        ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
        <h3>${esc(title)}</h3>
      </div>
      <button class="icon-btn" data-close aria-label="关闭">${icon('x')}</button>
    </div>
    <div class="dlg-body"></div>
    ${footer ? `<div class="dlg-foot"></div>` : ''}`;
  dlg.querySelector('.dlg-body').innerHTML = body;
  if (footer) dlg.querySelector('.dlg-foot').innerHTML = footer;
  document.body.appendChild(dlg);
  const close = () => { if (dlg.open) dlg.close(); };
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.showModal();
  return {
    dlg, close,
    body: dlg.querySelector('.dlg-body'),
    get foot() { return dlg.querySelector('.dlg-foot'); },
    setBody(html) { dlg.querySelector('.dlg-body').innerHTML = html; },
    setFooter(html) {
      let f = dlg.querySelector('.dlg-foot');
      if (!f) { f = document.createElement('div'); f.className = 'dlg-foot'; dlg.appendChild(f); }
      f.innerHTML = html;
    },
  };
}

export function confirmDialog({ title, message, confirmText = '确认', danger = false, cancelText = '取消' }) {
  return new Promise(resolve => {
    let done = false;
    const d = openDialog({
      title,
      body: `<div style="font-size:12px;line-height:1.9">${message}</div>`,
      footer: `<button class="btn" data-act="cancel">${esc(cancelText)}</button>
               <button class="btn ${danger ? 'danger' : 'primary'}" data-act="ok">${esc(confirmText)}</button>`,
      onClose: () => { if (!done) { done = true; resolve(false); } },
    });
    d.foot.querySelector('[data-act=cancel]').addEventListener('click', () => { done = true; d.close(); resolve(false); });
    d.foot.querySelector('[data-act=ok]').addEventListener('click', () => { done = true; d.close(); resolve(true); });
  });
}

// ---------- 徽标 ----------
export function statusPill(t) {
  const map = { notstarted: 'gray', doing: 'blue', ready: 'peach', submitted: 'green', done: 'green', cancelled: 'gray' };
  return `<span class="pill ${map[t.status] || 'gray'}">${STATUS_LABEL[t.status] || t.status}</span>`;
}
export function typePill(t) {
  const map = { homework: 'green', exam: 'lilac', node: 'blue', todo: 'gray' };
  return `<span class="pill ${map[t.type] || 'gray'}">${TYPE_LABEL[t.type] || t.type}</span>`;
}
export function dueBadgeHtml(t) {
  const b = dueBadge(t, now());
  if (!b) return '<span class="pill gray">无截止</span>';
  return `<span class="due-badge ${b.cls}">${esc(b.text)}</span>`;
}

// ---------- 任务行 ----------
export function taskRow(t, { check = true } = {}) {
  const ended = isEnded(t);
  const checked = ['submitted', 'done'].includes(t.status);
  const meta = [ownerLabel(t), TYPE_LABEL[t.type], STATUS_LABEL[t.status]].filter(Boolean);
  if (t.score && t.score.value != null) meta.push(`成绩 ${t.score.value}/${t.score.max}`);
  return `
  <div class="task-row" data-task-row="${t.id}">
    ${check ? `<button class="task-check ${checked ? 'done' : ''}" data-check="${t.id}" aria-label="${checked ? '重新打开' : '标记完成'}" title="${checked ? '重新打开' : (t.needsSubmit ? '确认已提交' : '标记已完成')}">${checked ? icon('check', 12) : ''}</button>` : '<span style="width:19px;flex:none"></span>'}
    <div class="task-main" data-open-task="${t.id}">
      <div class="task-title ${ended ? 'done' : ''}">${esc(t.title)}</div>
      <div class="task-meta">${catPillHtml(taskCategory(t))}${meta.map(m => `<span class="dot"></span><span>${esc(m)}</span>`).join('')}</div>
    </div>
    ${dueBadgeHtml(t)}
    <button class="icon-btn" data-task-menu="${t.id}" aria-label="更多操作">${icon('more', 18)}</button>
  </div>`;
}

// ---------- 空状态 ----------
export function empty(iconName, title, sub, actionHtml = '') {
  return `<div class="empty">${icon(iconName, 28)}<div class="e-title">${esc(title)}</div><div class="e-sub">${sub}</div>${actionHtml}</div>`;
}

// ---------- 开关 ----------
export function switchHtml(id, checked, title, sub = '') {
  return `
  <div class="switch-row">
    <div class="sw-text"><div class="sw-title">${esc(title)}</div>${sub ? `<div class="sw-sub">${esc(sub)}</div>` : ''}</div>
    <label class="switch"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
  </div>`;
}

export function loading(text = '正在整理你的学习空间…') {
  return `<div class="loading"><div class="spinner"></div><div class="l-text">${esc(text)}</div></div>`;
}

export function errBlock(msg) {
  return `<div class="err-block">${esc(msg)}</div>`;
}

// 表单字段错误显示
export function showFieldError(form, name, msg) {
  const field = form.querySelector(`[data-field="${name}"]`);
  if (!field) return;
  let e = field.querySelector('.field-err');
  if (!e) { e = document.createElement('div'); e.className = 'field-err'; field.appendChild(e); }
  e.textContent = msg;
  const input = field.querySelector('.input');
  if (input) input.classList.add('err');
}
export function clearFieldErrors(form) {
  form.querySelectorAll('.field-err').forEach(e => e.remove());
  form.querySelectorAll('.input.err').forEach(e => e.classList.remove('err'));
}

// 任务行事件委托（勾选 / 打开 / 更多菜单）
export function bindTaskRows(container, { onMenu, onCheck }) {
  container.addEventListener('click', e => {
    const open = e.target.closest('[data-open-task]');
    if (open) { location.hash = '#/task/' + open.dataset.openTask; return; }
    const chk = e.target.closest('[data-check]');
    if (chk) { onCheck && onCheck(chk.dataset.check); return; }
    const menu = e.target.closest('[data-task-menu]');
    if (menu) { onMenu && onMenu(menu.dataset.taskMenu); return; }
  });
}