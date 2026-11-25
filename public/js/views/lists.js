import { icon } from '../icons.js';
import { esc } from '../util.js';
import { S } from '../state.js';
import { openCourseForm, openActivityForm } from '../forms.js';
import { courseCards, activityCards, areaFilters, setAreaFilters } from './home.js';

function bindCards(root, kind) {
  const attr = kind === 'course' ? 'data-course' : 'data-activity';
  root.querySelectorAll(`[${attr}]`).forEach(el => el.addEventListener('click', () => {
    location.hash = `#/${kind}/` + el.getAttribute(attr);
  }));
}

export async function renderCourses(root) {
  const terms = [...new Set(S.courses.map(c => c.term).filter(Boolean))];
  const f = areaFilters();
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow">COURSE OVERVIEW</div>
        <h1>我的作业</h1>
        <div class="ph-meta">按课程管理作业、课件与截止</div>
      </div>
      <div class="ph-actions">
        <button class="btn primary" id="list-add-course">${icon('plus', 16)} 新增课程</button>
      </div>
    </div>
    <section class="home-section">
      <div class="section-title">
        <h2>课程总览</h2><span class="st-sub">与首页同一份课程数据</span><span class="spacer"></span>
        <select class="input" id="term-filter" style="width:auto;min-height:34px;font-size:11px">
          <option value="">全部学期</option>${terms.map(t => `<option value="${esc(t)}" ${f.term === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <label class="row tiny muted" style="gap:6px;cursor:pointer"><input type="checkbox" id="arch-toggle" ${f.archived ? 'checked' : ''}> 含归档</label>
      </div>
      <div id="course-area">${courseCards()}</div>
    </section>`;

  const rerender = () => {
    root.querySelector('#course-area').innerHTML = courseCards();
    bindCards(root, 'course');
    root.querySelector('#home-add-course')?.addEventListener('click', () => openCourseForm());
  };
  root.querySelector('#term-filter').addEventListener('change', e => { setAreaFilters({ term: e.target.value }); rerender(); });
  root.querySelector('#arch-toggle').addEventListener('change', e => { setAreaFilters({ archived: e.target.checked }); rerender(); });
  root.querySelector('#list-add-course').addEventListener('click', () => openCourseForm());
  rerender();
}

export async function renderActivities(root) {
  const f = areaFilters();
  root.innerHTML = `
    <div class="page-head">
      <div class="ph-text">
        <div class="eyebrow">ACTIVITY OVERVIEW</div>
        <h1>我的活动</h1>
        <div class="ph-meta">讲座、比赛、社团——节点、凭证与成果按活动归档</div>
      </div>
      <div class="ph-actions">
        <button class="btn primary" id="list-add-act">${icon('plus', 16)} 新增活动</button>
      </div>
    </div>
    <section class="home-section">
      <div class="section-title">
        <h2>活动总览</h2><span class="st-sub">与首页同一份活动数据 · 比赛各占一张卡片</span><span class="spacer"></span>
        <label class="row tiny muted" style="gap:6px;cursor:pointer"><input type="checkbox" id="arch-toggle" ${f.archived ? 'checked' : ''}> 含归档</label>
      </div>
      <div id="act-area">${activityCards()}</div>
    </section>`;

  const rerender = () => {
    root.querySelector('#act-area').innerHTML = activityCards();
    bindCards(root, 'activity');
    root.querySelector('#home-add-act')?.addEventListener('click', () => openActivityForm());
  };
  root.querySelector('#arch-toggle').addEventListener('change', e => { setAreaFilters({ archived: e.target.checked }); rerender(); });
  root.querySelector('#list-add-act').addEventListener('click', () => openActivityForm());
  rerender();
}