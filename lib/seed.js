import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { userData, todayStr, addDays, nowISO, uid, versionFile, FILES_DIR, save } from './store.js';
import { defaultRemind } from './rules.js';

// 生成一份真实可预览的示例 PDF
function makePdf(lines) {
  const content = lines.map((l, i) => `BT /F1 ${i === 0 ? 16 : 11} Tf 56 ${780 - i * 26} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${content.length}>>\nstream\n${content}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objs.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// 生成纯色示例 PNG（用于海报/凭证演示）
function makePng(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const edge = x < 6 || y < 6 || x >= w - 6 || y >= h - 6;
      const c = edge ? [207, 128, 90] : rgb;
      raw[row + 1 + x * 3] = c[0]; raw[row + 2 + x * 3] = c[1]; raw[row + 3 + x * 3] = c[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) : crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function seedFile(userId, ud, owners, title, category, name, buf) {
  const rid = uid(), vid = uid();
  fs.mkdirSync(path.join(FILES_DIR, userId), { recursive: true });
  fs.writeFileSync(versionFile(userId, vid), buf);
  const r = {
    id: rid, kind: 'file', title, category, owners, note: '',
    versions: [{ id: vid, name, size: buf.length, uploadedAt: nowISO(), final: false }],
    createdAt: nowISO(), updatedAt: nowISO(), v: 1,
  };
  ud.resources.push(r);
  return r;
}

export function seedDemo(user) {
  const ud = userData(user.id);
  const today = todayStr();
  const T = (n) => addDays(today, n);
  const base = { createdAt: nowISO(), updatedAt: nowISO(), v: 1, archived: false };
  const remind = () => defaultRemind(user);

  const c1 = { id: uid(), ...base, name: '数据结构', term: '2026秋', teacher: '林晓峰', termStart: '2026-09-07', note: '核心专业课。作业在教学平台提交，注意命名学号_姓名。', schedule: [{ weekday: 1, start: '10:00', end: '11:40', weekStart: 1, weekEnd: 16, weekMode: 'all', location: '三教 305' }, { weekday: 3, start: '14:00', end: '15:40', weekStart: 1, weekEnd: 16, weekMode: 'all', location: '三教 305' }] };
  const c2 = { id: uid(), ...base, name: '大学物理（下）', term: '2026秋', teacher: '陈远', termStart: '2026-09-07', note: '', schedule: [{ weekday: 2, start: '08:00', end: '09:40', weekStart: 1, weekEnd: 16, weekMode: 'all', location: '二教 101' }] };
  const c3 = { id: uid(), ...base, name: '学术写作与表达', term: '2026秋', teacher: '苏文瑾', termStart: '2026-09-07', note: '期末以综述论文考核。', schedule: [] };
  ud.courses.push(c1, c2, c3);

  const a1 = { id: uid(), ...base, name: '前沿科技讲座：大模型与校园生活', type: 'lecture', start: `${today}T18:30`, end: `${today}T20:30`, location: '图书馆报告厅', online: '', host: '校学生会学术部', note: '需签到并签退，计入第二课堂学分。', phase: 'ongoing' };
  const a2 = { id: uid(), ...base, name: '校园程序设计大赛', type: 'contest', start: `${T(3)}T09:00`, end: `${T(10)}T17:00`, location: '计算中心机房', online: 'https://example.com/contest', host: '计算机学院', note: '初赛线上提交作品，决赛现场答辩。', phase: 'preparing' };
  ud.activities.push(a1, a2);

  const mkTask = (o) => {
    const t = {
      id: uid(), ...base, title: '', type: 'homework', ownerType: null, ownerId: null,
      note: '', sourceText: '', sourceLink: '', due: null, needsSubmit: true,
      status: 'notstarted', members: [], score: null, remind: remind(), statusHistory: [], ...o,
    };
    ud.tasks.push(t);
    return t;
  };

  const t1 = mkTask({ title: '作业三 · 二叉树的遍历与还原', ownerType: 'course', ownerId: c1.id, due: { date: T(2), time: '23:59', dateOnly: false }, status: 'doing', note: '完成教材 P132 习题 5、6、8，另附实现代码。命名：学号_姓名_作业3.zip', sourceText: '【数据结构】作业三已发布，二叉树的遍历与还原，截止本周四 23:59，教学平台提交。' });
  mkTask({ title: '作业二 · 线性表应用', ownerType: 'course', ownerId: c1.id, due: { date: T(-5), time: '23:59', dateOnly: false }, status: 'submitted', score: { value: 92, max: 100, feedback: '思路清晰，边界处理可再完善。' }, note: '' });
  mkTask({ title: '期中考试（第 1—6 章）', type: 'exam', ownerType: 'course', ownerId: c1.id, due: { date: T(12), time: '09:00', dateOnly: false }, needsSubmit: false, note: '闭卷，允许携带一页手写提纲。' });
  const t4 = mkTask({ title: '实验报告 · 牛顿环测曲率半径', ownerType: 'course', ownerId: c2.id, due: { date: T(4), time: null, dateOnly: true }, note: '报告模板见课程资料，手写签名后扫描上传。' });
  mkTask({ title: '习题册 第 9 章', ownerType: 'course', ownerId: c2.id, due: { date: T(-1), time: '20:00', dateOnly: false }, status: 'ready', note: '写完待提交，别忘了交。' });
  const t6 = mkTask({ title: '文献综述初稿', ownerType: 'course', ownerId: c3.id, due: { date: T(6), time: null, dateOnly: true }, status: 'doing', needsSubmit: true, note: '不少于 3000 字，附参考文献列表。', members: [{ name: '我', role: '撰写与统稿' }] });
  const n1 = mkTask({ title: '讲座签到', type: 'node', ownerType: 'activity', ownerId: a1.id, due: { date: today, time: '18:30', dateOnly: false }, needsSubmit: false, note: '入口扫码签到。' });
  mkTask({ title: '讲座签退', type: 'node', ownerType: 'activity', ownerId: a1.id, due: { date: today, time: '20:30', dateOnly: false }, needsSubmit: false, note: '出口处签退并拍照留存。' });
  const n3 = mkTask({ title: '大赛报名', type: 'node', ownerType: 'activity', ownerId: a2.id, due: { date: T(3), time: '18:00', dateOnly: false }, needsSubmit: true, note: '官网填写队伍信息。' });
  mkTask({ title: '初赛作品提交', type: 'node', ownerType: 'activity', ownerId: a2.id, due: { date: T(9), time: '23:59', dateOnly: false }, needsSubmit: true, note: '打包源码与说明文档。' });
  mkTask({ title: '图书馆还书（两本）', type: 'todo', due: { date: T(1), time: null, dateOnly: true }, needsSubmit: false, note: '《算法导论》《物理学史》' });

  const mkSlot = (o) => ud.slots.push({ id: uid(), ...base, status: 'pending', start: null, end: null, title: '', ...o });
  mkSlot({ taskId: t6.id, title: '查资料 · 整理文献清单', date: today, start: '19:00', end: '21:00' });
  mkSlot({ taskId: t1.id, title: '写代码 · 遍历实现', date: T(1), start: '14:00', end: '16:00' });
  mkSlot({ taskId: t4.id, title: '整理实验数据', date: today });
  mkSlot({ taskId: t6.id, title: '写初稿开头', date: T(2), start: '09:00', end: '11:30' });

  seedFile(user.id, ud, [{ type: 'course', id: c1.id }], '课程教学大纲', 'courseware', '数据结构-教学大纲.pdf',
    makePdf(['Study Desk - Data Structures Syllabus', 'Week 1-2  Linear Lists', 'Week 3-5  Stacks and Queues', 'Week 6-8  Trees and Binary Trees', 'Week 9-11 Graphs', 'Week 12-14 Sorting', 'Homework 3 due: see task list', 'Midterm: chapter 1-6']));
  seedFile(user.id, ud, [{ type: 'task', id: t1.id }], '作业三要求原文', 'other', '作业三要求.txt',
    Buffer.from('作业三：二叉树的遍历与还原\n1. 教材 P132 习题 5、6、8\n2. 附实现代码（C/C++/Python 均可）\n3. 打包命名：学号_姓名_作业3.zip\n4. 截止：本周四 23:59，教学平台提交\n', 'utf8'));
  seedFile(user.id, ud, [{ type: 'activity', id: a1.id }], '讲座海报', 'poster', '讲座海报.png', makePng(320, 200, [231, 237, 224]));
  seedFile(user.id, ud, [{ type: 'task', id: n3.id }], '报名页面截图', 'signup', '报名凭证.png', makePng(280, 180, [231, 237, 245]));
  ud.resources.push({
    id: uid(), kind: 'link', title: '数据结构 MOOC 配套视频', category: 'reference',
    owners: [{ type: 'course', id: c1.id }], url: 'https://www.icourse163.org/', note: '需要登录学校账号观看',
    versions: [], createdAt: nowISO(), updatedAt: nowISO(), v: 1,
  });
  save();
}