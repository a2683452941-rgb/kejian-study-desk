import { icon } from '../icons.js';
import { esc, fmtBytes, fmtDateFull } from '../util.js';
import { S, refresh, clearState, now, notify } from '../state.js';
import { api } from '../api.js';
import { toast, openDialog, confirmDialog, switchHtml, empty, errBlock } from '../ui.js';

async function patchSettings(body) {
  const res = await api.patch('/api/me/settings', body);
  S.user = res.user; S.digest = res.digest;
  await refresh();
  return res;
}

function openEmailChange() {
  const d = openDialog({
    title: '更换登录邮箱',
    eyebrow: 'CHANGE EMAIL',
    body: `
      <div id="ec-stage1">
        <div class="field-hint" style="margin-bottom:12px">当前邮箱：<b>${esc(S.user.email)}</b>。更换后使用新邮箱登录，学习数据保持在本账户内，不会丢失。</div>
        <div data-field="email" class="field"><label>新邮箱 <span class="req">*</span></label><input type="email" class="input" id="ec-email" placeholder="new@example.edu.cn"></div>
      </div>
      <div id="ec-stage2" style="display:none">
        <div class="code-hint" id="ec-devhint"></div>
        <div data-field="code" class="field"><label>验证码 <span class="req">*</span></label><input class="input" id="ec-code" inputmode="numeric" maxlength="6" placeholder="6 位数字"></div>
        <div class="field-hint">验证码 10 分钟内有效。更换成功后本页邮箱即刻更新。</div>
      </div>
      <div id="ec-err"></div>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" id="ec-next">发送验证码</button>`,
  });
  const err = d.body.querySelector('#ec-err');
  const fail = m => { err.innerHTML = errBlock(m); };
  d.foot.querySelector('[data-cancel]').addEventListener('click', d.close);
  const next = d.foot.querySelector('#ec-next');
  let stage = 1;
  next.addEventListener('click', async () => {
    err.innerHTML = '';
    next.disabled = true;
    try {
      if (stage === 1) {
        const email = d.body.querySelector('#ec-email').value.trim();
        const res = await api.post('/api/me/email/request', { email });
        d.body.querySelector('#ec-stage1').style.display = 'none';
        d.body.querySelector('#ec-stage2').style.display = '';
        d.body.querySelector('#ec-devhint').innerHTML =
          `本环境未接入邮件服务，验证码直接展示在这里：<b>${esc(res.devCode)}</b><br><span class="tiny">正式部署接入邮件后将发送至新邮箱。</span>`;
        next.textContent = '确认更换';
        stage = 2;
        d.body.querySelector('#ec-code').focus();
      } else {
        const code = d.body.querySelector('#ec-code').value.trim();
        await api.post('/api/me/email/verify', { code });
        d.close();
        await refresh();
        toast('邮箱已更换，下次请用新邮箱登录');
      }
    } catch (e) { fail(e.message); }
    finally { next.disabled = false; }
  });
}

function openDigestPreview() {
  const d = openDialog({ title: '今日摘要预览', eyebrow: 'DIGEST PREVIEW', body: '<div class="loading"><div class="spinner"></div><div class="l-text">正在整理今天该提醒的事…</div></div>' });
  api.get('/api/digest').then(res => {
    const SEC = { overdue: '已逾期', today: '今日到期', upcoming: '即将到期', plan: '今日计划' };
    d.setBody(res.preview.length
      ? `<div class="field-hint" style="margin-bottom:12px">按当前状态实时计算。实际发送时会在 ${esc(S.user.settings.digestTime)} 再读取一次最新状态；内容为空则不发送、不占用当日批次。</div>` +
        res.preview.map(i => `<div class="batch-row"><span class="pill ${i.section === 'overdue' ? 'red' : i.section === 'today' ? 'peach' : i.section === 'plan' ? 'green' : 'blue'}">${SEC[i.section]}</span><span style="flex:1">${esc(i.title)}</span></div>`).join('')
      : empty('leaf', '今天没有要提醒的内容', '这样的日子，摘要邮件会安静地跳过。'));
  }).catch(e => d.setBody(errBlock(e.message)));
}

export async function renderSettings(root) {
  const u = S.user, st = u.settings, usage = S.usage;
  const pct = Math.min(100, usage.used / usage.limit * 100);
  const batches = [...S.batches].reverse();

  root.innerHTML = `
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow">YOUR OWN PACE</div>
        <h1>设置</h1>
        <div class="ph-meta">账户、提醒与存储 · 所有时间均按北京时间（Asia/Shanghai）计算，不可修改</div>
      </div>
    </div>
    ${u.demo ? `<div class="demo-banner" style="margin-bottom:20px">${icon('info', 18)}<span>这是隔离的示例空间：数据 24 小时后自动清理，与真实账户互不影响。想长期使用，请退出后用邮箱登录。</span></div>` : ''}
    <div class="settings-grid">
      <div>
        <div class="settings-card" style="margin-bottom:20px">
          <h3>账户</h3>
          <div class="sc-sub">数据只属于这个邮箱对应的账户，别人无法访问。</div>
          <div class="row" style="justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div>
              <div class="tiny muted">登录邮箱</div>
              <div style="font-size:13px;font-weight:550;margin-top:3px">${esc(u.email)}</div>
            </div>
            <button class="btn sm" id="set-email">${icon('mail', 15)} 更换邮箱</button>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
            <div><div class="tiny muted">时区</div><div style="font-size:12px;margin-top:3px">北京时间 Asia/Shanghai · 固定</div></div>
            <span class="pill gray">不可修改</span>
          </div>
          <div class="row" style="justify-content:space-between;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)">
            <div><div class="tiny muted">当前时间</div><div style="font-size:12px;margin-top:3px">${esc(fmtDateFull(now().date))} ${esc(now().time)}</div></div>
            <button class="btn sm danger" id="set-logout">${icon('logout', 15)} 退出登录</button>
          </div>
        </div>

        <div class="settings-card" style="margin-bottom:20px">
          <h3>新任务的默认提醒</h3>
          <div class="sc-sub">只影响之后新建的任务；已有任务的提醒在各自详情里单独调整。</div>
          <div data-field="channel" class="field">
            <label>提醒渠道</label>
            <select class="input" id="set-channel">
              <option value="inapp" ${st.defaultChannel === 'inapp' ? 'selected' : ''}>仅站内提醒</option>
              <option value="both" ${st.defaultChannel === 'both' ? 'selected' : ''}>站内 + 每日邮件摘要</option>
            </select>
            ${st.defaultChannel === 'both' && !st.digestEnabled ? '<div class="field-hint">每日摘要尚未开启，选择“站内 + 邮件”的任务暂时只收到站内提醒。</div>' : ''}
          </div>
          <div data-field="lead" class="field">
            <label>默认提前提醒天数</label>
            <input type="number" class="input" id="set-lead" min="0" max="365" step="1" value="${st.defaultLead}">
            <div class="field-hint">截止前 0—365 天进入“即将到期”提醒，0 表示仅当天提醒。</div>
          </div>
        </div>

        <div class="settings-card">
          <h3>存储容量</h3>
          <div class="sc-sub">所有版本都计入容量；共享资料只按一份计算。</div>
          <div class="storage-bar" style="height:6px"><div class="storage-fill" style="width:${pct}%"></div></div>
          <div class="storage-meta"><span>已用 ${fmtBytes(usage.used)}</span><span>共 ${fmtBytes(usage.limit)}</span></div>
          <div class="field-hint" style="margin-top:10px">单个文件上限 ${fmtBytes(usage.fileLimit)}（100,000,000 字节）；账户总上限 ${fmtBytes(usage.limit)}（2,000,000,000 字节）。删除文件版本后容量立即释放。</div>
        </div>
      </div>

      <div>
        <div class="settings-card" style="margin-bottom:20px">
          <h3>每日邮件摘要</h3>
          <div class="sc-sub">每天一封，汇总逾期、今日到期、即将到期与今日计划。</div>
          ${!S.mailConfigured ? `<div class="demo-banner" style="margin:0 0 14px">${icon('info', 18)}<span>本环境未配置邮件通道：摘要批次会按时生成并如实记录，但不会实际投递。接入发信服务后即可送达。</span></div>` : ''}
          ${switchHtml('set-digest', st.digestEnabled, '开启每日摘要', st.digestEnabled ? `每天 ${esc(st.digestTime)} 生成当日批次` : '默认关闭，开启前会先说明规则')}
          <div id="digest-detail" ${st.digestEnabled ? '' : 'style="display:none"'}>
            <div data-field="time" class="field" style="margin-top:10px">
              <label>发送时刻（北京时间）</label>
              <input type="time" class="input" id="set-time" value="${esc(st.digestTime)}">
              <div class="field-hint">当天已生成批次则不再重复发送；把时刻改到已过去的时间，将从次日开始生效。当天没有可提醒内容时不发送、不占用机会。</div>
            </div>
            <div class="row" style="justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:6px">
              <div class="tiny muted">下一批次：${esc(S.digest?.next || '—')}</div>
              <button class="btn sm soft" id="set-preview">${icon('eye', 15)} 预览今日内容</button>
            </div>
          </div>
        </div>

        <div class="settings-card">
          <h3>摘要批次记录</h3>
          <div class="sc-sub">每人每自然日最多一个批次，以下为最近记录。</div>
          <div id="batch-list">
            ${batches.length ? batches.map(b => `
              <div class="batch-row">
                <span class="pill ${b.status === 'sent' ? 'green' : 'gray'}">${b.status === 'sent' ? '已发送' : '已记录 · 未投递'}</span>
                <span style="flex:1">${esc(b.date)} · ${esc((b.plannedAt || '').slice(11, 16))} · ${b.itemCount} 项</span>
                <button class="text-btn" data-batch="${b.id}">查看</button>
              </div>`).join('')
            : '<div class="tiny muted" style="line-height:1.9;padding:6px 0">还没有生成过摘要批次。开启后，每天到点会在这里留下记录。</div>'}
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#set-email').addEventListener('click', openEmailChange);
  root.querySelector('#set-logout').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: '退出登录', message: '退出后需要重新用邮箱验证码登录。你的数据都保存在账户里，不会丢失。', confirmText: '退出' });
    if (!ok) return;
    await api.post('/api/auth/logout');
    clearState();
    toast('已退出登录');
    location.hash = '#/';
    notify();
  });
  root.querySelector('#set-channel').addEventListener('change', async e => {
    try { await patchSettings({ defaultChannel: e.target.value }); toast('已更新新任务的默认提醒渠道'); }
    catch (err) { toast(err.message, 'err'); e.target.value = st.defaultChannel; }
  });
  const leadInput = root.querySelector('#set-lead');
  leadInput.addEventListener('change', async () => {
    try { await patchSettings({ defaultLead: Number(leadInput.value) }); toast('已更新默认提前天数'); }
    catch (err) { toast(err.message, 'err'); leadInput.value = st.defaultLead; }
  });
  root.querySelector('#set-digest').addEventListener('change', async e => {
    if (e.target.checked && !st.digestConfirmed) {
      const ok = await confirmDialog({
        title: '开启每日邮件摘要',
        message: `每天 <b>${esc(st.digestTime)}</b>（北京时间）汇总一次：已逾期、今日到期、即将到期与今日计划。<br><br>· 每人每天最多一个批次，不重复发送；<br>· 当天没有内容就不发送，也不占用当日机会；<br>· 已逾期的任务是否进入邮件，遵循各任务自己的提醒设置。${S.mailConfigured ? '' : '<br><br><b>注意：本环境未配置邮件通道，批次只会生成并记录，不会实际投递。</b>'}`,
        confirmText: '了解并开启',
      });
      if (!ok) { e.target.checked = false; return; }
    }
    try {
      await patchSettings({ digestEnabled: e.target.checked });
      toast(e.target.checked ? '每日摘要已开启' : '每日摘要已关闭，站内提醒不受影响');
    } catch (err) { toast(err.message, 'err'); e.target.checked = st.digestEnabled; }
  });
  root.querySelector('#set-time').addEventListener('change', async e => {
    if (!e.target.value) { e.target.value = st.digestTime; return; }
    try {
      await patchSettings({ digestTime: e.target.value });
      toast('发送时刻已更新');
    } catch (err) { toast(err.message, 'err'); e.target.value = st.digestTime; }
  });
  root.querySelector('#set-preview').addEventListener('click', openDigestPreview);
  root.querySelector('#batch-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-batch]');
    if (!btn) return;
    const b = S.batches.find(x => x.id === btn.dataset.batch);
    if (!b) return;
    const SEC = { overdue: '已逾期', today: '今日到期', upcoming: '即将到期', plan: '今日计划' };
    openDialog({
      title: `${b.date} 的摘要批次`,
      eyebrow: 'DIGEST BATCH',
      body: `
        <div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <span class="pill ${b.status === 'sent' ? 'green' : 'gray'}">${b.status === 'sent' ? '已发送' : '已记录 · 未投递'}</span>
          <span class="tiny muted">计划时刻 ${esc((b.plannedAt || '').slice(11, 16))} · ${b.itemCount} 项</span>
        </div>
        ${b.note ? `<div class="demo-banner" style="margin:0 0 12px">${icon('info', 18)}<span>${esc(b.note)}</span></div>` : ''}
        ${(b.items || []).map(i => `<div class="batch-row"><span class="pill ${i.section === 'overdue' ? 'red' : i.section === 'today' ? 'peach' : i.section === 'plan' ? 'green' : 'blue'}">${SEC[i.section] || i.section}</span><span style="flex:1">${esc(i.title)}</span></div>`).join('') || '<div class="tiny muted">本批次没有条目。</div>'}`,
    });
  });
}