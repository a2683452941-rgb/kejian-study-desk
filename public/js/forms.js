import { api } from './api.js';
import { icon } from './icons.js';
import { esc, TYPE_LABEL, STATUS_LABEL, PHASE_LABEL, ACT_TYPE_LABEL, WD, fmtDateCN, isEnded, isOverdue, dayDiff, addDaysStr } from './util.js';
import { S, now, refresh, course, activity, task, ownerOf, ownerLabel, tasksOf, slotsOf, unfinishedTasks, resourcesOf, taskCategory, taskMatchesOwner, catPillHtml, CAT_LABEL } from './state.js';
import { openDialog, confirmDialog, toast, switchHtml, showFieldError, clearFieldErrors, errBlock } from './ui.js';

// ================= 通用保存包装 =================
async function saveWithConflictRetry(doSave, reopenWithLatest) {
  try {
    return await doSave();
  } catch (err) {
    if (err.status === 409 && err.latest) {
      const ok = await confirmDialog({
        title: '这条记录已在别处更新',
        message: '你正在编辑的内容基于旧版本。要加载最新内容重新编辑吗？<br><span class="muted tiny">当前输入不会自动覆盖最新版本。</span>',
        confirmText: '加载最新版本',
      });
      if (ok && reopenWithLatest) { reopenWithLatest(err.latest); return undefined; }
      throw err;
    }
    throw err;
  }
}

function ownerOptions(selectedType, selectedId, category = 'other') {
  const val = selectedType ? `${selectedType}:${selectedId}` : '';
  const opt = (type, x) => `<option value="${type}:${x.id}" ${val === type + ':' + x.id ? 'selected' : ''}>${esc(x.name)}</option>`;
  const cs = S.courses.filter(c => !c.archived).map(c => opt('course', c)).join('');
  const as = S.activities.filter(a => !a.archived && a.type !== 'contest').map(a => opt('activity', a)).join('');
  const ct = S.activities.filter(a => !a.archived && a.type === 'contest').map(a => opt('activity', a)).join('');
  const groups = [
    cs ? `<optgroup label="课程">${cs}</optgroup>` : '',
    as ? `<optgroup label="活动">${as}</optgroup>` : '',
    ct ? `<optgroup label="比赛">${ct}</optgroup>` : '',
  ];
  const order = { study: [0, 1, 2], activity: [1, 2, 0], contest: [2, 1, 0], other: [0, 1, 2] }[category] || [0, 1, 2];
  return `<option value="" ${!val ? 'selected' : ''}>独立待办（不关联）</option>` + order.map(i => groups[i]).join('');
}

// ================= 课程表单 =================
export function openCourseForm(existing = null) {
  const isEdit = !!existing;
  const schedule = existing?.schedule || [];
  const schedRow = (s = {}) => `
    <div class="sched-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;align-items:end">
      <div class="field" style="margin:0"><label>星期</label>
        <select class="input s-wd">${WD.map((w, i) => `<option value="${i}" ${s.weekday === i ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>开始</label><input type="time" class="input s-start" value="${s.start || '08:00'}"></div>
      <div class="field" style="margin:0"><label>结束</label><input type="time" class="input s-end" value="${s.end || '09:40'}"></div>
      <div class="field" style="margin:0"><label>起始周</label><input type="number" class="input s-ws" min="1" value="${s.weekStart || 1}"></div>
      <div class="field" style="margin:0"><label>结束周</label><input type="number" class="input s-we" min="1" value="${s.weekEnd || 16}"></div>
      <div class="field" style="margin:0"><label>单双周</label>
        <select class="input s-wm"><option value="all" ${s.weekMode !== 'odd' && s.weekMode !== 'even' ? 'selected' : ''}>每周</option><option value="odd" ${s.weekMode === 'odd' ? 'selected' : ''}>单周</option><option value="even" ${s.weekMode === 'even' ? 'selected' : ''}>双周</option></select></div>
      <div class="field" style="margin:0;grid-column:1/3"><label>地点</label><input class="input s-loc" value="${esc(s.location || '')}" placeholder="如 三教 305"></div>
      <button type="button" class="btn sm danger s-del" style="margin-bottom:1px">${icon('trash', 14)} 移除</button>
    </div>`;
  const d = openDialog({
    title: isEdit ? '编辑课程' : '新增课程',
    eyebrow: isEdit ? 'EDIT COURSE' : 'NEW COURSE',
    wide: true,
    body: `
      <form id="course-form" novalidate>
        <div data-field="name" class="field"><label>课程名称 <span class="req">*</span></label>
          <input class="input" name="name" maxlength="100" value="${esc(existing?.name || '')}" placeholder="如 数据结构"></div>
        <div class="form-grid">
          <div data-field="term" class="field"><label>所属学期</label><input class="input" name="term" value="${esc(existing?.term || '2026秋')}" placeholder="如 2026秋"></div>
          <div data-field="teacher" class="field"><label>授课教师</label><input class="input" name="teacher" value="${esc(existing?.teacher || '')}" placeholder="可写多位教师"></div>
        </div>
        <details class="opt" ${schedule.length || existing?.note || existing?.termStart ? 'open' : ''}>
          <summary>${icon('chevR', 15)} 可选信息 · 上课安排与说明</summary>
          <div class="opt-body">
            <div class="field"><label>学期第一周起始日</label><input type="date" class="input" name="termStart" value="${existing?.termStart || ''}">
              <div class="field-hint">需要把周次映射为具体日期时填写；不填也可以记录周次。</div></div>
            <div class="field"><label>上课安排（可添加多组）</label><div id="sched-list">${schedule.map(schedRow).join('')}</div>
              <button type="button" class="btn sm soft" id="add-sched">${icon('plus', 14)} 添加一组</button></div>
            <div class="field"><label>课程说明</label><textarea class="input" name="note" placeholder="考核方式、提交要求等">${esc(existing?.note || '')}</textarea></div>
          </div>
        </details>
        <div id="form-err"></div>
      </form>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${isEdit ? '保存修改' : '创建课程'}</button>`,
  });
  const form = d.body.querySelector('#course-form');
  const list = d.body.querySelector('#sched-list');
  d.body.querySelector('#add-sched').addEventListener('click', () => list.insertAdjacentHTML('beforeend', schedRow()));
  list.addEventListener('click', e => { const del = e.target.closest('.s-del'); if (del) del.closest('.sched-row').remove(); });
  d.foot.querySelector('[data-cancel]').addEventListener('click', d.close);
  d.foot.querySelector('[data-save]').addEventListener('click', async () => {
    clearFieldErrors(form);
    const name = form.name.value.trim();
    if (!name) { showFieldError(form, 'name', '请填写课程名称'); return; }
    const schedule = [...list.querySelectorAll('.sched-row')].map(r => ({
      weekday: +r.querySelector('.s-wd').value,
      start: r.querySelector('.s-start').value, end: r.querySelector('.s-end').value,
      weekStart: +r.querySelector('.s-ws').value, weekEnd: +r.querySelector('.s-we').value,
      weekMode: r.querySelector('.s-wm').value, location: r.querySelector('.s-loc').value.trim(),
    }));
    for (const s of schedule) {
      if (!s.start || !s.end || s.end <= s.start) { d.body.querySelector('#form-err').innerHTML = errBlock('上课安排的结束时间需晚于开始时间'); return; }
      if (!Number.isInteger(s.weekStart) || !Number.isInteger(s.weekEnd) || s.weekStart < 1 || s.weekEnd < 1 || s.weekStart > s.weekEnd) {
        d.body.querySelector('#form-err').innerHTML = errBlock('周次需为正整数，且起始周不大于结束周'); return;
      }
    }
    const payload = { name, term: form.term.value.trim(), teacher: form.teacher.value.trim(), termStart: form.termStart.value, note: form.note.value, schedule };
    const btn = d.foot.querySelector('[data-save]'); btn.disabled = true;
    try {
      const res = await saveWithConflictRetry(
        () => isEdit ? api.patch('/api/courses/' + existing.id, { ...payload, v: existing.v }) : api.post('/api/courses', payload),
        latest => { d.close(); openCourseForm(latest); },
      );
      if (!res) return;
      if (res.dupWarning) toast(res.dupWarning, 'err');
      else toast(isEdit ? '课程已保存' : '课程已创建');
      d.close(); await refresh();
      if (!isEdit) location.hash = '#/course/' + res.course.id;
    } catch (err) {
      d.body.querySelector('#form-err').innerHTML = errBlock(err.message);
    } finally { btn.disabled = false; }
  });
}

// ================= 活动表单 =================
export function openActivityForm(existing = null) {
  const isEdit = !!existing;
  const d = openDialog({
    title: isEdit ? '编辑活动' : '新增活动',
    eyebrow: isEdit ? 'EDIT ACTIVITY' : 'NEW ACTIVITY',
    body: `
      <form id="act-form" novalidate>
        <div data-field="name" class="field"><label>活动名称 <span class="req">*</span></label>
          <input class="input" name="name" maxlength="100" value="${esc(existing?.name || '')}" placeholder="如 前沿科技讲座"></div>
        <div class="form-grid">
          <div class="field"><label>活动类型 <span class="req">*</span></label>
            <select class="input" name="type">${Object.entries(ACT_TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${(existing?.type || 'other') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>活动阶段</label>
            <select class="input" name="phase">${Object.entries(PHASE_LABEL).map(([k, v]) => `<option value="${k}" ${(existing?.phase || 'preparing') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>开始时间</label><input type="datetime-local" class="input" name="start" value="${existing?.start || ''}"></div>
          <div class="field"><label>结束时间</label><input type="datetime-local" class="input" name="end" value="${existing?.end || ''}"></div>
          <div class="field"><label>活动地点</label><input class="input" name="location" value="${esc(existing?.location || '')}" placeholder="线下地点"></div>
          <div class="field"><label>线上地址</label><input class="input" name="online" value="${esc(existing?.online || '')}" placeholder="会议链接等"></div>
        </div>
        <div class="field-hint mb">时间可以留空（时间待定）。节点任务的截止时间独立设置，不受活动时间影响。</div>
        <details class="opt" ${existing?.host || existing?.note ? 'open' : ''}>
          <summary>${icon('chevR', 15)} 可选信息</summary>
          <div class="opt-body">
            <div class="field"><label>主办方 / 联系人</label><input class="input" name="host" value="${esc(existing?.host || '')}" placeholder="仅作个人备注"></div>
            <div class="field"><label>活动说明</label><textarea class="input" name="note" placeholder="参与要求、学分说明等">${esc(existing?.note || '')}</textarea></div>
          </div>
        </details>
        <div id="form-err"></div>
      </form>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${isEdit ? '保存修改' : '创建活动'}</button>`,
  });
  const form = d.body.querySelector('#act-form');
  d.foot.querySelector('[data-cancel]').addEventListener('click', d.close);
  d.foot.querySelector('[data-save]').addEventListener('click', async () => {
    clearFieldErrors(form);
    const name = form.name.value.trim();
    if (!name) { showFieldError(form, 'name', '请填写活动名称'); return; }
    const start = form.start.value, end = form.end.value;
    if (start && end && end < start) { d.body.querySelector('#form-err').innerHTML = errBlock('结束时间不能早于开始时间'); return; }
    const payload = { name, type: form.type.value, phase: form.phase.value, start, end, location: form.location.value.trim(), online: form.online.value.trim(), host: form.host.value.trim(), note: form.note.value };
    if (isEdit && existing.phase !== 'cancelled' && payload.phase === 'cancelled') {
      const nodes = unfinishedTasks('activity', existing.id);
      const ok = await confirmDialog({
        title: '将活动改为已取消',
        message: nodes.length
          ? `该活动还有 <b>${nodes.length}</b> 个未完成节点：${nodes.map(t => esc(t.title)).join('、')}。<br>确认后这些节点将被取消并停止未来提醒，已上传的资料会保留。`
          : '确认后活动将标记为已取消，资料保留。',
        confirmText: '确认取消活动', danger: true,
      });
      if (!ok) return;
      payload.confirmCancel = true;
    }
    const btn = d.foot.querySelector('[data-save]'); btn.disabled = true;
    try {
      const res = await saveWithConflictRetry(
        () => isEdit ? api.patch('/api/activities/' + existing.id, { ...payload, v: existing.v }) : api.post('/api/activities', payload),
        latest => { d.close(); openActivityForm(latest); },
      );
      if (!res) return;
      toast(isEdit ? '活动已保存' : '活动已创建');
      if (res.timeChanged) toast('活动时间已修改，请检查报名截止等节点时间是否需要同步调整', 'err');
      if (res.cancelledNodes) toast(`已取消 ${res.cancelledNodes} 个未完成节点`);
      d.close(); await refresh();
      if (!isEdit) location.hash = '#/activity/' + res.activity.id;
    } catch (err) {
      d.body.querySelector('#form-err').innerHTML = errBlock(err.message);
    } finally { btn.disabled = false; }
  });
}

// ================= 任务表单 =================
export function openTaskForm({ task: existing = null, ownerType = null, ownerId = null, preset = null, onCreated = null } = {}) {
  const isEdit = !!existing;
  const base = existing || preset || {};
  const oType = existing ? existing.ownerType : ownerType;
  const oId = existing ? existing.ownerId : ownerId;
  const initialCat = oType
    ? taskCategory({ ownerType: oType, ownerId: oId, type: base.type || 'todo' })
    : (['study', 'activity', 'contest', 'other'].includes(base.planCategory) ? base.planCategory
      : (['homework', 'exam'].includes(base.type || 'homework') ? 'study' : 'other'));
  const due = base.due || null;
  const remind = base.remind || { channel: 'both', freq: 'daily', lead: 7, days: [7, 3, 1, 0], overdue: true, planDaily: true };
  const members = base.members || [];
  const memberRow = (m = {}) => `
    <div class="member-edit-row row gap-sm mb-sm">
      <input class="input m-name" style="flex:1" placeholder="姓名" value="${esc(m.name || '')}">
      <input class="input m-role" style="flex:2" placeholder="职责，如 撰写初稿" value="${esc(m.role || '')}">
      <button type="button" class="icon-btn m-del" aria-label="移除">${icon('x', 16)}</button>
    </div>`;
  const d = openDialog({
    title: isEdit ? '编辑任务' : '新增任务',
    eyebrow: isEdit ? 'EDIT TASK' : 'NEW TASK',
    wide: true,
    body: `
      <form id="task-form" novalidate>
        <div data-field="title" class="field"><label>标题 <span class="req">*</span></label>
          <input class="input" name="title" maxlength="200" value="${esc(base.title || '')}" placeholder="如 作业三 · 二叉树的遍历"></div>
        <div class="form-grid">
          <div class="field"><label>类型 <span class="req">*</span></label>
            <select class="input" name="type">${Object.entries(TYPE_LABEL).map(([k, v]) => `<option value="${k}" ${(base.type || 'homework') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label>计划类别</label>
            <select class="input" name="planCategory" ${oType ? 'disabled' : ''}>${[['study', '学习'], ['activity', '活动'], ['contest', '比赛'], ['other', '其他']].map(([k, v]) => `<option value="${k}" ${initialCat === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <div class="field-hint" id="tf-cat-hint"></div></div>
        </div>
        <div data-field="owner" class="field"><label>所属课程 / 活动 / 比赛</label><select class="input" name="owner">${ownerOptions(oType, oId, initialCat)}</select></div>
        <div class="form-grid">
          <div data-field="dueDate" class="field"><label>${base.type === 'exam' ? '考试开始日期' : '截止日期'}</label>
            <input type="date" class="input" name="dueDate" value="${due?.date || ''}"></div>
          <div data-field="dueTime" class="field"><label>具体时刻</label>
            <input type="time" class="input" name="dueTime" value="${due?.time || ''}" ${due?.dateOnly ? 'disabled' : ''}></div>
        </div>
        <div class="switch-row" style="padding-top:0">
          <div class="sw-text"><div class="sw-title">仅日期（不指定具体时刻）</div><div class="sw-sub">按当日末尾排序，次日 00:00 起判为逾期</div></div>
          <label class="switch"><input type="checkbox" name="dateOnly" ${due?.dateOnly ? 'checked' : ''}><span class="track"></span><span class="knob"></span></label>
        </div>
        ${switchHtml('tf-submit', base.needsSubmit ?? ((base.type || 'homework') === 'homework'), '是否需要提交', '作业默认需要提交；上传文件不等于已提交')}
        <details class="opt" ${base.note || base.sourceText || members.length || isEdit ? 'open' : ''}>
          <summary>${icon('chevR', 15)} 可选信息 · 要求、来源、分工、提醒${isEdit ? '、成绩' : ''}</summary>
          <div class="opt-body">
            <div class="field"><label>要求 / 备注</label><textarea class="input" name="note" placeholder="作业要求或事项说明">${esc(base.note || '')}</textarea></div>
            <div class="field"><label>来源文字</label><textarea class="input" name="sourceText" placeholder="保留通知原文，便于核对">${esc(base.sourceText || '')}</textarea></div>
            <div class="field"><label>来源链接</label><input class="input" name="sourceLink" value="${esc(base.sourceLink || '')}" placeholder="https://…"></div>
            <div class="field"><label>分工（姓名 + 职责，仅文字记录）</label>
              <div id="member-list">${members.map(memberRow).join('')}</div>
              <button type="button" class="btn sm soft" id="add-member">${icon('plus', 14)} 添加成员</button></div>
            <hr class="sep">
            <div class="form-grid">
              <div class="field"><label>提醒渠道</label>
                <select class="input" name="rChannel">
                  <option value="inapp" ${remind.channel === 'inapp' ? 'selected' : ''}>仅站内</option>
                  <option value="both" ${remind.channel === 'both' ? 'selected' : ''}>站内 + 邮件</option>
                  <option value="off" ${remind.channel === 'off' ? 'selected' : ''}>关闭主动提醒</option>
                </select></div>
              <div class="field"><label>DDL 提醒频率</label>
                <select class="input" name="rFreq">
                  <option value="daily" ${remind.freq !== 'custom' ? 'selected' : ''}>每天（提前 N 天开始）</option>
                  <option value="custom" ${remind.freq === 'custom' ? 'selected' : ''}>自选提前天数</option>
                </select></div>
              <div class="field" id="lead-field" ${remind.freq === 'custom' ? 'style="display:none"' : ''}><label>提前天数（0—365）</label>
                <input type="number" class="input" name="rLead" min="0" max="365" value="${remind.lead ?? 7}"></div>
              <div class="field" id="days-field" ${remind.freq !== 'custom' ? 'style="display:none"' : ''}><label>提前天数集合</label>
                <input class="input" name="rDays" value="${(remind.days || [7, 3, 1, 0]).join(', ')}" placeholder="如 7, 3, 1, 0">
                <div class="field-hint">0 代表目标日当天</div></div>
            </div>
            ${switchHtml('tf-overdue', remind.overdue !== false, '逾期后继续提醒', '默认每天提醒，直到完成或关闭')}
            ${switchHtml('tf-plan', remind.planDaily !== false, '计划当日提醒', '汇总当天待执行的学习时段')}
            ${isEdit ? `
            <hr class="sep">
            <div class="form-grid">
              <div class="field"><label>分数</label><input type="number" step="0.1" min="0" class="input" name="scoreValue" value="${existing.score?.value ?? ''}"></div>
              <div class="field"><label>满分</label><input type="number" step="0.1" min="0.1" class="input" name="scoreMax" value="${existing.score?.max ?? ''}"></div>
              <div class="field full"><label>反馈 / 成绩备注</label><input class="input" name="scoreFeedback" value="${esc(existing.score?.feedback || '')}" placeholder="等级、教师反馈等"></div>
            </div>
            <div class="field-hint">录入成绩不会自动完成或提交任务。</div>` : ''}
          </div>
        </details>
        <div id="form-err"></div>
      </form>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${isEdit ? '保存修改' : '创建任务'}</button>`,
  });
  const form = d.body.querySelector('#task-form');
  const dateOnly = form.dateOnly, dueTime = form.dueTime;
  dateOnly.addEventListener('change', () => { dueTime.disabled = dateOnly.checked; if (dateOnly.checked) dueTime.value = ''; });
  // 类别与归属联动：有归属时按对象推导；取消归属保留当前类别供修改
  const catSel = form.planCategory, ownerSel = form.owner, catHint = d.body.querySelector('#tf-cat-hint');
  const derivedCat = () => {
    const [oT, oI] = ownerSel.value ? ownerSel.value.split(':') : [null, null];
    return oT ? taskCategory({ ownerType: oT, ownerId: oI, type: form.type.value }) : null;
  };
  const syncCat = () => {
    const dc = derivedCat();
    if (dc) {
      catSel.value = dc; catSel.disabled = true;
      catHint.textContent = `已关联「${ownerSel.selectedOptions[0]?.textContent || ''}」，类别自动判定为「${CAT_LABEL[dc]}」`;
    } else {
      catSel.disabled = false;
      catHint.textContent = '独立任务的类别；关联课程 / 活动 / 比赛后按对象自动判定';
    }
  };
  ownerSel.addEventListener('change', () => {
    const [oT, oI] = ownerSel.value ? ownerSel.value.split(':') : [null, null];
    ownerSel.innerHTML = ownerOptions(oT, oI, derivedCat() || catSel.value);
    syncCat();
  });
  catSel.addEventListener('change', () => {
    const [oT, oI] = ownerSel.value ? ownerSel.value.split(':') : [null, null];
    ownerSel.innerHTML = ownerOptions(oT, oI, catSel.value);
  });
  syncCat();
  form.type.addEventListener('change', () => {
    if (!isEdit) form.querySelector('#tf-submit').checked = form.type.value === 'homework';
  });
  form.rFreq.addEventListener('change', () => {
    d.body.querySelector('#lead-field').style.display = form.rFreq.value === 'custom' ? 'none' : '';
    d.body.querySelector('#days-field').style.display = form.rFreq.value === 'custom' ? '' : 'none';
  });
  const mList = d.body.querySelector('#member-list');
  d.body.querySelector('#add-member').addEventListener('click', () => mList.insertAdjacentHTML('beforeend', memberRow()));
  mList.addEventListener('click', e => { const del = e.target.closest('.m-del'); if (del) del.closest('.member-edit-row').remove(); });
  d.foot.querySelector('[data-cancel]').addEventListener('click', d.close);

  async function doSave(extra = {}) {
    clearFieldErrors(form);
    const title = form.title.value.trim();
    if (!title) { showFieldError(form, 'title', '请填写任务标题'); return; }
    const dd = form.dueDate.value, dt = form.dueTime.value;
    let dueVal = null;
    if (dd) {
      if (dateOnly.checked) dueVal = { date: dd, time: null, dateOnly: true };
      else if (dt) dueVal = { date: dd, time: dt, dateOnly: false };
      else { showFieldError(form, 'dueTime', '请补充具体时刻，或勾选“仅日期”'); return; }
    } else if (dt) { showFieldError(form, 'dueDate', '有时刻时需要选择日期'); return; }
    const [oT, oI] = form.owner.value ? form.owner.value.split(':') : [null, null];
    const members = [...mList.querySelectorAll('.member-edit-row')].map(r => ({ name: r.querySelector('.m-name').value.trim(), role: r.querySelector('.m-role').value.trim() })).filter(m => m.name);
    const days = form.rDays.value.split(/[,，\s]+/).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= 365);
    const payload = {
      title, type: form.type.value, ownerType: oT, ownerId: oI,
      planCategory: oT ? null : catSel.value,
      due: dueVal,
      needsSubmit: form.querySelector('#tf-submit').checked,
      note: form.note.value, sourceText: form.sourceText.value, sourceLink: form.sourceLink.value.trim(),
      members,
      remind: {
        channel: form.rChannel.value, freq: form.rFreq.value,
        lead: +form.rLead.value || 0, days: days.length ? days : [0],
        overdue: form.querySelector('#tf-overdue').checked, planDaily: form.querySelector('#tf-plan').checked,
      },
      ...extra,
    };
    if (isEdit) {
      payload.v = existing.v;
      const sv = form.scoreValue.value, sm = form.scoreMax.value;
      if (sv !== '' || sm !== '') payload.score = { value: sv === '' ? 0 : +sv, max: sm === '' ? 100 : +sm, feedback: form.scoreFeedback.value };
      else payload.score = null;
    }
    // 过去时间补记提示
    if (dueVal && !extra._pastConfirmed) {
      const n = now();
      const past = dueVal.dateOnly ? dueVal.date < n.date : (dueVal.date < n.date || (dueVal.date === n.date && (dueVal.time || '23:59') < n.time));
      if (past) {
        const ok = await confirmDialog({
          title: '该时间已经过去',
          message: '保存后任务将立即显示为逾期（可用于补记）。系统不会补发历史多日的邮件摘要。',
          confirmText: '仍要保存',
        });
        if (!ok) return;
        payload._pastConfirmed = true;
      }
    }
    const btn = d.foot.querySelector('[data-save]'); btn.disabled = true;
    try {
      const res = await saveWithConflictRetry(
        () => isEdit ? api.patch('/api/tasks/' + existing.id, payload) : api.post('/api/tasks', payload),
        latest => { d.close(); openTaskForm({ task: latest }); },
      );
      if (!res) return;
      toast(isEdit ? '任务已保存' : '任务已创建');
      d.close(); await refresh();
      if (!isEdit && onCreated) onCreated(res.task);
      if (!isEdit && !preset?.stay && !onCreated) location.hash = '#/task/' + res.task.id;
    } catch (err) {
      if (err.code === 'need_confirm_mapping') {
        const from = STATUS_LABEL[err.extra.mapping.from], to = STATUS_LABEL[err.extra.mapping.to];
        const ok = await confirmDialog({
          title: '更改提交要求会影响状态',
          message: `当前状态「${from}」将映射为「${to}」：<br><span class="muted tiny">未开始/进行中保持；待提交→进行中；已完成→待提交；已提交→已完成；取消保持。</span>`,
          confirmText: '确认变更',
        });
        if (ok) { btn.disabled = false; return doSave({ ...extra, confirmMapping: true }); }
      } else if (err.code === 'score_over') {
        const ok = await confirmDialog({ title: '分数超出满分', message: '填写的分数大于满分，是否仍要按原样保存？', confirmText: '仍要保存' });
        if (ok) { btn.disabled = false; return doSave({ ...extra, confirmOver: true }); }
      } else {
        d.body.querySelector('#form-err').innerHTML = errBlock(err.message);
      }
    } finally { btn.disabled = false; }
  }
  d.foot.querySelector('[data-save]').addEventListener('click', () => doSave());
}

// ================= 计划时段表单 =================
export function openSlotForm({ slot: existing = null, taskId = null, date = null, category = 'all', owner = null } = {}) {
  const isEdit = !!existing;
  const base = existing || {};
  const tId = base.taskId || taskId;
  const optionsHtml = selId => S.tasks
    .filter(t => (!isEnded(t) || t.id === selId)
      && (t.id === selId || ((category === 'all' || taskCategory(t) === category) && taskMatchesOwner(t, owner))))
    .map(t => `<option value="${t.id}" ${t.id === selId ? 'selected' : ''}>${esc(t.title)}（${esc(ownerLabel(t))}）</option>`).join('');
  const timed = !!(base.start || (!isEdit && false));
  const d = openDialog({
    title: isEdit ? '编辑时段' : '安排时段',
    eyebrow: isEdit ? 'EDIT SLOT' : 'NEW SLOT',
    body: `
      <form id="slot-form" novalidate>
        <div data-field="taskId" class="field"><label>关联任务 <span class="req">*</span></label>
          <select class="input" name="taskId">${optionsHtml(tId) || '<option value="">暂无匹配任务</option>'}</select>
          <div class="field-hint row gap-sm" id="sf-cat" style="align-items:center"></div>
          <div class="field-hint">计划是“打算何时做”，不改变任务的截止时间。没有合适任务？<button type="button" class="link-btn" id="sf-new-task">先创建任务</button></div></div>
        <div class="field"><label>时段说明</label><input class="input" name="title" value="${esc(base.title || '')}" placeholder="如 查资料 / 写初稿（默认用任务标题）"></div>
        <div data-field="date" class="field"><label>日期 <span class="req">*</span></label><input type="date" class="input" name="date" value="${base.date || date || now().date}"></div>
        ${switchHtml('sf-timed', timed, '具体时间段', '关闭则为当天的无具体时间计划')}
        <div class="form-grid" id="time-fields" ${timed ? '' : 'style="display:none"'}>
          <div class="field"><label>开始</label><input type="time" class="input" name="start" value="${base.start || '19:00'}"></div>
          <div class="field"><label>结束</label><input type="time" class="input" name="end" value="${base.end || '21:00'}"></div>
        </div>
        <div class="field-hint mb" id="crossday-hint" style="display:none">结束早于开始将按跨日（次日结束）处理。</div>
        ${isEdit ? `<div class="field"><label>时段状态</label><select class="input" name="status">
          ${Object.entries({ pending: '待执行', done: '已完成', skipped: '已跳过', obsolete: '不再需要' }).map(([k, v]) => `<option value="${k}" ${base.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>` : ''}
        <div id="form-err"></div>
      </form>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${isEdit ? '保存修改' : '添加时段'}</button>`,
  });
  const form = d.body.querySelector('#slot-form');
  const catHint = d.body.querySelector('#sf-cat');
  const updateCatHint = () => {
    const t = task(form.taskId.value);
    catHint.innerHTML = t
      ? `${catPillHtml(taskCategory(t))}<span>所属：${esc(ownerLabel(t))}</span>`
      : '<span>请选择要安排的任务</span>';
  };
  form.taskId.addEventListener('change', updateCatHint);
  updateCatHint();
  d.body.querySelector('#sf-new-task').addEventListener('click', () => {
    openTaskForm({
      ownerType: owner?.type || null, ownerId: owner?.id || null,
      preset: { type: 'todo', needsSubmit: false, planCategory: category === 'all' ? 'other' : category },
      onCreated: t => { form.taskId.innerHTML = optionsHtml(t.id); updateCatHint(); },
    });
  });
  const timedBox = form.querySelector('#sf-timed');
  timedBox.addEventListener('change', () => {
    d.body.querySelector('#time-fields').style.display = timedBox.checked ? '' : 'none';
  });
  const checkCross = () => {
    const s = form.start.value, e = form.end.value;
    d.body.querySelector('#crossday-hint').style.display = (timedBox.checked && s && e && e <= s) ? '' : 'none';
  };
  form.start.addEventListener('change', checkCross); form.end.addEventListener('change', checkCross);
  d.foot.querySelector('[data-cancel]').addEventListener('click', d.close);
  d.foot.querySelector('[data-save]').addEventListener('click', async () => {
    clearFieldErrors(form);
    if (!form.taskId.value) { showFieldError(form, 'taskId', '请先创建一个任务'); return; }
    if (!form.date.value) { showFieldError(form, 'date', '请选择日期'); return; }
    const isTimed = timedBox.checked;
    const payload = {
      taskId: form.taskId.value, title: form.title.value.trim(), date: form.date.value,
      start: isTimed ? form.start.value : null, end: isTimed ? form.end.value : null,
    };
    if (isEdit) { payload.v = existing.v; payload.status = form.status.value; }
    if (isTimed && (!payload.start || !payload.end)) { d.body.querySelector('#form-err').innerHTML = errBlock('具体时段需填写开始与结束时间'); return; }
    // 风险提示：重叠 / 排在 DDL 之后
    const risks = [];
    const tk = task(payload.taskId);
    if (isTimed) {
      const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      let s = toMin(payload.start), e = toMin(payload.end);
      const cross = e <= s; if (cross) e += 1440;
      for (const o of S.slots) {
        if (o.id === existing?.id || o.taskId === undefined) continue;
        if (o.date !== payload.date || !o.start || o.status === 'obsolete') continue;
        let os = toMin(o.start), oe = toMin(o.end); if (oe <= os) oe += 1440;
        if (s < oe && os < e) risks.push(`与「${esc(o.title || task(o.taskId)?.title || '其他时段')}」(${o.start}–${o.end}) 重叠`);
      }
      if (cross) risks.push('该时段跨日，结束时间为次日');
    }
    if (tk?.due?.date) {
      const endDay = payload.date;
      if (endDay > tk.due.date || (!tk.due.dateOnly && endDay === tk.due.date && isTimed && payload.start > (tk.due.time || '23:59'))) {
        risks.push('该安排晚于任务截止时间，可能来不及完成');
      }
    }
    if (risks.length && !payload._riskConfirmed) {
      const ok = await confirmDialog({
        title: '安排存在风险',
        message: risks.map(r => '· ' + r).join('<br>') + '<br><span class="muted tiny">仍要保存吗？不会自动更改其他安排。</span>',
        confirmText: '仍要保存',
      });
      if (!ok) return;
    }
    const btn = d.foot.querySelector('[data-save]'); btn.disabled = true;
    try {
      const res = await saveWithConflictRetry(
        () => isEdit ? api.patch('/api/slots/' + existing.id, payload) : api.post('/api/slots', payload),
        latest => { d.close(); openSlotForm({ slot: latest }); },
      );
      if (!res) return;
      toast(isEdit ? '时段已保存' : '时段已安排');
      d.close(); await refresh();
    } catch (err) {
      d.body.querySelector('#form-err').innerHTML = errBlock(err.message);
    } finally { btn.disabled = false; }
  });
}

// ================= 资料链接表单 =================
export function openLinkForm({ ownerType, ownerId, resource: existing = null }) {
  const isEdit = !!existing;
  const d = openDialog({
    title: isEdit ? '编辑资料链接' : '保存资料链接',
    eyebrow: 'RESOURCE LINK',
    body: `
      <form id="link-form" novalidate>
        <div class="field"><label>标题</label><input class="input" name="title" value="${esc(existing?.title || '')}" placeholder="如 MOOC 配套视频"></div>
        <div data-field="url" class="field"><label>地址 <span class="req">*</span></label><input class="input" name="url" value="${esc(existing?.url || '')}" placeholder="https://…"></div>
        <div class="field"><label>说明（提取码等按私人资料保存）</label><textarea class="input" name="note">${esc(existing?.note || '')}</textarea></div>
        <div class="field-hint">外链不计文件容量，不自动搬运内容；打开时跳转到原链接，下载取决于来源站点。</div>
        <div id="form-err"></div>
      </form>`,
    footer: `<button class="btn" data-cancel>取消</button><button class="btn primary" data-save>${isEdit ? '保存' : '保存链接'}</button>`,
  });
  const form = d.body.querySelector('#link-form');
  d.foot.querySelector('[data-cancel]').addEventListener('click', d.close);
  d.foot.querySelector('[data-save]').addEventListener('click', async () => {
    clearFieldErrors(form);
    const url = form.url.value.trim();
    if (!/^https?:\/\//.test(url)) { showFieldError(form, 'url', '链接需以 http:// 或 https:// 开头'); return; }
    const btn = d.foot.querySelector('[data-save]'); btn.disabled = true;
    try {
      if (isEdit) await api.patch('/api/resources/' + existing.id, { title: form.title.value.trim(), url, note: form.note.value, v: existing.v });
      else await api.post('/api/resources', { kind: 'link', title: form.title.value.trim(), url, note: form.note.value, owners: [{ type: ownerType, id: ownerId }], category: 'reference' });
      toast('链接已保存'); d.close(); await refresh();
    } catch (err) {
      d.body.querySelector('#form-err').innerHTML = errBlock(err.message);
    } finally { btn.disabled = false; }
  });
}

// ================= 状态操作 =================
export async function quickComplete(taskId) {
  const t = task(taskId); if (!t) return;
  if (['submitted', 'done'].includes(t.status)) {
    const ok = await confirmDialog({
      title: '重新打开任务',
      message: '将清除当前结束状态并回到「进行中」。文件与成绩保留，未来提醒按最新时间规则恢复；已标为“不再需要”的时段不会自动恢复。',
      confirmText: '重新打开',
    });
    if (!ok) return;
    await api.patch('/api/tasks/' + t.id, { status: 'doing', v: t.v });
    toast('任务已重新打开'); await refresh(); return;
  }
  if (t.status === 'cancelled') {
    await api.patch('/api/tasks/' + t.id, { status: 'doing', v: t.v });
    toast('任务已恢复'); await refresh(); return;
  }
  if (t.needsSubmit) {
    const ok = await confirmDialog({
      title: '确认已提交',
      message: '这代表你个人确认已经提交，<b>不代表学校平台已核验</b>。确认后未来提醒停止。<br><span class="muted tiny">上传文件不会自动变为已提交；如需凭证，可在任务详情上传。</span>',
      confirmText: '确认已提交',
    });
    if (!ok) return;
    await api.patch('/api/tasks/' + t.id, { status: 'submitted', v: t.v });
    toast('已确认提交，未来提醒已停止'); await refresh();
  } else {
    await api.patch('/api/tasks/' + t.id, { status: 'done', v: t.v });
    toast('已完成，做得好'); await refresh();
  }
}

export async function setTaskStatus(t, status) {
  if (status === t.status) return;
  if (status === 'submitted') {
    const ok = await confirmDialog({
      title: '确认已提交',
      message: '由你主动确认，不代表学校平台已核验。确认后未来提醒停止，可在任务详情补充提交凭证。',
      confirmText: '确认已提交',
    });
    if (!ok) return;
  }
  if (['submitted', 'done'].includes(t.status) && !['submitted', 'done', 'cancelled'].includes(status)) {
    toast('已重新打开任务');
  }
  await api.patch('/api/tasks/' + t.id, { status, v: t.v });
  toast('状态已更新为「' + STATUS_LABEL[status] + '」');
  await refresh();
}

// ================= 任务更多菜单 =================
export function openTaskMenu(taskId) {
  const t = task(taskId); if (!t) return;
  const d = openDialog({
    title: t.title, eyebrow: 'TASK ACTIONS',
    body: `<div class="col gap-sm">
      <button class="btn block" data-a="open">${icon('eye')} 查看任务详情</button>
      <button class="btn block" data-a="edit">${icon('edit')} 编辑任务</button>
      <button class="btn block" data-a="slot">${icon('calendar')} 安排时段</button>
      <button class="btn block danger" data-a="del">${icon('trash')} 删除任务…</button>
    </div>`,
  });
  d.body.addEventListener('click', async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    d.close();
    if (b.dataset.a === 'open') location.hash = '#/task/' + t.id;
    if (b.dataset.a === 'edit') openTaskForm({ task: t });
    if (b.dataset.a === 'slot') openSlotForm({ taskId: t.id });
    if (b.dataset.a === 'del') confirmDeleteTask(t);
  });
}

// ================= 归档 / 删除 =================
export async function confirmArchive(type, entity) {
  const un = unfinishedTasks(type, entity.id);
  const label = type === 'course' ? '课程' : '活动';
  if (entity.archived) {
    await api.patch(`/api/${type === 'course' ? 'courses' : 'activities'}/` + entity.id, { archived: false, v: entity.v });
    toast(label + '已恢复'); await refresh(); return;
  }
  const ok = await confirmDialog({
    title: `归档${label}「${entity.name}」`,
    message: (un.length
      ? `还有 <b>${un.length}</b> 个未完成任务。归档后它们<b>仍会</b>出现在首页、计划中心与提醒中，直到完成。<br>`
      : '') + `归档只影响常用列表展示，不删除资料、不释放容量；之后仍可搜索、访问和下载。`,
    confirmText: '继续归档',
  });
  if (!ok) return;
  await api.patch(`/api/${type === 'course' ? 'courses' : 'activities'}/` + entity.id, { archived: true, v: entity.v });
  toast(label + '已归档'); await refresh();
}

export async function confirmDeleteTask(t) {
  const slots = slotsOf(t.id);
  const owned = resourcesOf('task', t.id);
  const exclusive = owned.filter(r => r.owners.length === 1);
  const shared = owned.filter(r => r.owners.length > 1);
  const ok = await confirmDialog({
    title: '永久删除任务',
    message: `「${esc(t.title)}」将被<b>永久删除，无法恢复</b>（首版没有回收站）。<br><br>
      影响清单：<br>· 关联执行时段：<b>${slots.length}</b> 个时段（一并删除）<br>
      · 专属附件：<b>${exclusive.length}</b> 个文件（一并删除）<br>
      · 共享附件：<b>${shared.length}</b> 个（仅移除本任务的关联，文件保留）<br>
      · 未来提醒将停止。`,
    confirmText: '永久删除', danger: true, cancelText: '取消',
  });
  if (!ok) return;
  await api.del('/api/tasks/' + t.id);
  toast('任务已删除'); await refresh();
  if (location.hash.startsWith('#/task/')) location.hash = '#/';
}

export async function confirmDeleteOwner(type, entity) {
  const ts = tasksOf(type, entity.id);
  const slotCount = ts.reduce((n, t) => n + slotsOf(t.id).length, 0);
  const direct = resourcesOf(type, entity.id);
  const allRes = [...direct];
  for (const t of ts) allRes.push(...resourcesOf('task', t.id));
  const seen = new Set(); let files = 0;
  for (const r of allRes) {
    if (seen.has(r.id)) continue; seen.add(r.id);
    const others = r.owners.filter(o => !(o.type === type && o.id === entity.id) && !(o.type === 'task' && ts.some(t => t.id === o.id)));
    if (!others.length) files++;
  }
  const label = type === 'course' ? '课程' : '活动';
  const ok = await confirmDialog({
    title: `永久删除${label}「${entity.name}」`,
    message: `此操作<b>永久且不可恢复</b>。将一并删除：<br>
      · 任务 <b>${ts.length}</b> 项 · 执行时段 <b>${slotCount}</b> 个时段 · 专属文件 <b>${files}</b> 个<br>
      被其他条目引用的共享文件会保留。<br><br>
      <span class="muted tiny">只是想整理列表？可以改为归档，资料与任务都会保留。</span>`,
    confirmText: '永久删除', danger: true, cancelText: '改为归档',
  });
  if (!ok) { await confirmArchive(type, entity); return; }
  const double = await confirmDialog({ title: '再次确认', message: `真的要永久删除「${esc(entity.name)}」及其全部专属内容吗？`, confirmText: '确认删除', danger: true });
  if (!double) return;
  await api.del(`/api/${type === 'course' ? 'courses' : 'activities'}/` + entity.id);
  toast(label + '已删除'); await refresh();
  location.hash = '#/';
}