import { api } from './api.js';
import { isEnded, isOverdue, dayDiff } from './util.js';

export const S = {
  user: null, usage: null, server: null, mailConfigured: false,
  courses: [], activities: [], tasks: [], slots: [], resources: [],
  reads: {}, batches: [], digest: null, reminders: [],
  offset: 0,          // 服务器时间 - 本地时间
  loaded: false,
};

let rerenderFn = null;
export function onStateChange(fn) { rerenderFn = fn; }
export function notify() { if (rerenderFn) rerenderFn(); }

export function now() {
  const d = new Date(Date.now() + S.offset);
  // 以北京时间呈现（与服务器一致）
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const g = Object.fromEntries(p.map(x => [x.type, x.value]));
  return { date: `${g.year}-${g.month}-${g.day}`, time: `${g.hour === '24' ? '00' : g.hour}:${g.minute}`, ms: d.getTime() };
}

export async function loadState() {
  const [data, rem] = await Promise.all([api.get('/api/state'), api.get('/api/reminders')]);
  Object.assign(S, {
    user: data.user, usage: data.usage, server: data.server, mailConfigured: data.mailConfigured,
    courses: data.courses, activities: data.activities, tasks: data.tasks, slots: data.slots,
    resources: data.resources, reads: data.reads, batches: data.batches, digest: data.digest,
    reminders: rem.items, loaded: true,
  });
  S.offset = Date.parse(`${data.server.date}T${data.server.time}:00+08:00`) - Date.now();
  return data;
}

export async function refresh() {
  await loadState();
  notify();
}

export function clearState() {
  Object.assign(S, { user: null, loaded: false, courses: [], activities: [], tasks: [], slots: [], resources: [], reads: {}, batches: [] });
}

// ---- 查询助手 ----
export const course = id => S.courses.find(c => c.id === id);
export const activity = id => S.activities.find(a => a.id === id);
export const task = id => S.tasks.find(t => t.id === id);
export const resource = id => S.resources.find(r => r.id === id);
export const slot = id => S.slots.find(s => s.id === id);

export function ownerOf(t) {
  if (!t.ownerType) return null;
  return t.ownerType === 'course' ? course(t.ownerId) : activity(t.ownerId);
}
export function ownerLabel(t) {
  if (!t) return '独立待办';
  const o = ownerOf(t);
  return o ? o.name : '独立待办';
}
export function tasksOf(type, id) {
  return S.tasks.filter(t => t.ownerType === type && t.ownerId === id);
}
export function slotsOf(taskId) {
  return S.slots.filter(s => s.taskId === taskId);
}
export function resourcesOf(type, id) {
  return S.resources.filter(r => (r.owners || []).some(o => o.type === type && o.id === id));
}
// 课程/活动资料汇总（含下属任务附件，标明来源）
export function resourcesAggregated(type, id) {
  const direct = resourcesOf(type, id).map(r => ({ r, from: null }));
  const childTasks = tasksOf(type, id);
  const seen = new Set(direct.map(x => x.r.id));
  const fromTasks = [];
  for (const t of childTasks) {
    for (const r of resourcesOf('task', t.id)) {
      if (!seen.has(r.id)) { seen.add(r.id); fromTasks.push({ r, from: t }); }
    }
  }
  return [...direct, ...fromTasks];
}
export function unfinishedTasks(type, id) {
  return tasksOf(type, id).filter(t => !isEnded(t));
}
export function nearestDue(type, id) {
  const ts = unfinishedTasks(type, id).filter(t => t.due?.date).sort((a, b) => a.due.date.localeCompare(b.due.date));
  return ts[0] || null;
}
export function unreadReminderCount(items) {
  return items.filter(i => !i.read).length;
}

// ---- 计划类别（统一判定，所有页面共用） ----
export const PLAN_CATS = [['all', '全部'], ['study', '学习'], ['activity', '活动'], ['contest', '比赛'], ['other', '其他']];
export const CAT_LABEL = { study: '学习', activity: '活动', contest: '比赛', other: '其他' };
export const CAT_PILL = { study: 'green', activity: 'blue', contest: 'peach', other: 'lilac' };
export const CAT_SHORT = { study: '学', activity: '活', contest: '赛', other: '其' };

function legacyCategory(t) {
  return ['homework', 'exam'].includes(t.type) ? 'study' : 'other';
}
// 归属优先：课程→学习；contest 活动→比赛；其他活动→活动；独立任务用自选类别，旧数据按类型兜底
export function taskCategory(t) {
  if (!t) return 'other';
  if (t.ownerType === 'course') return 'study';
  if (t.ownerType === 'activity') {
    const a = activity(t.ownerId);
    if (a) return a.type === 'contest' ? 'contest' : 'activity';
  }
  return ['study', 'activity', 'contest', 'other'].includes(t.planCategory) ? t.planCategory : legacyCategory(t);
}
export function activityCategory(a) { return a?.type === 'contest' ? 'contest' : 'activity'; }
export function slotCategory(s) { return taskCategory(task(s.taskId)); }
export function taskMatchesOwner(t, f) { return !f || (!!t && t.ownerType === f.type && t.ownerId === f.id); }
export function catPillHtml(cat) { return `<span class="pill ${CAT_PILL[cat] || 'gray'}">${CAT_LABEL[cat] || '其他'}</span>`; }

export { isEnded, isOverdue, dayDiff };