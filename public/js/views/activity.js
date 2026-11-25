import { icon } from '../icons.js';
import { esc, fmtDateTime, CAT_LABEL, PHASE_LABEL, ACT_TYPE_LABEL, isEnded } from '../util.js';
import { S, activity, tasksOf, resourcesAggregated, unfinishedTasks, activityCategory, now } from '../state.js';
import { openTemplateDialog, progressOf, templateFor } from '../templates.js';
import { setPlanAnchor } from './plan.js';
import { taskRow, bindTaskRows, empty, toast } from '../ui.js';
import { openActivityForm, openTaskForm, openTaskMenu, quickComplete, confirmArchive, confirmDeleteOwner, openLinkForm } from '../forms.js';
import { mountUpload, resourceListHtml, bindResourceList } from '../upload.js';

const ACT_BAND = { lecture: 'green', contest: 'peach', club: 'blue', other: 'lilac' };
const ACT_ICON = { lecture: 'mic', contest: 'award', club: 'users', other: 'flag' };
const ACT_CATS = ['poster', 'signup', 'checkin', 'checkout', 'work', 'cert', 'other'];
let catFilter = '';
let uploadCat = 'poster';

export async function renderActivity(root, id) {
  const a = activity(id);
  if (!a) { root.innerHTML = empty('flag', '活动不存在或已被删除', '回到首页看看其他活动。', '<button class="btn primary" data-nav="#/">回到首页</button>'); return; }
  const nodes = tasksOf('activity', a.id).sort((x, y) => (x.due?.date || '9999').localeCompare(y.due?.date || '9999'));
  const un = unfinishedTasks('activity', a.id).length;
  const prog = progressOf(a);
  const isContest = a.type === 'contest';
  let res = resourcesAggregated('activity', a.id);
  if (catFilter) res = res.filter(x => x.r.category === catFilter);

  root.innerHTML = `
    <button class="text-btn mb" data-nav="#/">← 返回首页</button>
    <div class="detail-head">
      <div class="cat-icon ${ACT_BAND[a.type]}">${icon(ACT_ICON[a.type], 26)}</div>
      <div class="dh-text">
        <div class="eyebrow">ACTIVITY · ${ACT_TYPE_LABEL[a.type]}</div>
        <h1>${esc(a.name)}</h1>
        <div class="detail-meta">
          <span class="pill ${{ preparing: 'gray', ongoing: 'green', ended: 'blue', cancelled: 'red' }[a.phase]}">${PHASE_LABEL[a.phase]}</span>
          <span class="pill ${prog.total && prog.done === prog.total ? 'green' : 'gray'}">${prog.text}</span>
          <span class="pill gray">${un} 个未完成节点</span>
          ${a.archived ? '<span class="pill peach">已归档</span>' : ''}
        </div>
      </div>
      <div class="ph-actions">
        <button class="btn" id="a-edit">${icon('edit', 15)} 编辑</button>
        <button class="btn" id="a-tpl">${icon('list', 15)} 从模板添加</button>
        <button class="btn primary" id="a-add-node">${icon('plus', 15)} 加节点</button>
      </div>
    </div>
    ${a.phase === 'cancelled' ? '<div class="info-block">该活动已取消。未完成节点已被取消并停止提醒，资料仍保留。</div>' : ''}
    ${a.archived ? '<div class="info-block">该活动已归档，仍可搜索、访问与下载资料。</div>' : ''}
    <div class="detail-grid">
      <div class="detail-main">
        <div class="panel">
          <div class="panel-header"><h2>${isContest ? '阶段任务' : '节点任务'}</h2><span class="ph-sub">${isContest ? '每个阶段是一个普通节点任务，各自独立提醒' : '报名 / 签到 / 签退 / 提交，各自独立提醒'}</span></div>
          <div class="panel-body flush" id="a-nodes">
            ${nodes.length ? nodes.map(t => taskRow(t)).join('') : empty('flag', isContest ? '还没有阶段' : '还没有节点', '把报名、签到、材料提交拆成节点，时间各自独立。', `<button class="btn soft" id="a-add-node2">${icon('plus', 15)} 新增节点</button> <button class="btn soft" id="a-tpl2">${icon('list', 15)} 从${templateFor(a).label}添加</button>`)}
          </div>
        </div>

        <div class="panel">
          <div class="panel-header"><h2>材料与凭证</h2>
            <select class="input" id="a-upload-cat" style="width:auto;min-height:34px;font-size:11px">
              ${ACT_CATS.map(k => `<option value="${k}" ${uploadCat === k ? 'selected' : ''}>上传为：${CAT_LABEL[k]}</option>`).join('')}
            </select>
            <button class="btn sm soft" id="a-add-link">${icon('link', 14)} 链接</button>
          </div>
          <div class="panel-body">
            <div class="filter-bar" id="a-cats">
              <button class="btn sm ${!catFilter ? 'soft' : ''}" data-cat="">全部</button>
              ${ACT_CATS.map(k => `<button class="btn sm ${catFilter === k ? 'soft' : ''}" data-cat="${k}">${CAT_LABEL[k]}</button>`).join('')}
            </div>
            <div id="a-upload" class="mb"></div>
            <div id="a-res">${resourceListHtml(res, { showSource: true })}</div>
          </div>
        </div>
      </div>

      <div class="detail-side">
        <div class="panel">
          <div class="panel-header"><h3>活动信息</h3></div>
          <div class="panel-body">
            <div class="info-list">
              <div class="info-item"><span class="ii-label">开始时间</span><span class="ii-val">${a.start ? fmtDateTime(a.start) : '时间待定'}</span></div>
              <div class="info-item"><span class="ii-label">结束时间</span><span class="ii-val">${a.end ? fmtDateTime(a.end) : '时间待定'}</span></div>
              <div class="info-item"><span class="ii-label">地点</span><span class="ii-val">${a.location ? esc(a.location) : '未填写'}</span></div>
              ${a.online ? `<div class="info-item"><span class="ii-label">线上地址</span><span class="ii-val"><a href="${esc(a.online)}" target="_blank" rel="noopener noreferrer">${esc(a.online)}</a></span></div>` : ''}
              <div class="info-item"><span class="ii-label">主办方</span><span class="ii-val">${a.host ? esc(a.host) : '未填写'}</span></div>
            </div>
            ${a.note ? `<div class="note-box mt">${esc(a.note)}</div>` : ''}
            <div class="field-hint mt">修改活动时间不会自动改动节点截止时间，请自行检查关联节点。</div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><h3>整理</h3></div>
          <div class="panel-body col gap-sm">
            <button class="btn block" id="a-plan">${icon('calendar', 15)} 查看相关计划</button>
            <button class="btn block" id="a-archive">${icon('archive', 15)} ${a.archived ? '恢复归档' : '归档活动'}</button>
            <button class="btn block danger" id="a-delete">${icon('trash', 15)} 删除活动…</button>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#a-edit').addEventListener('click', () => openActivityForm(a));
  root.querySelector('#a-tpl').addEventListener('click', () => openTemplateDialog(a));
  root.querySelector('#a-tpl2')?.addEventListener('click', () => openTemplateDialog(a));
  root.querySelector('#a-plan').addEventListener('click', () => {
    setPlanAnchor(now().date, 'week', { cat: activityCategory(a), owner: { type: 'activity', id: a.id } });
    location.hash = '#/plan';
  });
  const addNode = () => openTaskForm({ ownerType: 'activity', ownerId: a.id, preset: { type: 'node', needsSubmit: false } });
  root.querySelector('#a-add-node').addEventListener('click', addNode);
  root.querySelector('#a-add-node2')?.addEventListener('click', addNode);
  root.querySelector('#a-add-link').addEventListener('click', () => openLinkForm({ ownerType: 'activity', ownerId: a.id }));
  root.querySelector('#a-archive').addEventListener('click', () => confirmArchive('activity', a));
  root.querySelector('#a-delete').addEventListener('click', () => confirmDeleteOwner('activity', a));
  root.querySelector('#a-upload-cat').addEventListener('change', e => { uploadCat = e.target.value; mountUpload(root.querySelector('#a-upload'), { ownerType: 'activity', ownerId: a.id, category: uploadCat }); });
  root.querySelector('#a-cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    catFilter = b.dataset.cat; renderActivity(root, id);
  });
  bindTaskRows(root.querySelector('#a-nodes'), { onMenu: openTaskMenu, onCheck: quickComplete });
  mountUpload(root.querySelector('#a-upload'), { ownerType: 'activity', ownerId: a.id, category: uploadCat });
  bindResourceList(root.querySelector('#a-res'), { ownerType: 'activity', ownerId: a.id });
}