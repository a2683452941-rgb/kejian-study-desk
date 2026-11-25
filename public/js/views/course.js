import { icon } from '../icons.js';
import { esc, WD, fmtDateCN, isEnded, isOverdue } from '../util.js';
import { S, now, course, tasksOf, resourcesAggregated, unfinishedTasks } from '../state.js';
import { taskRow, bindTaskRows, empty, toast } from '../ui.js';
import { openCourseForm, openTaskForm, openTaskMenu, quickComplete, confirmArchive, confirmDeleteOwner, openLinkForm } from '../forms.js';
import { mountUpload, resourceListHtml, bindResourceList } from '../upload.js';
import { setPlanAnchor } from './plan.js';

const CAT_COLORS = ['green', 'blue', 'peach', 'lilac'];
let statusFilter = 'all';

function scheduleText(c) {
  if (!c.schedule?.length) return '未填写';
  return c.schedule.map(s =>
    `${WD[s.weekday]} ${s.start}–${s.end} · 第${s.weekStart}–${s.weekEnd}周${s.weekMode === 'odd' ? '（单周）' : s.weekMode === 'even' ? '（双周）' : ''}${s.location ? ' · ' + esc(s.location) : ''}`
  ).join('<br>');
}

export async function renderCourse(root, id) {
  const c = course(id);
  if (!c) { root.innerHTML = empty('book', '课程不存在或已被删除', '它可能已被删除，回到首页看看其他课程。', '<button class="btn primary" data-nav="#/">回到首页</button>'); return; }
  const color = CAT_COLORS[S.courses.indexOf(c) % 4];
  const allTasks = tasksOf('course', c.id);
  const n = now();
  let ts = [...allTasks];
  if (statusFilter === 'open') ts = ts.filter(t => !isEnded(t));
  if (statusFilter === 'ended') ts = ts.filter(isEnded);
  if (statusFilter === 'overdue') ts = ts.filter(t => isOverdue(t, n));
  ts.sort((a, b) => (a.due?.date || '9999').localeCompare(b.due?.date || '9999'));
  const res = resourcesAggregated('course', c.id);
  const un = unfinishedTasks('course', c.id).length;

  root.innerHTML = `
    <button class="text-btn mb" data-nav="#/">← 返回首页</button>
    <div class="detail-head">
      <div class="cat-icon ${color}">${icon('book', 26)}</div>
      <div class="dh-text">
        <div class="eyebrow">COURSE</div>
        <h1>${esc(c.name)}</h1>
        <div class="detail-meta">
          ${c.term ? `<span class="pill green">${esc(c.term)}</span>` : ''}
          ${c.teacher ? `<span class="pill blue">${esc(c.teacher)}</span>` : ''}
          <span class="pill gray">${un} 项待完成</span>
          ${c.archived ? '<span class="pill peach">已归档</span>' : ''}
        </div>
      </div>
      <div class="ph-actions">
        <button class="btn" id="c-edit">${icon('edit', 15)} 编辑</button>
        <button class="btn primary" id="c-add-task">${icon('plus', 15)} 加任务</button>
        <button class="icon-btn" id="c-more" aria-label="更多">${icon('more')}</button>
      </div>
    </div>
    ${c.archived ? `<div class="info-block">该课程已归档。资料仍可搜索、访问与下载；其下任务仍会出现在首页与提醒中。编辑前建议先恢复归档。</div>` : ''}
    <div class="detail-grid">
      <div class="detail-main">
        <div class="panel">
          <div class="panel-header">
            <h2>作业与考试</h2>
            <select class="input" id="c-status" style="width:auto;min-height:34px;font-size:11px">
              <option value="all" ${statusFilter === 'all' ? 'selected' : ''}>全部状态</option>
              <option value="open" ${statusFilter === 'open' ? 'selected' : ''}>未完成</option>
              <option value="overdue" ${statusFilter === 'overdue' ? 'selected' : ''}>已逾期</option>
              <option value="ended" ${statusFilter === 'ended' ? 'selected' : ''}>已结束</option>
            </select>
          </div>
          <div class="panel-body flush" id="c-tasks">
            ${ts.length ? ts.map(t => taskRow(t)).join('') : empty('book', '这里还没有作业', '收到通知后，手动添加或用 AI 快速录入。', `<button class="btn soft" id="c-add-task2">${icon('plus', 15)} 新增任务</button>`)}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>课件与资料</h2><span class="ph-sub">含下属任务附件（标明来源）</span>
            <button class="btn sm soft" id="c-add-link">${icon('link', 14)} 保存链接</button></div>
          <div class="panel-body">
            <div id="c-upload" class="mb"></div>
            <div id="c-res">${resourceListHtml(res, { showSource: true })}</div>
          </div>
        </div>
      </div>

      <div class="detail-side">
        <div class="panel">
          <div class="panel-header"><h3>课程信息</h3></div>
          <div class="panel-body">
            <div class="info-list">
              <div class="info-item"><span class="ii-label">授课教师</span><span class="ii-val">${c.teacher ? esc(c.teacher) : '未填写'}</span></div>
              <div class="info-item"><span class="ii-label">所属学期</span><span class="ii-val">${c.term ? esc(c.term) : '未填写'}</span></div>
              <div class="info-item"><span class="ii-label">第一周起始</span><span class="ii-val">${c.termStart || '未填写'}</span></div>
              <div class="info-item"><span class="ii-label">上课安排</span><span class="ii-val">${scheduleText(c)}</span></div>
            </div>
            ${c.note ? `<div class="note-box mt">${esc(c.note)}</div>` : ''}
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><h3>整理</h3></div>
          <div class="panel-body col gap-sm">
            <button class="btn block" id="c-plan">${icon('calendar', 15)} 查看相关计划</button>
            <button class="btn block" id="c-archive">${icon('archive', 15)} ${c.archived ? '恢复归档' : '归档课程'}</button>
            <button class="btn block danger" id="c-delete">${icon('trash', 15)} 删除课程…</button>
            <div class="field-hint">归档不删除资料、不释放容量；删除为永久操作，会列出影响清单。</div>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#c-edit').addEventListener('click', () => {
    if (c.archived) toast('课程已归档，可直接编辑；建议完成后恢复归档', 'err');
    openCourseForm(c);
  });
  const addTask = () => openTaskForm({ ownerType: 'course', ownerId: c.id });
  root.querySelector('#c-add-task').addEventListener('click', addTask);
  root.querySelector('#c-add-task2')?.addEventListener('click', addTask);
  root.querySelector('#c-status').addEventListener('change', e => { statusFilter = e.target.value; renderCourse(root, id); });
  root.querySelector('#c-add-link').addEventListener('click', () => openLinkForm({ ownerType: 'course', ownerId: c.id }));
  root.querySelector('#c-plan').addEventListener('click', () => {
    setPlanAnchor(now().date, 'week', { cat: 'study', owner: { type: 'course', id: c.id } });
    location.hash = '#/plan';
  });
  root.querySelector('#c-archive').addEventListener('click', () => confirmArchive('course', c));
  root.querySelector('#c-delete').addEventListener('click', () => confirmDeleteOwner('course', c));
  root.querySelector('#c-more').addEventListener('click', () => openCourseMore(c));
  bindTaskRows(root.querySelector('#c-tasks'), { onMenu: openTaskMenu, onCheck: quickComplete });
  mountUpload(root.querySelector('#c-upload'), { ownerType: 'course', ownerId: c.id, category: 'courseware' });
  bindResourceList(root.querySelector('#c-res'), { ownerType: 'course', ownerId: c.id });
}

function openCourseMore(c) {
  import('../ui.js').then(({ openDialog }) => {
    const d = openDialog({
      title: c.name, eyebrow: 'COURSE ACTIONS',
      body: `<div class="col gap-sm">
        <button class="btn block" data-a="edit">${icon('edit')} 编辑课程信息</button>
        <button class="btn block" data-a="task">${icon('plus')} 新增作业 / 考试</button>
        <button class="btn block" data-a="archive">${icon('archive')} ${c.archived ? '恢复归档' : '归档课程'}</button>
        <button class="btn block danger" data-a="del">${icon('trash')} 删除课程…</button>
      </div>`,
    });
    d.body.addEventListener('click', e => {
      const b = e.target.closest('[data-a]'); if (!b) return; d.close();
      if (b.dataset.a === 'edit') openCourseForm(c);
      if (b.dataset.a === 'task') openTaskForm({ ownerType: 'course', ownerId: c.id });
      if (b.dataset.a === 'archive') confirmArchive('course', c);
      if (b.dataset.a === 'del') confirmDeleteOwner('course', c);
    });
  });
}