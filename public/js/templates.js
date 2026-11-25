import { esc } from './util.js';
import { tasksOf, refresh } from './state.js';
import { openDialog, toast } from './ui.js';
import { api } from './api.js';

// 模板只是预填的普通节点任务草稿：不引入新的阶段实体，也不自动生成时段。
const TEMPLATES = {
  lecture: {
    label: '讲座模板',
    items: [
      { name: '报名', note: '确认报名方式与名额，完成报名。', needsSubmit: true },
      { name: '准备提问或阅读材料', note: '提前了解主题，准备想问的问题或阅读材料。' },
      { name: '参加活动', note: '按活动时间到场参加。' },
      { name: '整理笔记', note: '讲座结束后整理要点与收获。' },
      { name: '保存签到签退或参与证明', note: '留存签到 / 签退记录或参与证明。' },
    ],
  },
  club: {
    label: '社团模板',
    items: [
      { name: '确认报名与分工', note: '确认报名成功，明确自己的分工。' },
      { name: '准备活动材料', note: '按分工准备所需材料。' },
      { name: '参加或执行活动', note: '按活动时间参加或执行。' },
      { name: '整理照片证明和总结', note: '留存照片 / 证明，写一份小结。' },
    ],
  },
  contest: {
    label: '比赛阶段模板',
    items: [
      { name: '报名与资格确认', note: '完成报名，确认参赛资格。', needsSubmit: true },
      { name: '选题或方案确定', note: '确定选题方向与整体方案。' },
      { name: '资料调研', note: '收集与整理相关资料。' },
      { name: '初稿或原型', note: '完成初稿或可演示的原型。' },
      { name: '作品制作与完善', note: '迭代完善作品。' },
      { name: '作品提交', note: '按官方要求提交作品，提交后在此确认。', needsSubmit: true },
      { name: '答辩或展示准备', note: '准备答辩稿 / 展示材料。' },
      { name: '参加答辩或展示', note: '按安排参加答辩或展示。' },
      { name: '成果与证书归档', note: '归档获奖结果与证书。' },
    ],
  },
};

export function templateFor(a) {
  return TEMPLATES[a.type] || TEMPLATES.club;
}

export function openTemplateDialog(a) {
  const tpl = templateFor(a);
  const existing = tasksOf('activity', a.id).map(t => t.title.trim());
  // 每次打开生成一个保存标识；同一次对话框内的重试复用它，避免重复创建。
  const batchKey = `tpl-${a.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const drafts = tpl.items.map((it, i) => ({
    key: 'n' + i,
    name: it.name,
    note: it.note || '',
    date: '',
    needsSubmit: !!it.needsSubmit,
    dup: existing.includes(it.name),
    checked: !existing.includes(it.name),
  }));
  const dupCount = drafts.filter(d => d.dup).length;

  const rowHtml = (d, i) => `
    <div class="tpl-row ${d.dup ? 'dup' : ''}" data-tpl-row="${i}">
      <label class="tpl-check"><input type="checkbox" data-tpl-check="${i}" ${d.checked ? 'checked' : ''}></label>
      <div class="tpl-fields">
        <input class="input" data-tpl-name="${i}" value="${esc(d.name)}" maxlength="200" aria-label="节点名称">
        <div class="tpl-line">
          <input class="input" data-tpl-note="${i}" value="${esc(d.note)}" placeholder="备注（可选）" maxlength="1000" aria-label="备注">
        </div>
        <div class="tpl-line">
          <label class="tpl-date">截止<input class="input" type="date" data-tpl-date="${i}" value="${d.date}" aria-label="截止日期"></label>
          <label class="tpl-submit"><input type="checkbox" data-tpl-submit="${i}" ${d.needsSubmit ? 'checked' : ''}> 需确认提交</label>
        </div>
        ${d.dup ? '<div class="tpl-warn">已有同名节点：默认不勾选；勾选后会再创建一个同名节点，不会覆盖旧的。</div>' : ''}
      </div>
    </div>`;

  const dlg = openDialog({
    title: `从${tpl.label}添加节点`,
    eyebrow: esc(a.name),
    wide: true,
    body: `
      <div class="field-hint mb">勾选需要的节点，可改名、写备注、设截止（留空 = 无截止）。创建的是普通节点任务，绑定「${esc(a.name)}」；不会自动生成时段，也不会改动已有任务。</div>
      ${dupCount ? `<div class="info-block mb">检测到 ${dupCount} 个同名节点已存在，对应项默认不勾选，可按需保留或重复创建。</div>` : ''}
      <div class="tpl-list">${drafts.map(rowHtml).join('')}</div>`,
    footer: `<button class="btn" data-tpl-cancel>取消</button>
             <button class="btn primary" data-tpl-save>创建所选节点</button>`,
  });

  const readDrafts = () => {
    dlg.body.querySelectorAll('[data-tpl-row]').forEach(row => {
      const i = +row.dataset.tplRow;
      drafts[i].checked = row.querySelector('[data-tpl-check]').checked;
      drafts[i].name = row.querySelector('[data-tpl-name]').value.trim();
      drafts[i].note = row.querySelector('[data-tpl-note]').value.trim();
      drafts[i].date = row.querySelector('[data-tpl-date]').value;
      drafts[i].needsSubmit = row.querySelector('[data-tpl-submit]').checked;
    });
  };
  const updateCount = () => {
    readDrafts();
    const n = drafts.filter(d => d.checked).length;
    dlg.foot.querySelector('[data-tpl-save]').textContent = n ? `创建所选节点（${n}）` : '创建所选节点';
  };
  dlg.body.addEventListener('change', updateCount);
  updateCount();

  dlg.foot.querySelector('[data-tpl-cancel]').addEventListener('click', () => dlg.close());
  dlg.foot.querySelector('[data-tpl-save]').addEventListener('click', async () => {
    readDrafts();
    const picked = drafts.filter(d => d.checked);
    if (!picked.length) { toast('请至少勾选一个节点', 'err'); return; }
    if (picked.some(d => !d.name)) { toast('勾选的节点名称不能为空', 'err'); return; }
    const btn = dlg.foot.querySelector('[data-tpl-save]');
    btn.disabled = true; btn.textContent = '正在创建…';
    try {
      const r = await api.post('/api/tasks/batch', {
        batchKey,
        items: picked.map(d => ({
          key: d.key, title: d.name, note: d.note, type: 'node',
          ownerType: 'activity', ownerId: a.id,
          due: d.date ? { date: d.date, dateOnly: true } : null,
          needsSubmit: d.needsSubmit,
        })),
      });
      if (r.failed) {
        const failedKeys = new Set(r.results.filter(x => !x.ok).map(x => x.key));
        dlg.body.querySelectorAll('[data-tpl-row]').forEach(row => {
          const i = +row.dataset.tplRow;
          row.classList.toggle('tpl-failed', failedKeys.has(drafts[i].key));
          let e = row.querySelector('.tpl-err');
          const err = r.results.find(x => x.key === drafts[i].key && !x.ok);
          if (err) {
            if (!e) { e = document.createElement('div'); e.className = 'tpl-err'; row.querySelector('.tpl-fields').appendChild(e); }
            e.textContent = err.error;
          } else if (e) e.remove();
        });
        toast('校验未通过，未创建任何节点；请修正后重试', 'err');
      } else {
        const okCount = r.results.filter(x => x.ok).length;
        toast(r.replayed ? `该批节点已创建过（${okCount} 个），未重复添加` : `已添加 ${okCount} 个节点`);
        dlg.close();
        await refresh();
      }
    } catch (err) {
      toast(err.message || '创建失败，请重试（不会重复创建）', 'err');
    } finally {
      btn.disabled = false; updateCount();
    }
  });
  return dlg;
}

// ---- 进度（实时计算，不落库） ----
export function progressOf(a) {
  const all = tasksOf('activity', a.id).filter(t => t.status !== 'cancelled');
  const pool = a.type === 'contest' ? all.filter(t => t.type === 'node') : all;
  const done = pool.filter(t => ['done', 'submitted'].includes(t.status)).length;
  const unit = a.type === 'contest' ? '个阶段' : '项任务';
  if (!pool.length) return { text: a.type === 'contest' ? '尚未添加阶段' : '尚未添加任务', done: 0, total: 0 };
  return { text: `已完成 ${done} / ${pool.length} ${unit}`, done, total: pool.length };
}