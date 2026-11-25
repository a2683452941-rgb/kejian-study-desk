import { icon } from './icons.js';
import { esc } from './util.js';
import { S, loadState, refresh, clearState, onStateChange, now } from './state.js';
import { toast, loading } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { renderCourses, renderActivities } from './views/lists.js';
import { renderCourse } from './views/course.js';
import { renderActivity } from './views/activity.js';
import { renderTask } from './views/task.js';
import { renderPlan } from './views/plan.js';
import { renderSearch } from './views/search.js';
import { renderAlerts } from './views/alerts.js';
import { renderSettings } from './views/settings.js';
import { openAI } from './views/ai.js';
import { openTaskForm } from './forms.js';

const app = document.getElementById('app');

const NAV = [
  { id: 'home', hash: '#/', label: '首页', icon: 'home', group: '总览' },
  { id: 'courses', hash: '#/courses', label: '我的作业', icon: 'book', group: '总览', desktopOnly: true },
  { id: 'activities', hash: '#/activities', label: '我的活动', icon: 'flag', group: '总览', desktopOnly: true },
  { id: 'plan', hash: '#/plan', label: '计划中心', icon: 'calendar', group: '管理' },
  { id: 'alerts', hash: '#/alerts', label: '提醒中心', icon: 'bell', group: '管理' },
  { id: 'search', hash: '#/search', label: '搜索', icon: 'search', group: '管理' },
  { id: 'settings', hash: '#/settings', label: '设置', icon: 'settings', group: '账户' },
];

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path] = h.split('?');
  const seg = path.split('/').filter(Boolean);
  return { path, seg };
}

function currentNavId(seg) {
  if (!seg.length) return 'home';
  if (seg[0] === 'courses' || seg[0] === 'course') return 'courses';
  if (seg[0] === 'activities' || seg[0] === 'activity') return 'activities';
  if (seg[0] === 'plan') return 'plan';
  if (seg[0] === 'alerts') return 'alerts';
  if (seg[0] === 'search') return 'search';
  if (seg[0] === 'settings') return 'settings';
  return 'home';
}

function crumbFor(seg) {
  if (!seg.length) return ['首页', '今日概览'];
  const map = { courses: '我的作业', activities: '我的活动', plan: '计划中心', alerts: '提醒中心', search: '搜索', settings: '设置', course: '课程详情', activity: '活动详情', task: '任务详情' };
  return ['课间', map[seg[0]] || '首页'];
}

function unreadCount() {
  return S.reminders.filter(r => !r.read).length;
}
function todaySlotCount() {
  const today = now().date;
  return S.slots.filter(s => s.date === today && s.status === 'pending').length;
}

function navCount(id) {
  if (id === 'alerts') return unreadCount();
  if (id === 'plan') return todaySlotCount();
  return 0;
}

function brandHtml(small = false) {
  return `<div class="brand">
    <div class="brand-logo">${icon('book', small ? 17 : 20)}<span class="dot"></span></div>
    <div><div class="brand-name">课间</div><div class="brand-sub">STUDY DESK</div></div>
  </div>`;
}

function shellHtml(seg) {
  const active = currentNavId(seg);
  const bnActive = NAV.some(n => n.id === active && !n.desktopOnly) ? active : 'home';
  const unread = unreadCount();
  const [c1, c2] = crumbFor(seg);
  const initial = (S.user.email || '?')[0].toUpperCase();
  let groups = '';
  let lastGroup = '';
  for (const n of NAV) {
    if (n.group !== lastGroup) { groups += `<div class="nav-group-label">${n.group}</div>`; lastGroup = n.group; }
    const cnt = navCount(n.id);
    groups += `<button class="nav-item ${active === n.id ? 'active' : ''}" data-nav="${n.hash}">
      ${icon(n.icon)}<span>${n.label}</span>${cnt ? `<span class="nav-count">${cnt > 99 ? '99+' : cnt}</span>` : ''}</button>`;
  }
  return `
  <div class="shell">
    <aside class="sidebar">
      ${brandHtml()}
      ${groups}
      <div class="nav-spacer"></div>
      <div class="sidebar-quote"><span class="leaf">${icon('leaf', 15)}</span>不必一口气做完所有事，<br>按自己的节奏来就好。</div>
      <div class="sidebar-sep"></div>
      <div class="sidebar-user">
        <div class="avatar">${esc(initial)}</div>
        <div style="flex:1;min-width:0"><div class="u-email" title="${esc(S.user.email)}">${esc(S.user.email)}</div></div>
        <button class="icon-btn" id="logout-btn" title="退出登录" aria-label="退出登录">${icon('logout', 17)}</button>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="topbar-brand">${brandHtml()}</div>
        <div class="crumb"><span>${esc(c1)}</span><span>/</span><b>${esc(c2)}</b></div>
        <div class="topbar-search" id="topbar-search" role="button" tabindex="0" aria-label="搜索">
          ${icon('search', 16)}<input placeholder="搜索课程、任务、文件…" readonly aria-hidden="true"><kbd>/</kbd>
        </div>
        <button class="icon-btn bell-wrap" data-nav="#/alerts" aria-label="提醒中心">${icon('bell')}${unread ? '<span class="bell-dot"></span>' : ''}</button>
        <button class="avatar" data-nav="#/settings" style="border:none;cursor:pointer" aria-label="账户设置">${esc(initial)}</button>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>
  <nav class="bottom-nav">
    ${NAV.filter(n => !n.desktopOnly).map(n => `<button class="bn-item ${bnActive === n.id ? 'active' : ''}" data-nav="${n.hash}">${icon(n.icon, 21)}<span>${n.label === '提醒中心' ? '提醒' : n.label === '计划中心' ? '计划' : n.label === '设置' ? '我的' : n.label}</span>${n.id === 'alerts' && unread ? '<span class="bn-dot"></span>' : ''}</button>`).join('')}
  </nav>`;
}

async function renderView(content, seg) {
  try {
    if (!seg.length) return await renderHome(content);
    if (seg[0] === 'courses') return await renderCourses(content);
    if (seg[0] === 'activities') return await renderActivities(content);
    if (seg[0] === 'course') return await renderCourse(content, seg[1]);
    if (seg[0] === 'activity') return await renderActivity(content, seg[1]);
    if (seg[0] === 'task') return await renderTask(content, seg[1]);
    if (seg[0] === 'plan') return await renderPlan(content);
    if (seg[0] === 'search') return await renderSearch(content);
    if (seg[0] === 'alerts') return await renderAlerts(content);
    if (seg[0] === 'settings') return await renderSettings(content);
    content.innerHTML = `<div class="empty">${icon('inbox', 28)}<div class="e-title">这一页走丢了</div><div class="e-sub">回到首页，继续按自己的节奏来。</div><button class="btn primary" data-nav="#/">回到首页</button></div>`;
  } catch (err) {
    if (err.status === 401) { clearState(); render(); return; }
    content.innerHTML = `<div class="empty">${icon('alert', 28)}<div class="e-title">加载遇到了问题</div><div class="e-sub">${esc(err.message || '请重试')}</div><button class="btn" id="retry-view">${icon('refresh', 15)} 重新加载</button></div>`;
    content.querySelector('#retry-view')?.addEventListener('click', () => render());
  }
}

let rendering = false;
async function render() {
  if (rendering) return;
  rendering = true;
  try {
    if (!S.user) {
      app.innerHTML = '';
      renderLogin(app, async () => { await boot(); });
      return;
    }
    const { seg } = parseHash();
    const scrollY = window.scrollY;
    app.innerHTML = shellHtml(seg);
    const content = app.querySelector('#content');
    if (S.user.demo) {
      content.insertAdjacentHTML('afterbegin', `<div class="demo-banner">${icon('info', 18)}<span>独立示例空间 · 定时清理（24 小时）· 请勿存放真实资料。示例数据与真实账户完全隔离。</span></div>`);
    }
    const viewHost = document.createElement('div');
    content.appendChild(viewHost);
    await renderView(viewHost, seg);
    window.scrollTo(0, scrollY);
    bindShell();
  } finally { rendering = false; }
}

function bindShell() {
  app.querySelectorAll('[data-nav]').forEach(el => el.addEventListener('click', () => { location.hash = el.dataset.nav; }));
  app.querySelector('#logout-btn')?.addEventListener('click', async () => {
    const { api } = await import('./api.js');
    await api.post('/api/auth/logout');
    clearState();
    toast('已退出登录');
    location.hash = '#/';
    render();
  });
  const ts = app.querySelector('#topbar-search');
  ts?.addEventListener('click', () => { location.hash = '#/search'; });
  ts?.addEventListener('keydown', e => { if (e.key === 'Enter') location.hash = '#/search'; });
}

async function boot() {
  app.innerHTML = loading();
  try {
    await loadState();
    render();
  } catch (err) {
    if (err.status === 401) { clearState(); render(); return; }
    app.innerHTML = `<div class="empty" style="padding-top:120px">${icon('alert', 28)}<div class="e-title">无法连接学习空间</div><div class="e-sub">${esc(err.message)}</div><button class="btn primary" id="boot-retry">重试</button></div>`;
    app.querySelector('#boot-retry').addEventListener('click', boot);
  }
}

onStateChange(() => render());
window.addEventListener('hashchange', () => { if (S.user) render(); });
window.addEventListener('keydown', e => {
  if (e.key === '/' && S.user && !e.target.matches('input,textarea,select') && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    location.hash = '#/search';
  }
});

// 全局快捷入口（供页面调用）
window.__openAI = openAI;
window.__openTaskForm = openTaskForm;

// 启动：尝试恢复会话
(async () => {
  const { api } = await import('./api.js');
  const res = await api.get('/api/session').catch(() => null);
  if (res?.user) await boot();
  else render(); // 登录页
})();