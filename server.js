import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  PUBLIC_DIR, FILES_DIR, FILE_LIMIT, USER_LIMIT, TZ,
  db, save, saveNow, uid, nowISO, todayStr, bjParts,
  getUser, userData, createUser, findByEmail, makeSession, sessionUser, dropSession,
  usedBytes, reserved, availableBytes, bump, findIn, versionFile, removeVersionFile,
  allUsers, cleanupDemo,
} from './lib/store.js';
import {
  allowedStatuses, isEnded, applyStatusChange, mapStatusForSubmitToggle, defaultRemind,
  computeReminders, reminderKey, runDigestScheduler, nextDigestInfo, MAIL_CONFIGURED,
  taskImpact, deleteTaskCascade, ownerImpact, deleteOwnerCascade, userUsage,
} from './lib/rules.js';
import { extractNotice } from './lib/ai.js';
import { seedDemo } from './lib/seed.js';

const PORT = Number(process.env.PORT || 5173);

// ---------- 基础工具 ----------
class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
const bad = (msg, extra) => { throw new HttpError(400, msg, extra); };

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '请求内容过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const buf = await readBody(req);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { bad('请求格式不正确'); }
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
}
function auth(req) {
  const u = sessionUser(getCookie(req, 'sid'));
  if (!u) throw new HttpError(401, '登录已过期，请重新登录');
  return u;
}
function checkV(entity, body) {
  if (body.v != null && entity.v != null && body.v !== entity.v) {
    throw new HttpError(409, '这条记录已在别处更新，请先读取最新内容再保存', { latest: entity });
  }
}
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function validDue(due) {
  if (due == null) return null;
  if (!due.date || !DATE_RE.test(due.date)) bad('截止日期格式不正确');
  if (due.dateOnly) return { date: due.date, time: null, dateOnly: true };
  if (!due.time || !TIME_RE.test(due.time)) bad('请补充具体时刻，或明确选择“仅日期”');
  return { date: due.date, time: due.time, dateOnly: false };
}
function validRemind(r, user) {
  const d = defaultRemind(user);
  if (!r) return d;
  const channel = ['inapp', 'both', 'off'].includes(r.channel) ? r.channel : d.channel;
  const freq = r.freq === 'custom' ? 'custom' : 'daily';
  let lead = Number(r.lead ?? d.lead);
  if (!Number.isInteger(lead) || lead < 0 || lead > 365) lead = d.lead;
  let days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 365))].sort((a, b) => b - a) : d.days;
  if (!days.length) days = [0];
  return { channel, freq, lead, days, overdue: r.overdue !== false, planDaily: r.planDaily !== false };
}

// ---------- 实体校验 ----------
function courseFields(body, existing) {
  const name = str(body.name ?? existing?.name, 100);
  if (!name) bad('请填写课程名称');
  const schedule = Array.isArray(body.schedule) ? body.schedule : (existing?.schedule || []);
  for (const s of schedule) {
    if (!TIME_RE.test(s.start || '') || !TIME_RE.test(s.end || '')) bad('上课时间请填写完整的开始与结束时刻');
    if (s.end <= s.start) bad('上课安排的结束时间需晚于开始时间');
    const ws = Number(s.weekStart), we = Number(s.weekEnd);
    if (!Number.isInteger(ws) || !Number.isInteger(we) || ws < 1 || we < 1) bad('周次需为正整数');
    if (ws > we) bad('起始周不能大于结束周');
  }
  return {
    name, term: str(body.term ?? existing?.term, 30), teacher: str(body.teacher ?? existing?.teacher, 100),
    termStart: DATE_RE.test(body.termStart || '') ? body.termStart : (body.termStart === '' ? '' : existing?.termStart || ''),
    note: str(body.note ?? existing?.note, 5000), schedule,
  };
}
function activityFields(body, existing) {
  const name = str(body.name ?? existing?.name, 100);
  if (!name) bad('请填写活动名称');
  const type = ['lecture', 'contest', 'club', 'other'].includes(body.type) ? body.type : (existing?.type || 'other');
  const start = body.start ?? existing?.start ?? '';
  const end = body.end ?? existing?.end ?? '';
  if (start && end && end < start) bad('活动结束时间不能早于开始时间');
  const phase = ['preparing', 'ongoing', 'ended', 'cancelled'].includes(body.phase) ? body.phase : (existing?.phase || 'preparing');
  return {
    name, type, start: start || '', end: end || '',
    location: str(body.location ?? existing?.location, 200), online: str(body.online ?? existing?.online, 500),
    host: str(body.host ?? existing?.host, 200), note: str(body.note ?? existing?.note, 5000), phase,
  };
}
function taskFields(body, user, ud, existing) {
  const title = str(body.title ?? existing?.title, 200);
  if (!title) bad('请填写任务标题');
  const type = ['homework', 'exam', 'node', 'todo'].includes(body.type) ? body.type : (existing?.type || 'todo');
  let ownerType = body.ownerType !== undefined ? body.ownerType : (existing?.ownerType || null);
  let ownerId = body.ownerId !== undefined ? body.ownerId : (existing?.ownerId || null);
  if (ownerType && ownerId) {
    const coll = ownerType === 'course' ? ud.courses : ud.activities;
    if (!findIn(coll, ownerId)) bad('所属课程/活动不存在');
  } else { ownerType = null; ownerId = null; }
  let planCategory = body.planCategory !== undefined ? body.planCategory : (existing?.planCategory ?? null);
  if (planCategory !== null && !['study', 'activity', 'contest', 'other'].includes(planCategory)) bad('计划类别不正确');
  if (ownerType) planCategory = null; // 有归属时类别由对象推导，不单独存储
  const due = body.due !== undefined ? validDue(body.due) : (existing?.due || null);
  const needsSubmit = body.needsSubmit !== undefined ? !!body.needsSubmit : (existing?.needsSubmit ?? (type === 'homework'));
  const members = Array.isArray(body.members) ? body.members.slice(0, 30).map(m => ({ name: str(m.name, 50), role: str(m.role, 200) })).filter(m => m.name) : (existing?.members || []);
  let score = existing?.score || null;
  if (body.score !== undefined) {
    if (body.score === null) score = null;
    else {
      const value = Number(body.score.value), max = Number(body.score.max);
      if (!Number.isFinite(value) || value < 0) bad('分数需为非负数');
      if (!Number.isFinite(max) || max <= 0) bad('满分需大于 0');
      if (value > max && !body.confirmOver) throw new HttpError(400, '分数超出满分，请确认是否仍要保存', { code: 'score_over' });
      score = { value, max, feedback: str(body.score.feedback, 1000) };
    }
  }
  return {
    title, type, ownerType, ownerId, planCategory, due, needsSubmit, members, score,
    note: str(body.note ?? existing?.note, 10000),
    sourceText: str(body.sourceText ?? existing?.sourceText, 10000),
    sourceLink: str(body.sourceLink ?? existing?.sourceLink, 500),
    remind: validRemind(body.remind !== undefined ? body.remind : existing?.remind, user),
  };
}

// ---------- 路由 ----------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:[^/]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
}

// ---- 账户 ----
route('POST', '/api/auth/request-code', async (req, res) => {
  const { email } = await readJson(req);
  const e = str(email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) bad('请填写有效的邮箱地址');
  const prev = db.codes[e];
  if (prev && Date.now() - prev.sentAt < 60_000) bad('验证码已发送，请稍候再试');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.codes[e] = { code, sentAt: Date.now(), expires: Date.now() + 10 * 60_000, attempts: 0 };
  save();
  // 演示环境未接入发信服务：验证码直接返回给前端展示；正式部署时改为邮件投递
  json(res, 200, { ok: true, devCode: code, note: '演示环境未接入邮件服务，验证码直接显示在页面上；正式部署后将发送至邮箱。' });
});

route('POST', '/api/auth/verify', async (req, res) => {
  const { email, code } = await readJson(req);
  const e = str(email, 200).toLowerCase();
  const rec = db.codes[e];
  if (!rec || Date.now() > rec.expires) bad('验证码不存在或已过期，请重新获取');
  rec.attempts++;
  if (rec.attempts > 8) { delete db.codes[e]; save(); bad('尝试次数过多，请重新获取验证码'); }
  if (String(code).trim() !== rec.code) { save(); bad('验证码不正确'); }
  delete db.codes[e];
  let user = findByEmail(e);
  if (!user) user = createUser(e);
  const token = makeSession(user.id);
  setSessionCookie(res, token);
  json(res, 200, { ok: true, user: publicUser(user) });
});

route('POST', '/api/auth/demo', async (req, res) => {
  const user = createUser(`demo-${uid().slice(0, 6)}@demo.local`, true);
  seedDemo(user);
  const token = makeSession(user.id);
  setSessionCookie(res, token);
  json(res, 200, { ok: true, user: publicUser(user) });
});

route('POST', '/api/auth/logout', async (req, res) => {
  dropSession(getCookie(req, 'sid'));
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; Max-Age=0');
  json(res, 200, { ok: true });
});

function publicUser(u) {
  return { id: u.id, email: u.email, demo: !!u.demo, settings: u.settings, createdAt: u.createdAt };
}

route('GET', '/api/me', async (req, res) => {
  const u = auth(req);
  json(res, 200, { user: publicUser(u), usage: userUsage(u.id) });
});
route('GET', '/api/session', (req, res) => {
  const u = sessionUser(getCookie(req, 'sid'));
  json(res, 200, u ? { user: publicUser(u) } : { user: null });
});

route('PATCH', '/api/me/settings', async (req, res) => {
  const u = auth(req);
  const body = await readJson(req);
  const s = u.settings;
  const ud = userData(u.id);
  if (body.digestTime !== undefined) {
    if (!TIME_RE.test(body.digestTime)) bad('发送时刻格式不正确');
    if (body.digestTime !== s.digestTime) {
      const p = bjParts();
      const hasBatch = ud.batches.some(b => b.date === p.date);
      if (!hasBatch && body.digestTime <= p.time) ud.digestSkipDate = p.date; // 改成已过时刻 → 次日生效
      else if (ud.digestSkipDate === p.date && body.digestTime > p.time) ud.digestSkipDate = null;
      s.digestTime = body.digestTime;
    }
  }
  if (body.digestEnabled !== undefined) { s.digestEnabled = !!body.digestEnabled; if (s.digestEnabled) s.digestConfirmed = true; }
  if (body.defaultChannel !== undefined && ['inapp', 'both'].includes(body.defaultChannel)) s.defaultChannel = body.defaultChannel;
  if (body.defaultLead !== undefined) {
    const n = Number(body.defaultLead);
    if (!Number.isInteger(n) || n < 0 || n > 365) bad('提前天数需为 0—365 的整数');
    s.defaultLead = n;
  }
  save();
  json(res, 200, { user: publicUser(u), digest: nextDigestInfo(u) });
});

route('POST', '/api/me/email/request', async (req, res) => {
  const u = auth(req);
  const { email } = await readJson(req);
  const e = str(email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) bad('请填写有效的邮箱地址');
  if (e === u.email) bad('新邮箱与当前邮箱相同');
  const other = findByEmail(e);
  if (other) bad('该邮箱已被其他账户使用');
  const code = String(Math.floor(100000 + Math.random() * 900000));
  db.codes['change:' + u.id] = { email: e, code, sentAt: Date.now(), expires: Date.now() + 10 * 60_000 };
  save();
  json(res, 200, { ok: true, devCode: code });
});

route('POST', '/api/me/email/verify', async (req, res) => {
  const u = auth(req);
  const { code } = await readJson(req);
  const rec = db.codes['change:' + u.id];
  if (!rec || Date.now() > rec.expires) bad('验证码不存在或已过期');
  if (String(code).trim() !== rec.code) bad('验证码不正确');
  u.email = rec.email;
  delete db.codes['change:' + u.id];
  save();
  json(res, 200, { user: publicUser(u) });
});

// ---- 全量状态 ----
route('GET', '/api/state', async (req, res) => {
  const u = auth(req);
  const ud = userData(u.id);
  const p = bjParts();
  json(res, 200, {
    user: publicUser(u), usage: userUsage(u.id), mailConfigured: MAIL_CONFIGURED,
    server: { date: p.date, time: p.time, tz: TZ },
    courses: ud.courses, activities: ud.activities, tasks: ud.tasks, slots: ud.slots,
    resources: ud.resources, reads: ud.reads, batches: ud.batches,
    digest: nextDigestInfo(u),
  });
});

// ---- 课程 ----
route('POST', '/api/courses', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const fields = courseFields(body, null);
  const dup = ud.courses.find(c => c.name === fields.name && c.term === fields.term && !c.archived);
  const c = { id: uid(), ...fields, archived: false, createdAt: nowISO(), updatedAt: nowISO(), v: 1 };
  ud.courses.push(c); save();
  json(res, 200, { course: c, dupWarning: dup ? '相同学期已存在同名课程，请确认是否重复' : null });
});
route('PATCH', '/api/courses/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const c = findIn(ud.courses, req.params.id); if (!c) bad('课程不存在');
  const body = await readJson(req); checkV(c, body);
  Object.assign(c, courseFields(body, c));
  if (body.archived !== undefined) c.archived = !!body.archived;
  bump(c); save();
  json(res, 200, { course: c });
});
route('DELETE', '/api/courses/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const c = findIn(ud.courses, req.params.id); if (!c) bad('课程不存在');
  const impact = await deleteOwnerCascade(u.id, ud, 'course', c.id);
  json(res, 200, { ok: true, impact: { tasks: impact.tasks, slots: impact.slots, files: impact.files, bytes: impact.bytes } });
});

// ---- 活动 ----
route('POST', '/api/activities', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const a = { id: uid(), ...activityFields(body, null), archived: false, createdAt: nowISO(), updatedAt: nowISO(), v: 1 };
  ud.activities.push(a); save();
  json(res, 200, { activity: a });
});
route('PATCH', '/api/activities/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const a = findIn(ud.activities, req.params.id); if (!a) bad('活动不存在');
  const body = await readJson(req); checkV(a, body);
  const prevPhase = a.phase;
  const timeChanged = (body.start !== undefined && body.start !== a.start) || (body.end !== undefined && body.end !== a.end);
  Object.assign(a, activityFields(body, a));
  if (body.archived !== undefined) a.archived = !!body.archived;
  let cancelledNodes = 0;
  if (prevPhase !== 'cancelled' && a.phase === 'cancelled') {
    if (!body.confirmCancel) throw new HttpError(400, '活动改为已取消需要确认', { code: 'need_confirm_cancel' });
    for (const t of ud.tasks) {
      if (t.ownerType === 'activity' && t.ownerId === a.id && !isEnded(t)) {
        applyStatusChange(t, 'cancelled', ud); bump(t); cancelledNodes++;
      }
    }
  }
  bump(a); save();
  json(res, 200, { activity: a, cancelledNodes, timeChanged });
});
route('DELETE', '/api/activities/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const a = findIn(ud.activities, req.params.id); if (!a) bad('活动不存在');
  const impact = await deleteOwnerCascade(u.id, ud, 'activity', a.id);
  json(res, 200, { ok: true, impact: { tasks: impact.tasks, slots: impact.slots, files: impact.files, bytes: impact.bytes } });
});

// ---- 任务 ----
route('POST', '/api/tasks', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const fields = taskFields(body, u, ud, null);
  const status = allowedStatuses(fields.needsSubmit).includes(body.status) ? body.status : 'notstarted';
  const t = { id: uid(), ...fields, status, statusHistory: [{ at: nowISO(), from: null, to: status }], createdAt: nowISO(), updatedAt: nowISO(), v: 1 };
  ud.tasks.push(t); save();
  const pastDue = t.due && !isEnded(t) && dueInPast(t.due);
  json(res, 200, { task: t, pastDue });
});
function dueInPast(due) {
  const p = bjParts();
  if (due.dateOnly) return due.date < p.date;
  return due.date < p.date || (due.date === p.date && (due.time || '23:59') < p.time);
}
route('PATCH', '/api/tasks/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const t = findIn(ud.tasks, req.params.id); if (!t) bad('任务不存在');
  const body = await readJson(req); checkV(t, body);
  const prevSubmit = t.needsSubmit;
  const fields = taskFields(body, u, ud, t);
  if (prevSubmit !== fields.needsSubmit && ['ready', 'done', 'submitted'].includes(t.status)) {
    if (!body.confirmMapping) {
      throw new HttpError(400, '更改“是否需要提交”会影响当前状态，请确认状态映射', {
        code: 'need_confirm_mapping',
        mapping: { from: t.status, to: mapStatusForSubmitToggle(t, fields.needsSubmit) },
      });
    }
    const mapped = mapStatusForSubmitToggle(t, fields.needsSubmit);
    t.statusHistory.push({ at: nowISO(), from: t.status, to: mapped, note: '提交要求变更映射' });
    t.status = mapped;
  }
  Object.assign(t, fields);
  if (body.status !== undefined && body.status !== t.status) {
    if (!allowedStatuses(t.needsSubmit).includes(body.status)) bad('该状态与任务的提交要求不相容');
    applyStatusChange(t, body.status, ud);
  }
  bump(t); save();
  json(res, 200, { task: t });
});
route('DELETE', '/api/tasks/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const t = findIn(ud.tasks, req.params.id); if (!t) bad('任务不存在');
  const impact = await deleteTaskCascade(u.id, ud, t.id);
  json(res, 200, { ok: true, impact: { slots: impact.slots, files: impact.files, shared: impact.shared, bytes: impact.bytes } });
});

// ---- 活动/比赛模板节点：先整体校验，再一次性创建；batchKey 幂等防重复 ----
route('POST', '/api/tasks/batch', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const batchKey = str(body.batchKey, 64);
  if (!batchKey) bad('缺少保存动作标识');
  if (ud.tplBatches[batchKey]) return json(res, 200, { results: ud.tplBatches[batchKey], replayed: true });
  const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  if (!items.length) bad('请至少选择一个节点');
  const prepared = [], errors = [];
  for (const item of items) {
    try {
      if (item.ownerType !== 'activity' || !findIn(ud.activities, item.ownerId)) bad('模板节点必须绑定一个具体的活动或比赛');
      const fields = taskFields({ ...item, type: item.type || 'node', remind: item.remind || undefined }, u, ud, null);
      prepared.push({ item, fields });
    } catch (err) { errors.push({ key: item.key, ok: false, error: err.message }); }
  }
  if (errors.length) return json(res, 200, { results: errors, failed: true });
  const results = [];
  for (const { item, fields } of prepared) {
    const t = { id: uid(), ...fields, status: 'notstarted', statusHistory: [{ at: nowISO(), from: null, to: 'notstarted' }], createdAt: nowISO(), updatedAt: nowISO(), v: 1 };
    ud.tasks.push(t);
    results.push({ key: item.key, ok: true, taskId: t.id, title: t.title });
  }
  ud.tplBatches[batchKey] = results;
  save();
  json(res, 200, { results });
});

// ---- 计划时段 ----
function slotFields(body, ud, existing) {
  const taskId = body.taskId ?? existing?.taskId;
  if (!findIn(ud.tasks, taskId)) bad('计划时段必须关联一个任务');
  const date = body.date ?? existing?.date;
  if (!DATE_RE.test(date || '')) bad('请选择计划日期');
  const start = body.start !== undefined ? body.start : existing?.start;
  const end = body.end !== undefined ? body.end : existing?.end;
  if ((start && !end) || (!start && end)) bad('具体时段需同时填写开始与结束时间');
  if (start && (!TIME_RE.test(start) || !TIME_RE.test(end))) bad('时间格式不正确');
  const status = ['pending', 'done', 'skipped', 'obsolete'].includes(body.status) ? body.status : (existing?.status || 'pending');
  return { taskId, date, start: start || null, end: end || null, title: str(body.title ?? existing?.title, 100), status };
}
route('POST', '/api/slots', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const s = { id: uid(), ...slotFields(body, ud, null), createdAt: nowISO(), updatedAt: nowISO(), v: 1 };
  ud.slots.push(s); save();
  json(res, 200, { slot: s });
});
route('PATCH', '/api/slots/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const s = findIn(ud.slots, req.params.id); if (!s) bad('时段不存在');
  const body = await readJson(req); checkV(s, body);
  Object.assign(s, slotFields(body, ud, s));
  bump(s); save();
  json(res, 200, { slot: s });
});
route('DELETE', '/api/slots/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  ud.slots = ud.slots.filter(s => s.id !== req.params.id); save();
  json(res, 200, { ok: true });
});

// ---- 资料条目（链接 / 文件元数据） ----
const CATEGORIES = ['courseware', 'reference', 'other', 'poster', 'signup', 'checkin', 'checkout', 'work', 'cert'];
function validOwners(owners, ud) {
  if (!Array.isArray(owners) || !owners.length) bad('资料需归属课程、活动或任务');
  return owners.slice(0, 20).map(o => {
    const coll = o.type === 'course' ? ud.courses : o.type === 'activity' ? ud.activities : ud.tasks;
    if (!findIn(coll, o.id)) bad('资料归属对象不存在');
    return { type: o.type, id: o.id };
  });
}
route('POST', '/api/resources', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  if (body.kind !== 'link') bad('文件请通过上传接口保存');
  const url = str(body.url, 2000);
  if (!/^https?:\/\//.test(url)) bad('链接需以 http:// 或 https:// 开头');
  const r = {
    id: uid(), kind: 'link', title: str(body.title, 200) || url, category: CATEGORIES.includes(body.category) ? body.category : 'other',
    owners: validOwners(body.owners, ud), url, note: str(body.note, 1000), versions: [],
    createdAt: nowISO(), updatedAt: nowISO(), v: 1,
  };
  ud.resources.push(r); save();
  json(res, 200, { resource: r });
});
route('PATCH', '/api/resources/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const r = findIn(ud.resources, req.params.id); if (!r) bad('资料不存在');
  const body = await readJson(req); checkV(r, body);
  if (body.title !== undefined) r.title = str(body.title, 200) || r.title;
  if (body.category !== undefined && CATEGORIES.includes(body.category)) r.category = body.category;
  if (body.note !== undefined) r.note = str(body.note, 1000);
  if (body.url !== undefined && r.kind === 'link') {
    if (!/^https?:\/\//.test(str(body.url, 2000))) bad('链接需以 http:// 或 https:// 开头');
    r.url = str(body.url, 2000);
  }
  if (body.addOwner) {
    const o = validOwners([body.addOwner], ud)[0];
    if (!r.owners.some(x => x.type === o.type && x.id === o.id)) r.owners.push(o);
  }
  if (body.removeOwner) {
    r.owners = r.owners.filter(x => !(x.type === body.removeOwner.type && x.id === body.removeOwner.id));
    if (!r.owners.length) bad('资料至少需保留一个归属，若要删除请使用删除资料');
  }
  bump(r); save();
  json(res, 200, { resource: r });
});
route('DELETE', '/api/resources/:id', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const r = findIn(ud.resources, req.params.id); if (!r) bad('资料不存在');
  for (const v of (r.versions || [])) await removeVersionFile(u.id, v.id);
  ud.resources = ud.resources.filter(x => x.id !== r.id); save();
  json(res, 200, { ok: true });
});
route('PATCH', '/api/resources/:id/versions/:vid', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const r = findIn(ud.resources, req.params.id); if (!r) bad('资料不存在');
  const v = (r.versions || []).find(x => x.id === req.params.vid); if (!v) bad('版本不存在');
  const body = await readJson(req);
  if (body.final === true) { for (const x of r.versions) x.final = false; v.final = true; }
  if (body.final === false) v.final = false;
  bump(r); save();
  json(res, 200, { resource: r });
});
route('DELETE', '/api/resources/:id/versions/:vid', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const r = findIn(ud.resources, req.params.id); if (!r) bad('资料不存在');
  const v = (r.versions || []).find(x => x.id === req.params.vid); if (!v) bad('版本不存在');
  await removeVersionFile(u.id, v.id);
  r.versions = r.versions.filter(x => x.id !== v.id);
  if (!r.versions.length && r.kind === 'file') ud.resources = ud.resources.filter(x => x.id !== r.id);
  else bump(r);
  save();
  json(res, 200, { ok: true, resourceRemoved: r.kind === 'file' && !r.versions.length });
});

// ---- 上传（原始字节流，元数据在查询参数） ----
route('POST', '/api/upload', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const q = req.query;
  const name = str(q.get('name'), 255);
  const size = Number(q.get('size'));
  const ownerType = q.get('ownerType'), ownerId = q.get('ownerId');
  const mode = q.get('mode') === 'version' ? 'version' : 'new';
  const category = CATEGORIES.includes(q.get('category')) ? q.get('category') : 'other';
  if (!name) bad('缺少文件名');
  if (!Number.isFinite(size) || size <= 0) bad('文件大小无效');
  if (size > FILE_LIMIT) throw new HttpError(400, `单个文件不能超过 100 MB（100,000,000 字节），当前 ${size.toLocaleString()} 字节`, { code: 'file_too_big' });
  const coll = ownerType === 'course' ? ud.courses : ownerType === 'activity' ? ud.activities : ud.tasks;
  if (!findIn(coll, ownerId)) bad('上传归属对象不存在');
  let resource = null;
  if (mode === 'version') {
    resource = findIn(ud.resources, q.get('resourceId'));
    if (!resource || resource.kind !== 'file') bad('目标资料不存在');
  } else if (!q.get('forceNew')) {
    const same = ud.resources.find(r => r.kind === 'file'
      && r.owners.some(o => o.type === ownerType && o.id === ownerId)
      && (r.versions || []).some(v => v.name === name));
    if (same) throw new HttpError(409, '已存在同名文件', { code: 'same_name', resourceId: same.id });
  }
  const avail = availableBytes(u.id);
  if (size > avail) throw new HttpError(400, `总容量不足：剩余 ${Math.max(0, avail).toLocaleString()} 字节，可改用外链或清理文件`, { code: 'quota' });
  reserved.set(u.id, (reserved.get(u.id) || 0) + size);
  const vid = uid();
  const dir = path.join(FILES_DIR, u.id);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, vid + '.part');
  const finalPath = versionFile(u.id, vid);
  let received = 0, aborted = false;
  const ws = fs.createWriteStream(tmp);
  try {
    await new Promise((resolve, reject) => {
      req.on('data', chunk => {
        received += chunk.length;
        if (received > size || received > FILE_LIMIT || received > avail + size) {
          aborted = true; reject(new HttpError(400, '实际上传字节超出声明大小或容量限制')); req.destroy(); return;
        }
        if (!ws.write(chunk)) req.pause();
      });
      ws.on('drain', () => req.resume());
      req.on('end', resolve);
      req.on('aborted', () => { aborted = true; reject(new Error('上传中断')); });
      req.on('error', reject);
      ws.on('error', reject);
    });
    await new Promise(r => ws.end(r));
    if (received !== size) throw new HttpError(400, '上传字节数与声明不一致，请重试');
    await fsp.rename(tmp, finalPath);
  } catch (err) {
    ws.destroy();
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    reserved.set(u.id, (reserved.get(u.id) || 0) - size);
    throw err instanceof HttpError ? err : new HttpError(400, '上传失败，请重试：' + (err.message || '网络中断'));
  }
  reserved.set(u.id, (reserved.get(u.id) || 0) - size);
  const version = { id: vid, name, size: received, uploadedAt: nowISO(), final: false };
  if (mode === 'version') {
    resource.versions.push(version); bump(resource);
  } else {
    resource = {
      id: uid(), kind: 'file', title: str(q.get('title'), 200) || name, category,
      owners: [{ type: ownerType, id: ownerId }], note: '', versions: [version],
      createdAt: nowISO(), updatedAt: nowISO(), v: 1,
    };
    ud.resources.push(resource);
  }
  saveNow();
  json(res, 200, { resource, versionId: vid, usage: userUsage(u.id) });
});

// ---- 文件下载 / 预览（校验所属用户） ----
function findVersion(u, vid) {
  const ud = userData(u.id);
  for (const r of ud.resources) {
    const v = (r.versions || []).find(x => x.id === vid);
    if (v) return { r, v };
  }
  return null;
}
const PREVIEW_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };
async function serveFile(req, res, inline) {
  const u = auth(req);
  const hit = findVersion(u, req.params.vid);
  if (!hit) throw new HttpError(404, '文件不存在或不属于当前账户');
  const { v } = hit;
  const ext = (v.name.split('.').pop() || '').toLowerCase();
  const p = versionFile(u.id, v.id);
  let stat;
  try { stat = await fsp.stat(p); } catch { throw new HttpError(404, '文件存储缺失，请联系管理员'); }
  const mime = PREVIEW_TYPES[ext];
  if (inline && !mime) throw new HttpError(415, '该类型不支持预览，请下载后查看');
  const headers = {
    'Content-Type': inline ? mime : 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(v.name)}`,
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
  };
  res.writeHead(200, headers);
  fs.createReadStream(p).pipe(res);
}
route('GET', '/api/files/:vid/download', (req, res) => serveFile(req, res, false));
route('GET', '/api/files/:vid/preview', (req, res) => serveFile(req, res, true));

// ---- 提醒中心 ----
route('GET', '/api/reminders', async (req, res) => {
  const u = auth(req);
  const ud = userData(u.id);
  const today = todayStr();
  const items = computeReminders(u).map(i => ({
    taskId: i.task.id, section: i.section, overdueFlag: i.overdueFlag,
    slotIds: i.slots.map(s => s.id),
    read: ud.reads[reminderKey(i, today)] === today,
    key: reminderKey(i, today),
  }));
  json(res, 200, { items, date: today });
});
route('POST', '/api/reminders/read', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const today = todayStr();
  const keys = Array.isArray(body.keys) ? body.keys : computeReminders(u).map(i => reminderKey(i, today));
  for (const k of keys) ud.reads[k] = today;
  save();
  json(res, 200, { ok: true });
});

// ---- 摘要 ----
route('GET', '/api/digest', async (req, res) => {
  const u = auth(req);
  const items = computeReminders(u).map(i => ({ taskId: i.task.id, section: i.section, title: i.task.title }));
  json(res, 200, { preview: items, ...nextDigestInfo(u), mailConfigured: MAIL_CONFIGURED });
});

// ---- AI 录入 ----
route('POST', '/api/ai/extract', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const text = String(body.text || '');
  if (!text.trim()) bad('请先粘贴通知文字');
  if (text.length > 10000) bad('每次最多处理 10,000 字符');
  const baseDate = DATE_RE.test(body.baseDate || '') ? body.baseDate : todayStr();
  const result = extractNotice(text, baseDate, ud.courses.filter(c => !c.archived));
  json(res, 200, result);
});
route('POST', '/api/ai/save', async (req, res) => {
  const u = auth(req); const ud = userData(u.id);
  const body = await readJson(req);
  const batchKey = str(body.batchKey, 64);
  if (!batchKey) bad('缺少保存动作标识');
  if (ud.aiBatches[batchKey]) return json(res, 200, { results: ud.aiBatches[batchKey], replayed: true });
  const items = Array.isArray(body.items) ? body.items.slice(0, 30) : [];
  const results = [];
  for (const item of items) {
    try {
      const fields = taskFields({ ...item, remind: item.remind || undefined }, u, ud, null);
      const status = 'notstarted';
      const t = { id: uid(), ...fields, status, statusHistory: [{ at: nowISO(), from: null, to: status }], createdAt: nowISO(), updatedAt: nowISO(), v: 1 };
      ud.tasks.push(t);
      results.push({ key: item.key, ok: true, taskId: t.id, title: t.title });
    } catch (err) {
      results.push({ key: item.key, ok: false, error: err.message });
    }
  }
  ud.aiBatches[batchKey] = results;
  save();
  json(res, 200, { results });
});

// ---------- 静态资源 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not file');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    // SPA 回退
    try {
      const html = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch { res.writeHead(404); res.end('Not Found'); }
  }
}

// ---------- 服务器 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  req.query = url.searchParams;
  const pathname = url.pathname;
  try {
    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re);
        if (!m) continue;
        req.params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        await r.handler(req, res);
        return;
      }
      json(res, 404, { error: '接口不存在' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    await serveStatic(req, res, pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[server]', err);
    if (!res.headersSent) json(res, status, { error: err.message || '服务器开小差了，请重试', ...err.extra });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`课间 Study Desk 已启动：http://localhost:${PORT}`);
});

cleanupDemo();
setInterval(() => { cleanupDemo(); }, 3600_000);
setInterval(() => runDigestScheduler(allUsers()), 30_000);
process.on('SIGINT', () => { saveNow(); process.exit(0); });
process.on('SIGTERM', () => { saveNow(); process.exit(0); });