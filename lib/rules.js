import { userData, todayStr, bjParts, dayDiff, save, nowISO, uid, removeVersionFile, usedBytes } from './store.js';

export const END_STATUSES = ['submitted', 'done', 'cancelled'];
export const isEnded = t => END_STATUSES.includes(t.status);

export function allowedStatuses(needsSubmit) {
  return needsSubmit
    ? ['notstarted', 'doing', 'ready', 'submitted', 'cancelled']
    : ['notstarted', 'doing', 'done', 'cancelled'];
}

export function isOverdue(task, now = new Date()) {
  if (!task.due || !task.due.date) return false;
  const p = bjParts(now);
  if (task.due.dateOnly) return dayDiff(p.date, task.due.date) > 0;
  if (p.date !== task.due.date) return dayDiff(p.date, task.due.date) > 0;
  return p.time > (task.due.time || '23:59');
}

// 状态变更副作用：记录历史；结束时把未来待执行时段标为不再需要
export function applyStatusChange(task, next, ud) {
  const prev = task.status;
  if (prev === next) return;
  task.status = next;
  task.statusHistory = task.statusHistory || [];
  task.statusHistory.push({ at: nowISO(), from: prev, to: next });
  if (END_STATUSES.includes(next)) {
    const today = todayStr();
    for (const s of ud.slots) {
      if (s.taskId === task.id && s.status === 'pending' && s.date >= today) s.status = 'obsolete';
    }
  }
}

// “是否需要提交”切换的状态映射（需用户确认）
export function mapStatusForSubmitToggle(task, needsSubmit) {
  const s = task.status;
  if (s === 'cancelled' || s === 'notstarted' || s === 'doing') return s;
  if (needsSubmit) { // 改为需要提交
    if (s === 'done') return 'ready';
    return s;
  }
  if (s === 'ready') return 'doing';
  if (s === 'submitted') return 'done';
  return s;
}

export function defaultRemind(user) {
  const s = user.settings;
  return {
    channel: s.defaultChannel === 'both' && !s.digestEnabled ? 'inapp' : s.defaultChannel,
    freq: 'daily', lead: s.defaultLead ?? 7, days: [7, 3, 1, 0],
    overdue: true, planDaily: true,
  };
}

// ---- 提醒资格（站内提醒中心与邮件摘要共用） ----
// 返回 [{task, section:'overdue'|'today'|'upcoming'|'plan', slots:[...]}]
export function computeReminders(user, now = new Date()) {
  const ud = userData(user.id);
  const today = bjParts(now).date;
  const out = [];
  for (const task of ud.tasks) {
    if (isEnded(task)) continue;
    const r = task.remind || {};
    if (r.channel === 'off') continue;
    let section = null;
    let overdueFlag = false;
    if (task.due && task.due.date) {
      if (isOverdue(task, now)) {
        overdueFlag = true;
        if (r.overdue !== false) section = 'overdue';
      } else {
        const diff = dayDiff(task.due.date, today);
        const eligible = r.freq === 'custom'
          ? (r.days || []).includes(diff)
          : diff >= 0 && diff <= (r.lead ?? 7);
        if (eligible) section = diff === 0 ? 'today' : 'upcoming';
      }
    }
    let planSlots = [];
    if (r.planDaily !== false) {
      planSlots = ud.slots.filter(s => s.taskId === task.id && s.date === today && s.status === 'pending');
    }
    if (!section && planSlots.length) section = 'plan';
    if (!section) continue;
    out.push({ task, section, overdueFlag, slots: planSlots });
  }
  const prio = { overdue: 0, today: 1, upcoming: 2, plan: 3 };
  out.sort((a, b) => prio[a.section] - prio[b.section] || (a.task.due?.date || '9999').localeCompare(b.task.due?.date || '9999'));
  return out;
}

export function reminderKey(item, today) {
  return `${item.task.id}:${today}:${item.section}`;
}

// ---- 每日摘要：每人每自然日最多一个批次 ----
export const MAIL_CONFIGURED = false; // 未接入发信服务时如实降级：批次仅记录，不投递

export function nextDigestInfo(user, now = new Date()) {
  const ud = userData(user.id);
  const p = bjParts(now);
  const batch = ud.batches.find(b => b.date === p.date);
  const t = user.settings.digestTime || '20:00';
  let next;
  if (batch) next = `${p.date} 已生成 · 下一次 ${nextDayLabel(p.date)} ${t}`;
  else if (ud.digestSkipDate === p.date) next = `明日 ${nextDayLabel(p.date)} ${t}`;
  else if (p.time >= t) next = `明日 ${nextDayLabel(p.date)} ${t}`;
  else next = `今日 ${t}`;
  return { next, todayBatch: batch || null };
}
function nextDayLabel(date) {
  const d = new Date(Date.parse(date + 'T00:00:00Z') + 86400000);
  return d.toISOString().slice(5, 10).replace('-', '/');
}

export function runDigestScheduler(users) {
  const now = new Date();
  const p = bjParts(now);
  for (const user of users) {
    const st = user.settings;
    if (!st.digestEnabled) continue;
    const ud = userData(user.id);
    if (ud.batches.some(b => b.date === p.date)) continue;      // 当日唯一批次
    if (ud.digestSkipDate === p.date) continue;                 // 改成已过时刻 → 次日生效
    if (p.time < (st.digestTime || '20:00')) continue;
    const items = computeReminders(user, now);                  // 发送前重新读取最新状态
    if (!items.length) continue;                                // 不发空摘要，不消耗机会
    ud.batches.push({
      id: uid(), date: p.date, plannedAt: `${p.date}T${st.digestTime || '20:00'}:00+08:00`,
      createdAt: nowISO(), status: MAIL_CONFIGURED ? 'sent' : 'recorded',
      attempts: 1, itemCount: items.length,
      items: items.map(i => ({ taskId: i.task.id, title: i.task.title, section: i.section })),
      note: MAIL_CONFIGURED ? '' : '邮件通道未配置：本批次已生成并记录，未实际投递',
    });
    if (ud.batches.length > 60) ud.batches = ud.batches.slice(-60);
    save();
  }
}

// ---- 级联删除 ----
export function taskImpact(ud, taskId) {
  const slots = ud.slots.filter(s => s.taskId === taskId);
  const owned = ud.resources.filter(r => (r.owners || []).some(o => o.type === 'task' && o.id === taskId));
  const exclusive = owned.filter(r => r.owners.length === 1);
  const shared = owned.filter(r => r.owners.length > 1);
  const bytes = exclusive.reduce((n, r) => n + (r.versions || []).reduce((m, v) => m + v.size, 0), 0);
  return { slots: slots.length, files: exclusive.length, shared: shared.length, bytes, exclusive, shared };
}

export async function deleteTaskCascade(userId, ud, taskId) {
  const impact = taskImpact(ud, taskId);
  ud.slots = ud.slots.filter(s => s.taskId !== taskId);
  for (const r of impact.exclusive) {
    for (const v of (r.versions || [])) await removeVersionFile(userId, v.id);
  }
  const exIds = new Set(impact.exclusive.map(r => r.id));
  ud.resources = ud.resources.filter(r => !exIds.has(r.id));
  for (const r of impact.shared) r.owners = r.owners.filter(o => !(o.type === 'task' && o.id === taskId));
  ud.tasks = ud.tasks.filter(t => t.id !== taskId);
  save();
  return impact;
}

export function ownerImpact(ud, type, ownerId) {
  const tasks = ud.tasks.filter(t => t.ownerType === type && t.ownerId === ownerId);
  let slots = 0, files = 0, bytes = 0;
  const fileSet = new Set();
  const direct = ud.resources.filter(r => (r.owners || []).some(o => o.type === type && o.id === ownerId));
  for (const t of tasks) slots += ud.slots.filter(s => s.taskId === t.id).length;
  const all = [...direct];
  for (const t of tasks) all.push(...ud.resources.filter(r => (r.owners || []).some(o => o.type === 'task' && o.id === t.id)));
  for (const r of all) {
    if (fileSet.has(r.id)) continue;
    fileSet.add(r.id);
    const others = (r.owners || []).filter(o => {
      if (o.type === type && o.id === ownerId) return false;
      if (o.type === 'task' && tasks.some(t => t.id === o.id)) return false;
      return true;
    });
    if (!others.length) { files++; bytes += (r.versions || []).reduce((m, v) => m + v.size, 0); }
  }
  return { tasks: tasks.length, slots, files, bytes, taskList: tasks };
}

export async function deleteOwnerCascade(userId, ud, type, ownerId) {
  const impact = ownerImpact(ud, type, ownerId);
  for (const t of impact.taskList) await deleteTaskCascade(userId, ud, t.id);
  const direct = ud.resources.filter(r => (r.owners || []).some(o => o.type === type && o.id === ownerId));
  for (const r of direct) {
    r.owners = r.owners.filter(o => !(o.type === type && o.id === ownerId));
    if (!r.owners.length) {
      for (const v of (r.versions || [])) await removeVersionFile(userId, v.id);
      ud.resources = ud.resources.filter(x => x.id !== r.id);
    }
  }
  if (type === 'course') ud.courses = ud.courses.filter(c => c.id !== ownerId);
  else ud.activities = ud.activities.filter(a => a.id !== ownerId);
  save();
  return impact;
}

export function userUsage(userId) {
  return { used: usedBytes(userId), limit: 2_000_000_000, fileLimit: 100_000_000 };
}