import { api, uploadFile } from './api.js';
import { icon } from './icons.js';
import { esc, fmtBytes, relTime, fileKind, fileExt, canPreview, CAT_LABEL, uid } from './util.js';
import { S, now, refresh, resource, task, ownerLabel } from './state.js';
import { openDialog, confirmDialog, toast, empty } from './ui.js';
import { openLinkForm, openTaskForm } from './forms.js';

const FILE_LIMIT = 100_000_000;

// ================= 上传组件 =================
export function mountUpload(container, { ownerType, ownerId, category = 'other', onDone }) {
  container.innerHTML = `
    <div class="dropzone" tabindex="0" role="button" aria-label="上传文件">
      ${icon('upload', 24)}
      <div>点击选择或拖拽文件到此处</div>
      <div class="dz-sub">单文件 ≤ 100 MB · 支持文档 / 图片 / 音视频 / 压缩包 / 代码 / 工程文件 · 多文件工程建议打包上传</div>
    </div>
    <input type="file" multiple hidden>
    <div class="upload-queue"></div>`;
  const dz = container.querySelector('.dropzone');
  const input = container.querySelector('input[type=file]');
  const queue = container.querySelector('.upload-queue');
  const items = new Map();

  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); handleFiles([...e.dataTransfer.files]); });
  input.addEventListener('change', () => { handleFiles([...input.files]); input.value = ''; });

  function renderQueue() {
    queue.innerHTML = [...items.values()].map(it => `
      <div class="file-row" data-q="${it.id}">
        <div class="file-type ${fileKind(it.file.name)}">${esc(fileExt(it.file.name))}</div>
        <div class="file-info">
          <div class="file-name">${esc(it.file.name)}</div>
          <div class="file-meta">
            <span>${fmtBytes(it.file.size)}</span>
            <span class="upload-status ${it.status}">${{ waiting: '等待上传', uploading: `上传中 ${Math.round(it.progress * 100)}%`, success: '已保存', failed: '失败：' + esc(it.error || ''), cancelled: '已取消' }[it.status]}</span>
          </div>
          ${it.status === 'uploading' ? `<div class="upload-progress"><div class="bar" style="width:${Math.round(it.progress * 100)}%"></div></div>` : ''}
        </div>
        <div class="file-actions">
          ${it.status === 'failed' ? `<button class="btn sm soft" data-retry="${it.id}">${icon('refresh', 13)} 重试</button>` : ''}
          ${it.status === 'uploading' || it.status === 'waiting' ? `<button class="btn sm" data-cancel="${it.id}">取消</button>` : ''}
          ${it.status === 'success' || it.status === 'cancelled' ? `<button class="icon-btn" data-dismiss="${it.id}" aria-label="移除">${icon('x', 15)}</button>` : ''}
        </div>
      </div>`).join('');
  }

  queue.addEventListener('click', e => {
    const r = e.target.closest('[data-retry]'); if (r) { const it = items.get(r.dataset.retry); it.status = 'waiting'; it.error = ''; start(it); return; }
    const c = e.target.closest('[data-cancel]'); if (c) { const it = items.get(c.dataset.cancel); it.handle?.abort(); it.status = 'cancelled'; renderQueue(); return; }
    const dsm = e.target.closest('[data-dismiss]'); if (dsm) { items.delete(dsm.dataset.dismiss); renderQueue(); }
  });

  async function handleFiles(files) {
    if (!files.length) return;
    const usage = S.usage;
    for (const file of files) {
      const it = { id: uid(), file, status: 'waiting', progress: 0, error: '', handle: null };
      items.set(it.id, it);
      if (file.size > FILE_LIMIT) { it.status = 'failed'; it.error = '超过单文件 100 MB 限制'; continue; }
      if (file.size > (usage.limit - usage.used)) { it.status = 'failed'; it.error = '总容量不足，可改用外链或清理文件'; continue; }
    }
    renderQueue();
    for (const it of items.values()) if (it.status === 'waiting') await start(it);
    renderQueue();
    if ([...items.values()].some(i => i.status === 'success')) { await refresh(); onDone && onDone(); }
  }

  async function start(it, opts = {}) {
    if (!opts.mode && !opts.forceNew) {
      const same = S.resources.find(r => r.kind === 'file'
        && r.owners.some(o => o.type === ownerType && o.id === ownerId)
        && (r.versions || []).some(v => v.name === it.file.name));
      if (same) {
        const choice = await sameNameDialog(it.file.name);
        if (choice === 'new') return start(it, { forceNew: true });
        if (choice === 'version') return start(it, { mode: 'version', resourceId: same.id });
        it.status = 'cancelled'; renderQueue(); return;
      }
    }
    it.status = 'uploading'; it.progress = 0; renderQueue();
    const { promise, abort } = uploadFile({
      file: it.file, ownerType, ownerId, category,
      mode: opts.mode || 'new', resourceId: opts.resourceId, forceNew: opts.forceNew,
      onProgress: p => { it.progress = p; const bar = queue.querySelector(`[data-q="${it.id}"] .bar`); if (bar) bar.style.width = Math.round(p * 100) + '%'; const st = queue.querySelector(`[data-q="${it.id}"] .upload-status`); if (st) st.textContent = `上传中 ${Math.round(p * 100)}%`; },
    });
    it.handle = { abort };
    try {
      await promise;
      it.status = 'success'; it.progress = 1;
    } catch (err) {
      if (err.code === 'cancelled') { it.status = 'cancelled'; }
      else if (err.code === 'same_name') {
        renderQueue();
        const choice = await sameNameDialog(it.file.name);
        if (choice === 'new') return start(it, { forceNew: true });
        if (choice === 'version') return start(it, { mode: 'version', resourceId: err.extra.resourceId });
        it.status = 'cancelled';
      } else {
        it.status = 'failed'; it.error = err.message;
      }
    }
    renderQueue();
  }
}

function sameNameDialog(name) {
  return new Promise(resolve => {
    let done = false;
    const d = openDialog({
      title: '已存在同名文件',
      body: `<div style="font-size:12px;line-height:1.9">「${esc(name)}」与已有附件同名。同名文件不会被静默覆盖，请选择处理方式：</div>`,
      footer: `<button class="btn" data-c>取消</button><button class="btn soft" data-v>上传新版</button><button class="btn primary" data-n>作为新附件</button>`,
      onClose: () => { if (!done) { done = true; resolve(null); } },
    });
    const fin = v => { done = true; d.close(); resolve(v); };
    d.foot.querySelector('[data-c]').addEventListener('click', () => fin(null));
    d.foot.querySelector('[data-v]').addEventListener('click', () => fin('version'));
    d.foot.querySelector('[data-n]').addEventListener('click', () => fin('new'));
  });
}

// ================= 资料列表 =================
export function resourceListHtml(items, { showSource = false } = {}) {
  if (!items.length) return empty('paperclip', '这里还空着', '课件、海报、凭证或一个链接，都可以放在这里。');
  return items.map(({ r, from }) => {
    const latest = r.versions?.[r.versions.length - 1];
    const finalV = r.versions?.find(v => v.final);
    const isLink = r.kind === 'link';
    const kind = isLink ? 'other' : fileKind(latest?.name || '');
    return `
    <div class="file-row" data-res="${r.id}">
      <div class="file-type ${isLink ? 'other' : kind}">${isLink ? 'link' : esc(fileExt(latest?.name || ''))}</div>
      <div class="file-info">
        <div class="file-name">${esc(r.title)} ${finalV ? '<span class="final-tag">最终提交版</span>' : ''}</div>
        <div class="file-meta">
          <span class="pill gray">${CAT_LABEL[r.category] || '其他'}</span>
          ${isLink
            ? `<span>外链 · 不计容量</span>`
            : `<span>${fmtBytes(latest?.size || 0)}</span><span>${r.versions.length} 个版本</span><span>${relTime(latest?.uploadedAt || r.createdAt, now().ms)}上传</span>`}
          ${showSource && from ? `<span class="pill blue">来自任务 · ${esc(from.title)}</span>` : ''}
          ${r.owners.length > 1 ? `<span class="pill lilac">${r.owners.length} 处引用</span>` : ''}
        </div>
      </div>
      <div class="file-actions">
        ${isLink
          ? `<a class="btn sm soft" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${icon('link', 13)} 打开原链接</a>`
          : `${canPreview(latest?.name || '') ? `<button class="icon-btn" data-preview="${r.id}" title="预览" aria-label="预览">${icon('eye', 17)}</button>` : ''}
             <a class="icon-btn" href="/api/files/${latest?.id}/download" title="下载原文件" aria-label="下载">${icon('download', 17)}</a>`}
        <button class="icon-btn" data-res-menu="${r.id}" aria-label="更多操作">${icon('more', 17)}</button>
      </div>
    </div>`;
  }).join('');
}

export function bindResourceList(container, { ownerType, ownerId, onChanged }) {
  container.addEventListener('click', async e => {
    const pv = e.target.closest('[data-preview]');
    if (pv) { previewResource(pv.dataset.preview); return; }
    const menu = e.target.closest('[data-res-menu]');
    if (menu) { resourceMenu(menu.dataset.resMenu, { ownerType, ownerId, onChanged }); return; }
  });
}

export function previewResource(rid) {
  const r = resource(rid); if (!r) return;
  const latest = r.versions[r.versions.length - 1];
  if (!latest || !canPreview(latest.name)) { toast('该类型不支持预览，请下载后查看', 'err'); return; }
  const isPdf = latest.name.toLowerCase().endsWith('.pdf');
  const d = openDialog({
    title: r.title, eyebrow: 'PREVIEW', wide: true,
    body: isPdf
      ? `<iframe src="/api/files/${latest.id}/preview" style="width:100%;height:62vh;border:1px solid var(--line);border-radius:10px" title="PDF 预览"></iframe>
         <div class="field-hint mt-sm">若设备无法内嵌显示 PDF，可下载后查看。</div>`
      : `<div style="text-align:center"><img src="/api/files/${latest.id}/preview" alt="${esc(r.title)}" style="max-width:100%;max-height:62vh;border-radius:10px;border:1px solid var(--line)" onerror="this.outerHTML='<div class=err-block>预览加载失败，文件仍然存在，可下载原文件查看。</div>'"></div>`,
    footer: `<a class="btn" href="/api/files/${latest.id}/download">${icon('download', 15)} 下载原文件</a><button class="btn primary" data-close2>关闭</button>`,
  });
  d.foot.querySelector('[data-close2]').addEventListener('click', d.close);
}

function resourceMenu(rid, { ownerType, ownerId, onChanged }) {
  const r = resource(rid); if (!r) return;
  const isLink = r.kind === 'link';
  const d = openDialog({
    title: r.title, eyebrow: 'RESOURCE',
    body: `
      <div class="col gap-sm mb">
        ${!isLink ? `
          <button class="btn block" data-a="versions">${icon('list')} 查看历史版本（${r.versions.length}）</button>
          <button class="btn block" data-a="newver">${icon('upload')} 上传新版…</button>
          <button class="btn block" data-a="link-task">${icon('paperclip')} 关联到任务…</button>
          <button class="btn block" data-a="from-res">${icon('plus')} 以此资料创建关联任务</button>` : ''}
        <button class="btn block" data-a="edit">${icon('edit')} 编辑标题 / 分类${isLink ? ' / 链接' : ''}</button>
        <button class="btn block danger" data-a="del">${icon('trash')} 删除资料…</button>
      </div>
      ${!isLink ? '<div class="field-hint">云端文件不会自动跟随本地文件更新；“上传新版”会保留旧版本，所有版本计入容量。</div>' : '<div class="field-hint">外链由来源平台控制访问与下载，失效时可修改或删除，不影响关联任务。</div>'}
      <div id="ver-area"></div>`,
  });
  d.body.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'edit') { d.close(); editResource(r, ownerType, ownerId); }
    if (a === 'del') { d.close(); deleteResource(r); }
    if (a === 'versions') renderVersions(d.body.querySelector('#ver-area'), r);
    if (a === 'newver') { d.close(); pickNewVersion(r); }
    if (a === 'link-task') { d.close(); linkToTask(r); }
    if (a === 'from-res') {
      d.close();
      openTaskForm({
        ownerType, ownerId,
        preset: { title: r.title, note: `关联资料：${r.title}`, type: 'homework', stay: true },
        onCreated: async (t) => {
          try { await api.patch('/api/resources/' + r.id, { addOwner: { type: 'task', id: t.id }, v: r.v }); await refresh(); toast('已创建任务并关联资料（不复制文件）'); }
          catch { await refresh(); }
        },
      });
    }
  });
}

function renderVersions(area, r) {
  const vb = area.parentNode.querySelector('[data-a="versions"]');
  if (vb) vb.innerHTML = `${icon('list')} 查看历史版本（${r.versions.length}）`;
  area.innerHTML = `<hr class="sep"><div class="small muted mb-sm">历史版本（全部计入容量，可下载或删除指定版本）</div>` +
    [...r.versions].reverse().map((v, i) => `
      <div class="version-row">
        <span class="pill ${i === 0 ? 'green' : 'gray'}">${i === 0 ? '最新版本' : '旧版本'}</span>
        <span class="v-name">${esc(v.name)} ${v.final ? '<span class="final-tag">最终提交版</span>' : ''}</span>
        <span class="muted tiny">${fmtBytes(v.size)}</span>
        <a class="icon-btn" href="/api/files/${v.id}/download" aria-label="下载该版本">${icon('download', 15)}</a>
        <button class="icon-btn" data-final="${v.id}" title="${v.final ? '取消最终版标记' : '标为最终提交版'}" aria-label="最终版标记">${icon('award', 15)}</button>
        <button class="icon-btn" data-delver="${v.id}" aria-label="删除该版本">${icon('trash', 15)}</button>
      </div>`).join('');
  area.querySelectorAll('[data-final]').forEach(btn => btn.addEventListener('click', async () => {
    const v = r.versions.find(x => x.id === btn.dataset.final);
    await api.patch(`/api/resources/${r.id}/versions/${v.id}`, { final: !v.final });
    toast(v.final ? '已取消最终版标记' : '已标记为最终提交版');
    await refresh(); renderVersions(area, resource(r.id));
  }));
  area.querySelectorAll('[data-delver]').forEach(btn => btn.addEventListener('click', async () => {
    const v = r.versions.find(x => x.id === btn.dataset.delver);
    const ok = await confirmDialog({
      title: '删除该版本',
      message: `「${esc(v.name)}」将被永久删除。${v.final ? '<br><b>该版本是最终提交版，删除后标记会一并移除。</b>' : ''}${r.versions.length === 1 ? '<br>这是最后一个版本，删除后整条资料将被移除。' : ''}`,
      confirmText: '删除版本', danger: true,
    });
    if (!ok) return;
    await api.del(`/api/resources/${r.id}/versions/${v.id}`);
    toast('版本已删除'); await refresh();
    const nr = resource(r.id);
    if (nr) renderVersions(area, nr); else area.innerHTML = '<div class="field-hint mt">资料已移除。</div>';
  }));
}

function pickNewVersion(r) {
  const input = document.createElement('input');
  input.type = 'file';
  input.addEventListener('change', async () => {
    const file = input.files[0]; if (!file) return;
    if (file.size > FILE_LIMIT) { toast('超过单文件 100 MB 限制', 'err'); return; }
    toast('正在上传新版…');
    const { promise } = uploadFile({ file, ownerType: r.owners[0].type, ownerId: r.owners[0].id, mode: 'version', resourceId: r.id });
    try { await promise; toast('新版已上传，旧版本保留'); await refresh(); }
    catch (err) { toast(err.message, 'err'); }
  });
  input.click();
}

function linkToTask(r) {
  const options = S.tasks.filter(t => !r.owners.some(o => o.type === 'task' && o.id === t.id))
    .map(t => `<option value="${t.id}">${esc(t.title)}（${esc(ownerLabel(t))}）</option>`).join('');
  const d = openDialog({
    title: '关联到任务', eyebrow: 'LINK RESOURCE',
    body: `<div class="field"><label>选择任务</label><select class="input" id="lt-sel">${options || '<option value="">没有可关联的任务</option>'}</select></div>
      <div class="field-hint">关联不复制文件、不重复占用容量。</div>`,
    footer: `<button class="btn" data-c>取消</button><button class="btn primary" data-ok>关联</button>`,
  });
  d.foot.querySelector('[data-c]').addEventListener('click', d.close);
  d.foot.querySelector('[data-ok]').addEventListener('click', async () => {
    const id = d.body.querySelector('#lt-sel').value;
    if (!id) { toast('请先创建任务', 'err'); return; }
    try { await api.patch('/api/resources/' + r.id, { addOwner: { type: 'task', id }, v: r.v }); toast('已关联'); d.close(); await refresh(); }
    catch (err) { toast(err.message, 'err'); }
  });
}

function editResource(r, ownerType, ownerId) {
  if (r.kind === 'link') { openLinkForm({ ownerType, ownerId, resource: r }); return; }
  const d = openDialog({
    title: '编辑资料', eyebrow: 'EDIT RESOURCE',
    body: `
      <div class="field"><label>标题</label><input class="input" id="er-title" value="${esc(r.title)}"></div>
      <div class="field"><label>分类</label><select class="input" id="er-cat">${Object.entries(CAT_LABEL).map(([k, v]) => `<option value="${k}" ${r.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="field"><label>备注</label><textarea class="input" id="er-note">${esc(r.note || '')}</textarea></div>`,
    footer: `<button class="btn" data-c>取消</button><button class="btn primary" data-ok>保存</button>`,
  });
  d.foot.querySelector('[data-c]').addEventListener('click', d.close);
  d.foot.querySelector('[data-ok]').addEventListener('click', async () => {
    try {
      await api.patch('/api/resources/' + r.id, { title: d.body.querySelector('#er-title').value.trim(), category: d.body.querySelector('#er-cat').value, note: d.body.querySelector('#er-note').value, v: r.v });
      toast('资料已保存'); d.close(); await refresh();
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function deleteResource(r) {
  const finalV = r.versions?.find(v => v.final);
  const ok = await confirmDialog({
    title: '永久删除资料',
    message: `「${esc(r.title)}」将被永久删除${r.kind === 'file' ? `（含 ${r.versions.length} 个版本）` : ''}。<br>
      当前被 <b>${r.owners.length}</b> 处引用，删除后这些关联都会失去该资料。${finalV ? '<br><b>其中包含最终提交版，标记将一并移除。</b>' : ''}<br>
      <span class="muted tiny">删除资料不会改变任务状态。</span>`,
    confirmText: '永久删除', danger: true,
  });
  if (!ok) return;
  await api.del('/api/resources/' + r.id);
  toast('资料已删除'); await refresh();
}