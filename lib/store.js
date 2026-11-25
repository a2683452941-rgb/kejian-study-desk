import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DB_PATH = path.join(DATA_DIR, 'db.json');

export const FILE_LIMIT = 100_000_000;      // 100 MB（十进制）
export const USER_LIMIT = 2_000_000_000;    // 2 GB（十进制）
export const TZ = 'Asia/Shanghai';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(FILES_DIR, { recursive: true });

let db = { users: {}, sessions: {}, data: {}, codes: {} };
try {
  db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  for (const k of ['users', 'sessions', 'data', 'codes']) if (!db[k]) db[k] = {};
} catch { /* 首次运行 */ }

let saveTimer = null;
export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DB_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_PATH);
  }, 80);
}
export function saveNow() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_PATH);
}

export const uid = () => crypto.randomBytes(9).toString('hex');
export const nowISO = () => new Date().toISOString();

// ---- 北京时间工具 ----
const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});
export function bjParts(d = new Date()) {
  const p = Object.fromEntries(dtf.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}`, hour: +p.hour % 24, minute: +p.minute };
}
export const todayStr = () => bjParts().date;
export function dayDiff(a, b) { // a - b（天数）
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
}
export function addDays(dateStr, n) {
  const d = new Date(Date.parse(dateStr + 'T00:00:00Z') + n * 86400000);
  return d.toISOString().slice(0, 10);
}
export function weekdayOf(dateStr) { // 0=周日
  return new Date(dateStr + 'T00:00:00Z').getUTCDay();
}

// ---- 用户与数据 ----
export function getUser(id) { return db.users[id] || null; }
export function userData(id) {
  if (!db.data[id]) {
    db.data[id] = { courses: [], activities: [], tasks: [], slots: [], resources: [], reads: {}, batches: [], aiBatches: {}, tplBatches: {}, digestSkipDate: null };
  }
  const d = db.data[id];
  for (const k of ['courses', 'activities', 'tasks', 'slots', 'resources', 'batches']) if (!d[k]) d[k] = [];
  if (!d.reads) d.reads = {};
  if (!d.aiBatches) d.aiBatches = {};
  if (!d.tplBatches) d.tplBatches = {};
  return d;
}
export function createUser(email, demo = false) {
  const id = uid();
  db.users[id] = {
    id, email, demo, createdAt: nowISO(),
    settings: { digestEnabled: false, digestTime: '20:00', defaultChannel: 'both', defaultLead: 7, digestConfirmed: false },
  };
  userData(id);
  save();
  return db.users[id];
}
export function findByEmail(email) {
  return Object.values(db.users).find(u => u.email === email && !u.demo) || null;
}
export function makeSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId, createdAt: nowISO() };
  save();
  return token;
}
export function sessionUser(token) {
  const s = token && db.sessions[token];
  return s ? getUser(s.userId) : null;
}
export function dropSession(token) { delete db.sessions[token]; save(); }

export function usedBytes(userId) {
  let n = 0;
  for (const r of userData(userId).resources) for (const v of (r.versions || [])) n += v.size;
  return n;
}
export const reserved = new Map(); // userId -> bytes（并行上传预留）
export function availableBytes(userId) {
  return USER_LIMIT - usedBytes(userId) - (reserved.get(userId) || 0);
}

export function bump(e) { e.v = (e.v || 1) + 1; e.updatedAt = nowISO(); }
export function findIn(coll, id) { return coll.find(x => x.id === id) || null; }

export function versionFile(userId, versionId) {
  return path.join(FILES_DIR, userId, versionId + '.bin');
}
export async function removeVersionFile(userId, versionId) {
  try { await fsp.unlink(versionFile(userId, versionId)); } catch { /* 已不存在 */ }
}
export async function removeUserFiles(userId) {
  try { await fsp.rm(path.join(FILES_DIR, userId), { recursive: true, force: true }); } catch { /* ignore */ }
}

export function allUsers() { return Object.values(db.users); }
export function deleteUserData(userId) {
  delete db.data[userId];
  delete db.users[userId];
  for (const [t, s] of Object.entries(db.sessions)) if (s.userId === userId) delete db.sessions[t];
  save();
}

// 清理超过 24 小时的示例空间
export async function cleanupDemo() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  for (const u of allUsers()) {
    if (u.demo && Date.parse(u.createdAt) < cutoff) {
      await removeUserFiles(u.id);
      deleteUserData(u.id);
    }
  }
}

export { db };