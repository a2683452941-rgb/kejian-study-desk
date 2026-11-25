import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc } from '../util.js';
import { toast } from '../ui.js';

export function renderLogin(root, onLogin) {
  root.innerHTML = `
  <div class="login-wrap">
    <div class="login-story">
      <div class="brand">
        <div class="brand-logo">${icon('book', 20)}<span class="dot"></span></div>
        <div><div class="brand-name">课间</div><div class="brand-sub">STUDY DESK</div></div>
      </div>
      <div class="eyebrow">A LITTLE MORE ORGANIZED</div>
      <h1 class="login-hero">把琐事放好，<br>把时间<em>留给自己</em>。</h1>
      <p class="login-narrative">
        作业通知、课件资料、讲座凭证、还有那些总被忘掉的截止时间——
        它们值得一个安静的落脚处。在这里，一件事连着它的资料、它的时间，
        和你打算什么时候去做。写完了，就亲手画上那个勾。
      </p>
      <div class="login-preview">
        <div class="pv-head">近期截止 · PREVIEW</div>
        <div class="pv-row"><span class="pv-check done"></span><span class="pv-title">作业二 · 线性表应用</span><span class="pv-badge" style="background:var(--cat-green-bg);color:var(--cat-green-fg)">已提交</span></div>
        <div class="pv-row"><span class="pv-check"></span><span class="pv-title">作业三 · 二叉树的遍历</span><span class="pv-badge">明天截止</span></div>
        <div class="pv-row"><span class="pv-check"></span><span class="pv-title">讲座签到 · 图书馆报告厅</span><span class="pv-badge">今天 18:30</span></div>
      </div>
      <div class="login-foot">给学习，留一点从容 · SINCE 2026</div>
    </div>
    <div class="login-form-side">
      <div class="login-form">
        <div class="eyebrow">WELCOME BACK</div>
        <h2>登录 / 注册</h2>
        <div class="sub">使用邮箱验证码进入你的学习空间，首次验证即创建账户。</div>
        <div id="login-err"></div>
        <div id="code-hint"></div>
        <form id="login-form" novalidate>
          <div class="field" data-field="email">
            <label>邮箱地址</label>
            <input class="input login-input" name="email" type="email" placeholder="you@university.edu.cn" autocomplete="email">
          </div>
          <div class="field hidden" id="code-field" data-field="code">
            <label>验证码</label>
            <input class="input login-input" name="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" autocomplete="one-time-code">
          </div>
          <button class="btn primary block login-input" type="submit" id="login-submit">获取验证码</button>
        </form>
        <div class="login-divider">或</div>
        <button class="btn soft block" id="demo-btn">${icon('sparkles', 16)} 进入隔离示例空间</button>
        <div class="login-note">
          示例空间使用独立账户与演示资料，24 小时后自动清理，不影响真实账户。<br>
          首版统一使用北京时间（Asia/Shanghai）。登录邮件与每日摘要用途不同，关闭摘要不影响登录。
        </div>
      </div>
    </div>
  </div>`;

  const form = root.querySelector('#login-form');
  const errBox = root.querySelector('#login-err');
  const hintBox = root.querySelector('#code-hint');
  const codeField = root.querySelector('#code-field');
  const submit = root.querySelector('#login-submit');
  let stage = 'email';
  let lastSent = 0;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    errBox.innerHTML = '';
    const email = form.email.value.trim();
    if (stage === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errBox.innerHTML = '<div class="err-block">请填写有效的邮箱地址</div>'; return;
      }
      submit.disabled = true; submit.textContent = '正在发送…';
      try {
        const res = await api.post('/api/auth/request-code', { email });
        stage = 'code'; lastSent = Date.now();
        codeField.classList.remove('hidden');
        submit.textContent = '登录 / 注册';
        hintBox.innerHTML = `<div class="code-hint">${esc(res.note || '')}<br>本次验证码：<b>${esc(res.devCode)}</b>（10 分钟内有效）</div>`;
        form.code.focus();
      } catch (err) {
        errBox.innerHTML = `<div class="err-block">${esc(err.message)}</div>`;
        submit.textContent = '获取验证码';
      } finally { submit.disabled = false; }
    } else {
      const code = form.code.value.trim();
      if (!/^\d{6}$/.test(code)) { errBox.innerHTML = '<div class="err-block">请输入 6 位数字验证码</div>'; return; }
      submit.disabled = true; submit.textContent = '正在进入…';
      try {
        await api.post('/api/auth/verify', { email, code });
        toast('欢迎回到课间');
        await onLogin();
      } catch (err) {
        errBox.innerHTML = `<div class="err-block">${esc(err.message)}</div>`;
        submit.disabled = false; submit.textContent = '登录 / 注册';
      }
    }
  });

  root.querySelector('#demo-btn').addEventListener('click', async () => {
    const btn = root.querySelector('#demo-btn');
    btn.disabled = true; btn.textContent = '正在准备示例空间…';
    try {
      await api.post('/api/auth/demo');
      toast('已进入示例空间');
      await onLogin();
    } catch (err) {
      errBox.innerHTML = `<div class="err-block">${esc(err.message)}</div>`;
      btn.disabled = false; btn.innerHTML = icon('sparkles', 16) + ' 进入隔离示例空间';
    }
  });
}