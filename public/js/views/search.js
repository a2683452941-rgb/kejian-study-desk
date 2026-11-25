import { icon } from '../icons.js';
import { esc, TYPE_LABEL, STATUS_LABEL, CAT_LABEL, fmtBytes, isEnded, canPreview } from '../util.js';
import { S, ownerLabel } from '../state.js';
import { empty } from '../ui.js';
import { previewResource } from '../upload.js';

let query = '';
let kindFilter = 'all';
let statusFilter = 'all';
let includeArchived = true;

function match(text, tokens) {
  const t = (text || '').toLowerCase();
  return tokens.every(k => t.includes(k));
}
function hl(text, tokens) {
  let out = esc(text || '');
  for (const k of tokens) {
    if (!k) continue;
    const re = new RegExp('(' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

function archivedOf(item, kind) {
  if (kind === 'course') return item.archived;
  if (kind === 'activity') return item.archived;
  if (kind === 'task') {
    const o = item.ownerType === 'course' ? S.courses.find(c => c.id === item.ownerId) : item.ownerType === 'activity' ? S.activities.find(a => a.id === item.ownerId) : null;
    return !!o?.archived;
  }
  return item.owners.some(o => {
    const p = o.type === 'course' ? S.courses.find(c => c.id === o.id) : o.type === 'activity' ? S.activities.find(a => a.id === o.id) : S.tasks.find(t => t.id === o.id);
    if (!p) return false;
    if (o.type === 'task') return archivedOf(p, 'task');
    return p.archived;
  });
}

function results() {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const out = [];
  for (const c of S.courses) {
    if ((kindFilter === 'all' || kindFilter === 'course') && match(c.name + ' ' + (c.teacher || '') + ' ' + (c.term || ''), tokens)) {
      if (!includeArchived && c.archived) continue;
      out.push({ kind: 'course', item: c, title: c.name, sub: `课程 · ${c.term || '未设学期'}${c.teacher ? ' · ' + c.teacher : ''}`, hash: '#/course/' + c.id });
    }
  }
  for (const a of S.activities) {
    if ((kindFilter === 'all' || kindFilter === 'activity') && match(a.name + ' ' + (a.host || '') + ' ' + (a.location || ''), tokens)) {
      if (!includeArchived && a.archived) continue;
      out.push({ kind: 'activity', item: a, title: a.name, sub: `活动 · ${a.location || '地点待定'}`, hash: '#/activity/' + a.id });
    }
  }
  for (const t of S.tasks) {
    if ((kindFilter === 'all' || kindFilter === 'task') && match(t.title + ' ' + (t.note || ''), tokens)) {
      if (!includeArchived && archivedOf(t, 'task')) continue;
      if (statusFilter === 'open' && isEnded(t)) continue;
      if (statusFilter === 'ended' && !isEnded(t)) continue;
      out.push({ kind: 'task', item: t, title: t.title, sub: `任务 · ${ownerLabel(t)} · ${TYPE_LABEL[t.type]} · ${STATUS_LABEL[t.status]}`, hash: '#/task/' + t.id });
    }
  }
  for (const r of S.resources) {
    if (kindFilter !== 'all' && kindFilter !== 'file') continue;
    const names = [r.title, ...(r.versions || []).map(v => v.name), r.url || ''].join(' ');
    if (!match(names, tokens)) continue;
    if (!includeArchived && archivedOf(r, 'resource')) continue;
    const latest = r.versions?.[r.versions.length - 1];
    out.push({
      kind: 'resource', item: r, title: r.title,
      sub: r.kind === 'link' ? `资料链接 · ${CAT_LABEL[r.category] || '其他'}` : `文件 · ${latest ? fmtBytes(latest.size) : ''} · ${r.versions.length} 个版本 · ${CAT_LABEL[r.category] || '其他'}`,
      hash: null,
    });
  }
  return out;
}

const KIND_ICON = { course: ['book', 'green'], activity: ['flag', 'peach'], task: ['check', 'blue'], resource: ['paperclip', 'lilac'] };

export async function renderSearch(root) {
  const res = results();
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow">FIND ANYTHING</div>
        <h1>搜索</h1>
        <div class="ph-meta">课程、活动、任务、文件名与链接标题 · 空格分词 · 默认包含归档内容</div>
      </div>
    </div>
    <div class="field">
      <input class="input" id="s-input" style="min-height:46px;font-size:13px" placeholder="输入关键词，如 二叉树 / 海报 / 讲座…" value="${esc(query)}">
    </div>
    <div class="filter-bar">
      <select class="input" id="s-kind">
        <option value="all" ${kindFilter === 'all' ? 'selected' : ''}>全部类型</option>
        <option value="course" ${kindFilter === 'course' ? 'selected' : ''}>课程</option>
        <option value="activity" ${kindFilter === 'activity' ? 'selected' : ''}>活动</option>
        <option value="task" ${kindFilter === 'task' ? 'selected' : ''}>任务</option>
        <option value="file" ${kindFilter === 'file' ? 'selected' : ''}>文件 / 链接</option>
      </select>
      <select class="input" id="s-status">
        <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>全部状态</option>
        <option value="open" ${statusFilter === 'open' ? 'selected' : ''}>任务未完成</option>
        <option value="ended" ${statusFilter === 'ended' ? 'selected' : ''}>任务已结束</option>
      </select>
      <label class="row tiny muted" style="gap:6px;cursor:pointer"><input type="checkbox" id="s-arch" ${includeArchived ? 'checked' : ''}> 包含归档</label>
      ${query || kindFilter !== 'all' || statusFilter !== 'all' ? '<button class="text-btn" id="s-clear">清除筛选</button>' : ''}
    </div>
    <div id="s-results">
      ${res === null
        ? empty('search', '想找点什么？', '作业、课件、讲座凭证……输入名字就能找到。首版不检索文件正文。')
        : res.length
          ? `<div class="panel"><div class="panel-body flush">${res.map(r => {
              const [ic, color] = KIND_ICON[r.kind];
              const arch = archivedOf(r.item, r.kind);
              const latest = r.item.versions?.[r.item.versions.length - 1];
              return `
              <div class="search-result" data-hash="${r.hash || ''}" data-res-id="${r.kind === 'resource' ? r.item.id : ''}">
                <div class="sr-icon cat-icon ${color}" style="width:34px;height:34px">${icon(ic, 18)}</div>
                <div class="sr-main">
                  <div class="sr-title">${hl(r.title, tokens)} ${arch ? '<span class="pill gray">来自归档</span>' : ''}</div>
                  <div class="sr-sub">${esc(r.sub)}</div>
                </div>
                ${r.kind === 'resource' && r.item.kind === 'file' && latest ? `
                  ${canPreview(latest.name) ? `<button class="icon-btn" data-s-preview="${r.item.id}" aria-label="预览">${icon('eye', 16)}</button>` : ''}
                  <a class="icon-btn" href="/api/files/${latest.id}/download" aria-label="下载" onclick="event.stopPropagation()">${icon('download', 16)}</a>` : ''}
                ${r.kind === 'resource' && r.item.kind === 'link' ? `<a class="btn sm soft" href="${esc(r.item.url)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">打开原链接</a>` : ''}
              </div>`;
            }).join('')}</div></div>`
          : empty('inbox', '没有找到匹配的内容', '关键词与筛选已保留，可以换个词，或清除筛选再试。', '<button class="btn" id="s-clear2">清除筛选</button>')}
    </div>`;

  const input = root.querySelector('#s-input');
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { query = input.value; renderSearch(root); }, 220);
  });
  root.querySelector('#s-kind').addEventListener('change', e => { kindFilter = e.target.value; renderSearch(root); });
  root.querySelector('#s-status').addEventListener('change', e => { statusFilter = e.target.value; renderSearch(root); });
  root.querySelector('#s-arch').addEventListener('change', e => { includeArchived = e.target.checked; renderSearch(root); });
  const clear = () => { query = ''; kindFilter = 'all'; statusFilter = 'all'; renderSearch(root); };
  root.querySelector('#s-clear')?.addEventListener('click', clear);
  root.querySelector('#s-clear2')?.addEventListener('click', clear);
  root.querySelector('#s-results').addEventListener('click', e => {
    const pv = e.target.closest('[data-s-preview]');
    if (pv) { e.stopPropagation(); previewResource(pv.dataset.sPreview); return; }
    const row = e.target.closest('.search-result');
    if (row && row.dataset.hash) location.hash = row.dataset.hash;
    else if (row && row.dataset.resId) {
      const r = S.resources.find(x => x.id === row.dataset.resId);
      const o = r?.owners[0];
      if (o) location.hash = o.type === 'task' ? '#/task/' + o.id : `#/${o.type}/${o.id}`;
    }
  });
}