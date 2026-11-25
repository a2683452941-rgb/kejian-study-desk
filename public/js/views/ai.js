import { icon } from '../icons.js';
import { esc, uid, TYPE_LABEL } from '../util.js';
import { S, now, refresh, taskCategory, CAT_LABEL } from '../state.js';
import { api } from '../api.js';
import { openDialog, confirmDialog, toast, errBlock } from '../ui.js';
import { openTaskForm } from '../forms.js';

const EV_LABEL = { explicit: '原文明示', interpreted: '解释得到', ambiguous: '待确认', conflict: '日期冲突' };
const norm = s => (s || '').toLowerCase().replace(/[\s，。、：:；;（）()【】\[\]“”"']/g, '');

function findDuplicate(draft) {
  const nt = norm(draft.title);
  if (nt.length < 4) return null;
  const [oT, oI] = draft.owner ? draft.owner.split(':') : [null, null];
  return S.tasks.find(t => {
    if ((t.ownerType || null) !== oT || (t.ownerId || null) !== oI) return false;
    const et = norm(t.title);
    if (!(et === nt || et.includes(nt) || nt.includes(et))) return false;
    if (draft.dueDate && t.due?.date) return draft.dueDate === t.due.date;
    return !draft.dueDate && !t.due?.date;
  }) || null;
}

export function openAI() {
  const state = {
    text: '', baseDate: now().date, baseConfirmed: false,
    candidates: [], needsBaseConfirm: false,
    batchKey: uid(), saving: false, phase: 'input',
  };

  const d = openDialog({
    title: 'AI 快速录入',
    eyebrow: 'NOTICE INTAKE',
    wide: true,
    body: '',
    footer: '',
  });

  // ---------- 阶段一：粘贴 ----------
  function renderInput(errMsg = '') {
    state.phase = 'input';
    d.setBody(`
      <div class="demo-banner" style="margin:0 0 16px">${icon('sparkles', 18)}<span>本地规则识别 · 仅处理本次粘贴的文字，不联网、不留存原文之外的内容。识别结果只是候选，保存前由你逐条确认。</span></div>
      <div data-field="text" class="field">
        <label>通知原文 <span class="req">*</span></label>
        <textarea class="input" id="ai-text" rows="8" maxlength="10000" placeholder="把群通知、邮件或公告文字粘贴到这里，例如：&#10;1. 数据结构作业三请于11月20日晚上23:59前提交至教学平台。&#10;2. 下周三下午2点在理科楼A101进行大学物理期中考试。">${esc(state.text)}</textarea>
        <div class="field-hint row" style="justify-content:space-between"><span>支持编号列表与多段落；每条候选都会附上识别依据。</span><span id="ai-count">${state.text.length} / 10000</span></div>
      </div>
      <div class="form-grid">
        <div data-field="baseDate" class="field">
          <label>相对日期基准日</label>
          <input type="date" class="input" id="ai-base" value="${esc(state.baseDate)}">
          <div class="field-hint">“明天 / 下周三 / 三天后”等表述按这一天推算，识别后会请你再确认一次。</div>
        </div>
        <div class="field">
          <label>识别范围</label>
          <div class="field-hint" style="margin-top:9px">只会匹配你账户里未归档的课程与活动；同名课程会列出来由你选择归属。</div>
        </div>
      </div>
      <div id="ai-err">${errMsg ? errBlock(errMsg) : ''}</div>`);
    d.setFooter(`
      <button class="btn" id="ai-manual">${icon('edit', 15)} 手动创建任务</button>
      <button class="btn primary" id="ai-extract">${icon('sparkles', 16)} 开始识别</button>`);
    const ta = d.body.querySelector('#ai-text');
    ta.addEventListener('input', () => {
      state.text = ta.value;
      d.body.querySelector('#ai-count').textContent = `${ta.value.length} / 10000`;
    });
    d.body.querySelector('#ai-base').addEventListener('change', e => { state.baseDate = e.target.value || now().date; state.baseConfirmed = false; });
    d.foot.querySelector('#ai-manual').addEventListener('click', () => {
      d.close();
      openTaskForm({ preset: { sourceText: state.text, stay: true } });
    });
    d.foot.querySelector('#ai-extract').addEventListener('click', extract);
    ta.focus();
  }

  async function extract() {
    const text = state.text.trim();
    const errBox = d.body.querySelector('#ai-err');
    errBox.innerHTML = '';
    if (!text) { errBox.innerHTML = errBlock('请先粘贴通知文字'); return; }
    const btn = d.foot.querySelector('#ai-extract');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> 正在逐句识别…';
    try {
      const res = await Promise.race([
        api.post('/api/ai/extract', { text, baseDate: state.baseDate }),
        new Promise((_, rej) => setTimeout(() => rej({ message: '识别超时（60 秒）。文字已保留，可重试或改为手动创建。', code: 'timeout' }), 60000)),
      ]);
      if (!res.candidates.length) {
        errBox.innerHTML = errBlock('没有识别出明确的任务。可以补充“作业 / 提交 / 考试 / 报名”等关键词后重试，或手动创建。');
        return;
      }
      state.needsBaseConfirm = res.needsBaseConfirm;
      state.baseConfirmed = false;
      state.batchKey = uid();
      state.candidates = res.candidates.map(c => ({
        key: c.key, raw: c,
        selected: true,
        title: c.title, type: c.type,
        owner: c.courseIds.length ? 'course:' + c.courseIds[0] : '',
        dueDate: c.due?.date || '', dueTime: c.due?.time || '', dateOnly: c.due ? !!c.due.dateOnly : true,
        noDue: !c.due,
        needsSubmit: c.needsSubmit,
        planCategory: c.courseIds.length ? 'study' : (['homework', 'exam'].includes(c.type) ? 'study' : 'other'),
        ambResolved: false, dupConfirmed: false,
        result: null,
      }));
      renderCandidates();
    } catch (e) {
      errBox.innerHTML = errBlock(e.message || '识别失败，文字已保留，可重试。');
    } finally {
      if (state.phase === 'input') {
        btn.disabled = false;
        btn.innerHTML = icon('sparkles', 16) + ' 开始识别';
      }
    }
  }

  // ---------- 阶段二：逐条确认 ----------
  function ownerOptions(sel, category = 'other') {
    const courses = S.courses.filter(c => !c.archived);
    const acts = S.activities.filter(a => !a.archived && a.type !== 'contest');
    const contests = S.activities.filter(a => !a.archived && a.type === 'contest');
    const groups = [
      ['课程', courses.map(c => `<option value="course:${c.id}" ${sel === 'course:' + c.id ? 'selected' : ''}>${esc(c.name)}${c.term ? ' · ' + esc(c.term) : ''}</option>`).join('')],
      ['活动', acts.map(a => `<option value="activity:${a.id}" ${sel === 'activity:' + a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')],
      ['比赛', contests.map(a => `<option value="activity:${a.id}" ${sel === 'activity:' + a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')],
    ];
    const order = { study: [0, 1, 2], activity: [1, 2, 0], contest: [2, 1, 0], other: [0, 1, 2] }[category] || [0, 1, 2];
    return `<option value="" ${!sel ? 'selected' : ''}>独立待办（不归属）</option>` +
      order.map(i => groups[i][1] ? `<optgroup label="${groups[i][0]}">${groups[i][1]}</optgroup>` : '').join('');
  }
  function candCat(c) {
    const [oT, oI] = c.owner ? c.owner.split(':') : [null, null];
    return oT ? taskCategory({ ownerType: oT, ownerId: oI, type: c.type }) : c.planCategory;
  }

  function candCard(c) {
    const dup = findDuplicate(c);
    const multiOwner = c.raw.courseIds.length > 1;
    const amb = c.raw.ambiguous && !c.noDue && !c.ambResolved;
    const evTags = c.raw.evidence.map(e =>
      `<span class="ev-tag ${e.kind}" title="${esc(e.note || '')}">${EV_LABEL[e.kind] || e.kind} · ${esc(e.text)}</span>`).join('');
    return `
    <div class="ai-candidate ${c.selected ? 'selected' : ''}" data-cand="${c.key}">
      <div class="ai-cand-head">
        <button class="task-check ${c.selected ? 'done' : ''}" data-sel="${c.key}" aria-label="${c.selected ? '取消选择' : '选择'}">${c.selected ? icon('check', 12) : ''}</button>
        <div style="flex:1;min-width:0">
          <input class="input" data-f="title" value="${esc(c.title)}" placeholder="任务标题" style="font-weight:550">
        </div>
        ${c.result ? `<span class="pill ${c.result.ok ? 'green' : 'red'}">${c.result.ok ? '已创建' : '失败'}</span>` : ''}
      </div>
      <div class="form-grid">
        <div class="field"><label>类型</label>
          <select class="input" data-f="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <div class="field"><label>计划类别</label>
          <select class="input" data-f="planCategory" ${c.owner ? 'disabled' : ''}>${['study', 'activity', 'contest', 'other'].map(k => `<option value="${k}" ${candCat(c) === k ? 'selected' : ''}>${CAT_LABEL[k]}</option>`).join('')}</select>
          <div class="field-hint" data-cathint>${c.owner ? '已关联对象，类别按对象自动判定' : '独立任务的类别，可修改；选择归属后按对象自动判定'}</div>
        </div>
      </div>
      <div class="field"><label>归属${multiOwner ? ' <span class="pill peach">匹配到多门课程，请确认</span>' : ''}</label>
        <select class="input" data-f="owner">${ownerOptions(c.owner, candCat(c))}</select>
        <div class="field-hint">只是建议归属，可改选或保持独立；不会自动创建课程 / 活动 / 比赛。</div>
      </div>
      <div class="form-grid">
        <div class="field"><label>截止日期</label><input type="date" class="input" data-f="dueDate" value="${esc(c.dueDate)}"></div>
        <div class="field"><label>截止时刻</label><input type="time" class="input" data-f="dueTime" value="${esc(c.dueTime)}" ${c.dateOnly ? 'disabled' : ''}></div>
      </div>
      <div class="row" style="gap:18px;flex-wrap:wrap;margin-bottom:6px">
        <label class="row tiny muted" style="gap:6px;cursor:pointer"><input type="checkbox" data-f="dateOnly" ${c.dateOnly ? 'checked' : ''}> 仅日期（当天 24:00 前，次日才算逾期）</label>
        <label class="row tiny muted" style="gap:6px;cursor:pointer"><input type="checkbox" data-f="needsSubmit" ${c.needsSubmit ? 'checked' : ''}> 需要提交</label>
        <button class="text-btn" data-nodue="${c.key}">${c.noDue ? '已暂不设 DDL' : '暂不设 DDL'}</button>
      </div>
      ${evTags ? `<div class="ai-evidence">${evTags}</div>` : ''}
      ${c.raw.note ? `<div class="field-hint">${esc(c.raw.note)}</div>` : ''}
      ${c.raw.submitHint ? `<div class="field-hint">提交方式：${esc(c.raw.submitHint)}（已写入任务备注）</div>` : ''}
      ${amb ? `<div class="err-block" style="margin-top:9px">时间表述待确认：请核对上方日期时刻，勾选“我已核对”，或点“暂不设 DDL”。<label class="row tiny" style="gap:6px;margin-top:7px;cursor:pointer"><input type="checkbox" data-amb="${c.key}"> 我已核对，按上方时间保存</label></div>` : ''}
      ${dup && !c.dupConfirmed ? `<div class="err-block" data-dupbox="1" style="margin-top:9px">与已有任务「${esc(dup.title)}」标题与归属相近${dup.due?.date ? '，截止日期相同' : ''}，可能是重复录入。<label class="row tiny" style="gap:6px;margin-top:7px;cursor:pointer"><input type="checkbox" data-dup="${c.key}"> 确认不是重复，仍然创建</label></div>` : ''}
      <details style="margin-top:9px"><summary class="tiny muted" style="cursor:pointer">查看原文依据</summary><div class="ai-original">${esc(c.raw.requirement)}</div></details>
      ${c.result && !c.result.ok ? `<div class="ai-result fail">${icon('alert', 14)} ${esc(c.result.error || '保存失败')}</div>` : ''}
    </div>`;
  }

  function renderCandidates(errMsg = '') {
    state.phase = 'candidates';
    const pending = state.candidates.filter(c => !c.result?.ok);
    const doneCount = state.candidates.length - pending.length;
    d.setBody(`
      ${state.needsBaseConfirm ? `
        <div class="demo-banner" style="margin:0 0 14px">${icon('info', 18)}
          <span>部分日期由“明天 / 下周X”等相对表述推算而来，基准日为 <b>${esc(state.baseDate)}</b>。
          <label class="row tiny" style="gap:6px;margin-top:6px;cursor:pointer"><input type="checkbox" id="ai-baseok" ${state.baseConfirmed ? 'checked' : ''}> 我已确认基准日正确（如需修改请返回上一步）</label></span>
        </div>` : ''}
      <div class="row" style="justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div class="tiny muted">共识别 ${state.candidates.length} 条候选${doneCount ? ` · 已创建 ${doneCount} 条` : ''} · 未勾选的不会保存</div>
        <div class="row" style="gap:8px">
          <button class="text-btn" id="ai-all">全选</button>
          <button class="text-btn" id="ai-none">全不选</button>
        </div>
      </div>
      <div id="ai-cands">${pending.map(candCard).join('')}</div>
      ${state.candidates.some(c => c.result?.ok) ? `
        <div class="panel" style="margin-top:6px"><div class="panel-body">
          <div class="tiny muted" style="margin-bottom:6px">本次已创建</div>
          ${state.candidates.filter(c => c.result?.ok).map(c => `<div class="ai-result ok">${icon('check', 14)} ${esc(c.result.title || c.title)} <a class="text-btn" href="#/task/${c.result.taskId}" data-goto>查看</a></div>`).join('')}
        </div></div>` : ''}
      <div id="ai-err">${errMsg ? errBlock(errMsg) : ''}</div>`);
    const selCount = pending.filter(c => c.selected).length;
    d.setFooter(`
      <button class="btn" id="ai-back">${icon('chevL', 15)} 返回修改原文</button>
      <button class="btn primary" id="ai-save" ${selCount ? '' : 'disabled'}>${icon('check', 16)} 保存所选（${selCount}）</button>`);
    d.foot.querySelector('#ai-back').addEventListener('click', () => renderInput());
    d.foot.querySelector('#ai-save').addEventListener('click', save);
    d.body.querySelector('#ai-baseok')?.addEventListener('change', e => { state.baseConfirmed = e.target.checked; });
    d.body.querySelector('#ai-all').addEventListener('click', () => { pending.forEach(c => c.selected = true); renderCandidates(); });
    d.body.querySelector('#ai-none').addEventListener('click', () => { pending.forEach(c => c.selected = false); renderCandidates(); });
    d.body.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', () => d.close()));

    const wrap = d.body.querySelector('#ai-cands');
    wrap.addEventListener('click', e => {
      const sel = e.target.closest('[data-sel]');
      if (sel) {
        const c = state.candidates.find(x => x.key === sel.dataset.sel);
        c.selected = !c.selected;
        renderCandidates();
        return;
      }
      const nd = e.target.closest('[data-nodue]');
      if (nd) {
        const c = state.candidates.find(x => x.key === nd.dataset.nodue);
        c.noDue = true; c.dueDate = ''; c.dueTime = ''; c.ambResolved = false;
        renderCandidates();
      }
    });
    wrap.addEventListener('input', e => {
      const card = e.target.closest('[data-cand]');
      if (!card) return;
      const c = state.candidates.find(x => x.key === card.dataset.cand);
      const f = e.target.dataset.f;
      if (f) {
        if (e.target.type === 'checkbox') c[f] = e.target.checked;
        else c[f] = e.target.value;
        if (f === 'dueDate' && e.target.value) c.noDue = false;
        if (f === 'dateOnly') {
          card.querySelector('[data-f="dueTime"]').disabled = c.dateOnly;
          if (c.dateOnly) { c.dueTime = ''; card.querySelector('[data-f="dueTime"]').value = ''; }
        }
        if (f === 'title' || f === 'owner' || f === 'dueDate') {
          // 重复检测随编辑变化：仅更新提示，不重绘输入
          const dup = findDuplicate(c);
          let dupBox = card.querySelector('[data-dupbox]');
          if (dup && !c.dupConfirmed) {
            if (!dupBox) {
              dupBox = document.createElement('div');
              dupBox.className = 'err-block';
              dupBox.style.marginTop = '9px';
              dupBox.dataset.dupbox = '1';
              card.querySelector('details').before(dupBox);
            }
            dupBox.innerHTML = `与已有任务「${esc(dup.title)}」相近，可能重复。<label class="row tiny" style="gap:6px;margin-top:7px;cursor:pointer"><input type="checkbox" data-dup="${c.key}"> 确认不是重复，仍然创建</label>`;
          } else if (dupBox) dupBox.remove();
        }
      }
      const amb = e.target.dataset.amb;
      if (amb) {
        const c = state.candidates.find(x => x.key === amb);
        c.ambResolved = e.target.checked;
        e.target.closest('.err-block').style.opacity = c.ambResolved ? '0.55' : '1';
      }
      const dup = e.target.dataset.dup;
      if (dup) {
        const c = state.candidates.find(x => x.key === dup);
        c.dupConfirmed = e.target.checked;
        e.target.closest('.err-block').style.opacity = c.dupConfirmed ? '0.55' : '1';
      }
    });
    wrap.addEventListener('change', e => {
      const f = e.target.dataset.f;
      if (f === 'type' || f === 'owner' || f === 'planCategory') {
        const card = e.target.closest('[data-cand]');
        const c = state.candidates.find(x => x.key === card.dataset.cand);
        c[f] = e.target.value;
        if (f === 'type' || f === 'owner') {
          const catSel = card.querySelector('[data-f="planCategory"]');
          if (f === 'owner' && !c.owner) c.planCategory = catSel.value;
          const dc = candCat(c);
          catSel.value = dc;
          catSel.disabled = !!c.owner;
          card.querySelector('[data-cathint]').textContent = c.owner ? '已关联对象，类别按对象自动判定' : '独立任务的类别，可修改；选择归属后按对象自动判定';
          if (f === 'owner') {
            const ownerSel = card.querySelector('[data-f="owner"]');
            ownerSel.innerHTML = ownerOptions(c.owner, dc);
          }
        }
      }
    });
  }

  // ---------- 保存 ----------
  async function save() {
    if (state.saving) return;
    const errBox = d.body.querySelector('#ai-err');
    errBox.innerHTML = '';
    const chosen = state.candidates.filter(c => c.selected && !c.result?.ok);
    if (!chosen.length) return;
    if (state.needsBaseConfirm && !state.baseConfirmed) {
      errBox.innerHTML = errBlock('请先在顶部确认相对日期的基准日，再保存。');
      d.body.scrollTop = 0;
      return;
    }
    const problems = [];
    for (const c of chosen) {
      if (!c.title.trim()) problems.push(`「${c.raw.title || '未命名'}」缺少标题`);
      if (!c.noDue && c.dueDate && !c.dateOnly && !c.dueTime) problems.push(`「${c.title}」请补充截止时刻，或勾选“仅日期”`);
      if (!c.noDue && !c.dueDate && c.dueTime) problems.push(`「${c.title}」有时刻时需要选择日期`);
      if (c.raw.ambiguous && !c.noDue && !c.ambResolved) problems.push(`「${c.title}」的时间表述待确认：请核对后勾选“我已核对”，或暂不设 DDL`);
      const dup = findDuplicate(c);
      if (dup && !c.dupConfirmed) problems.push(`「${c.title}」与已有任务相近，请确认不是重复`);
    }
    if (problems.length) {
      errBox.innerHTML = errBlock(problems.join('；'));
      return;
    }
    const ok = await confirmDialog({
      title: '确认创建任务',
      message: `将创建 <b>${chosen.length}</b> 个任务，状态均为“未开始”，提醒使用你的默认设置。<br>未勾选的候选不会保存；创建后仍可在任务详情里修改或删除。`,
      confirmText: `创建 ${chosen.length} 个任务`,
    });
    if (!ok) return;

    state.saving = true;
    const btn = d.foot.querySelector('#ai-save');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:15px;height:15px;border-width:2px"></span> 正在保存…';
    const items = chosen.map(c => {
      const [oT, oI] = c.owner ? c.owner.split(':') : [null, null];
      const due = !c.noDue && c.dueDate
        ? { date: c.dueDate, time: c.dateOnly ? null : c.dueTime, dateOnly: c.dateOnly }
        : null;
      return {
        key: c.key, title: c.title.trim(), type: c.type,
        ownerType: oT, ownerId: oI, planCategory: oT ? null : c.planCategory, due, needsSubmit: c.needsSubmit,
        sourceText: c.raw.requirement,
        sourceLink: c.raw.sourceLink || '',
        note: [c.raw.submitHint, c.raw.note].filter(Boolean).join('；'),
      };
    });
    try {
      const res = await api.post('/api/ai/save', { batchKey: state.batchKey, items });
      let okN = 0, failN = 0;
      for (const r of res.results) {
        const c = state.candidates.find(x => x.key === r.key);
        if (!c) continue;
        c.result = r;
        if (r.ok) { okN++; c.selected = false; } else failN++;
      }
      await refresh();
      if (failN) {
        state.batchKey = uid(); // 失败项重试使用新批次；成功项不会重复创建
        toast(`已创建 ${okN} 个任务，${failN} 个失败，可修改后重试`, 'err');
        renderCandidates('部分条目保存失败，失败原因见各卡片。修改后点“保存所选”仅重试失败项。');
      } else {
        toast(`已创建 ${okN} 个任务`);
        d.close();
        location.hash = '#/plan';
      }
    } catch (e) {
      // 网络错误：保留同一 batchKey，重试时服务端幂等回放，不会重复创建
      errBox.innerHTML = errBlock((e.message || '保存失败') + '。候选内容已保留，可直接重试；重复点击不会产生重复任务。');
      btn.disabled = false;
      btn.innerHTML = icon('check', 16) + ' 重试保存';
    } finally {
      state.saving = false;
    }
  }

  renderInput();
}