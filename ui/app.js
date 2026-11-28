// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// app.js — the screen: goals from the installation's memory, deeds from this module.
const $ = (id) => document.getElementById(id);

const state = {
  goals: [],
  deeds: [],
  filter: 'active',
  showDone: false,
  goalQuery: '',
  deedQuery: '',
  editingDeed: '',
};

// matches answers whether the text contains the query, case-insensitive; an empty query matches all.
function matches(query, ...fields) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f || '').toLowerCase().includes(q));
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function showError(e) {
  const box = $('error');
  if (!e) { box.hidden = true; box.textContent = ''; return; }
  box.hidden = false;
  box.textContent = e.message || String(e);
}

// deadlineLeft answers how the due date reads: "осталось 3 дня", "просрочено на 2 дня", "".
function deadlineLeft(iso) {
  if (!iso) return '';
  const due = new Date(iso.slice(0, 10) + 'T23:59:59');
  if (isNaN(due)) return '';
  const days = Math.ceil((due - Date.now()) / 86400000);
  if (days < 0) return `просрочено на ${-days} дн.`;
  if (days === 0) return 'сегодня';
  if (days <= 3) return `осталось ${days} дн.`;
  return '';
}

// ago answers how long ago a moment was: "сегодня", "3 дн. назад", "2 мес. назад".
function ago(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() / 1000 - ts) / 86400);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} дн. назад`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} мес. назад` : `${Math.floor(months / 12)} г. назад`;
}

function goalTitle(id) {
  const g = state.goals.find((x) => x.id === id);
  return g ? g.title : '';
}

function isStale(g) {
  return g.status === 'active' && g.updated_at && (Date.now() / 1000 - g.updated_at) > 90 * 86400;
}

function renderGoals() {
  const ul = $('goals');
  const visible = state.goals.filter((g) => {
    if (!matches(state.goalQuery, g.title, g.description, (g.labels || []).join(' '))) return false;
    if (state.filter === 'all') return true;
    if (state.filter === 'stale') return isStale(g);
    return g.status === state.filter;
  });
  ul.innerHTML = visible.map((g) => {
    const left = deadlineLeft(g.deadline);
    const progress = Math.max(0, Math.min(100, g.progress || 0));
    const labels = (g.labels || []).map((l) => `<button type="button" class="label" data-label="${esc(l)}">${esc(l)}</button>`).join('');
    const moved = ago(g.updated_at);
    return `<li class="goal" data-id="${esc(g.id)}">
      <div class="goal-top">
        <span class="title">${esc(g.title)}</span>
        <span class="prio" title="приоритет">${g.priority || 0}</span>
      </div>
      ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ''}
      ${labels ? `<div class="labels">${labels}</div>` : ''}
      <div class="bar"><span style="width:${progress}%"></span></div>
      <div class="goal-bottom">
        <input class="progress" type="number" min="0" max="100" step="5" value="${progress}"
               data-act="progress" title="прогресс, %" /> %
        ${moved ? `<span class="moved">двигалась ${esc(moved)}</span>` : ''}
        ${left ? `<span class="left">${esc(left)}</span>` : ''}
        <span class="grow"></span>
        <button type="button" class="text" data-act="edit" title="изменить">✎</button>
        <button type="button" class="text" data-act="plus" title="+10%">+10%</button>
        <button type="button" class="text" data-act="minus" title="−10%">−10%</button>
        <button type="button" class="text" data-act="pause">${g.status === 'archived' ? 'вернуть' : 'в архив'}</button>
        <button type="button" class="text" data-act="done">${g.status === 'completed' ? 'вернуть' : 'закрыть'}</button>
      </div>
    </li>`;
  }).join('');
  $('goals-empty').hidden = visible.length > 0;

  const stale = state.goals.filter(isStale);
  const box = $('stale');
  box.hidden = stale.length === 0 || state.filter === 'stale';
  $('show-stale').textContent = stale.length ? `Не двигались три месяца: ${stale.length}. Показать` : '';
}

function renderDeeds() {
  const ul = $('deeds');
  const visible = state.deeds.filter((d) => {
    if (!state.showDone && d.done) return false;
    return matches(state.deedQuery, d.text, goalTitle(d.goal));
  });
  ul.innerHTML = visible.map((d) => {
    const left = deadlineLeft(d.due);
    const goal = goalTitle(d.goal);
    if (state.editingDeed === d.id) {
      const options = ['<option value="">без цели</option>'].concat(
        state.goals.filter((g) => g.status === 'active' || g.id === d.goal)
          .map((g) => `<option value="${esc(g.id)}" ${g.id === d.goal ? 'selected' : ''}>${esc(g.title)}</option>`)).join('');
      return `<li class="deed editing" data-id="${esc(d.id)}">
        <input class="edit-text" value="${esc(d.text)}" maxlength="240" />
        <input class="edit-due" type="date" value="${esc(d.due || '')}" />
        <select class="edit-goal">${options}</select>
        <button type="button" class="text" data-act="save" title="сохранить (Enter)">✓</button>
        <button type="button" class="text" data-act="cancel" title="отменить (Esc)">×</button>
      </li>`;
    }
    return `<li class="deed${d.done ? ' done' : ''}" data-id="${esc(d.id)}">
      <input type="checkbox" ${d.done ? 'checked' : ''} data-act="done" title="сделано" />
      <span class="deed-text" data-act="edit" title="изменить">${esc(d.text)}</span>
      ${goal ? `<span class="goal-tag">${esc(goal)}</span>` : ''}
      ${left ? `<span class="left">${esc(left)}</span>` : ''}
      <span class="grow"></span>
      <button type="button" class="text" data-act="edit" title="изменить">✎</button>
      <button type="button" class="text" data-act="delete" title="удалить">×</button>
    </li>`;
  }).join('');
  $('deeds-empty').hidden = visible.length > 0;
}

function renderGoalPicker() {
  const select = $('deed-goal');
  select.innerHTML = '<option value="">без цели</option>' +
    state.goals.filter((g) => g.status === 'active').map((g) => `<option value="${esc(g.id)}">${esc(g.title)}</option>`).join('');
}

function renderBadges() {
  const open = state.deeds.filter((d) => !d.done).length;
  const active = state.goals.filter((g) => g.status === 'active').length;
  $('count-goals').textContent = active;
  $('count-deeds').textContent = open;
}

// The tab is remembered: the next visit opens where the person left off.
const TAB_KEY = 'anytext.goals.tab';

function showTab(name) {
  if (name !== 'goals' && name !== 'deeds') name = 'goals';
  for (const btn of document.querySelectorAll('#tabs button[data-tab]')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  $('tab-goals').hidden = name !== 'goals';
  $('tab-deeds').hidden = name !== 'deeds';
  try { localStorage.setItem(TAB_KEY, name); } catch (e) { /* private mode */ }
}

$('tabs').addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tab]');
  if (btn) showTab(btn.dataset.tab);
});

async function load() {
  showError(null);
  try {
    const [goals, deeds] = await Promise.all([api('api/goals'), api('api/deeds')]);
    state.goals = goals.goals || [];
    state.deeds = deeds.deeds || [];
    renderGoals();
    renderDeeds();
    renderGoalPicker();
    renderBadges();
  } catch (e) {
    showError(e);
  }
}

async function loadStatus() {
  try {
    const s = await api('api/status');
    $('status').textContent = `цели ${s.version} · шлюз ${s.gateway}`;
  } catch (e) {
    $('status').textContent = 'нет связи с модулем';
  }
}

// The goals: the screen moves them, the memory keeps them.
$('goals').addEventListener('click', async (ev) => {
  const chip = ev.target.closest('button[data-label]');
  if (chip) {
    // A label is a filter: one click and the list is what that label means.
    $('goal-search').value = chip.dataset.label;
    state.goalQuery = chip.dataset.label;
    renderGoals();
    return;
  }
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const li = btn.closest('li[data-id]');
  const goal = state.goals.find((g) => g.id === li.dataset.id);
  if (!goal) return;
  const act = btn.dataset.act;
  if (act === 'edit') {
    openGoalForm(goal);
    return;
  }
  const body = { id: goal.id };
  if (act === 'plus') body.progress = Math.min(100, (goal.progress || 0) + 10);
  if (act === 'minus') body.progress = Math.max(0, (goal.progress || 0) - 10);
  if (act === 'pause') body.status = goal.status === 'archived' ? 'active' : 'archived';
  if (act === 'done') body.status = goal.status === 'completed' ? 'active' : 'completed';
  btn.disabled = true;
  try {
    await api('api/goals/update', body);
    await load();
  } catch (e) {
    showError(e);
  } finally {
    btn.disabled = false;
  }
});

let editingGoal = null;

function openGoalForm(goal) {
  editingGoal = goal || null;
  $('goal-title').value = goal ? goal.title : '';
  $('goal-description').value = goal ? goal.description || '' : '';
  $('goal-deadline').value = goal && goal.deadline ? String(goal.deadline).slice(0, 10) : '';
  $('goal-priority').value = goal && goal.priority ? goal.priority : '';
  $('goal-labels').value = goal ? (goal.labels || []).join(', ') : '';
  $('goal-save').textContent = goal ? 'Сохранить' : 'Добавить цель';
  $('goal-form').hidden = false;
  $('goal-title').focus();
}

function closeGoalForm() {
  editingGoal = null;
  $('goal-form').hidden = true;
  $('goal-form').reset();
}

$('goals').addEventListener('change', async (ev) => {
  const input = ev.target.closest('input[data-act="progress"]');
  if (!input) return;
  const li = input.closest('li[data-id]');
  let value = Number(input.value);
  if (!Number.isFinite(value)) value = 0;
  value = Math.max(0, Math.min(100, Math.round(value)));
  input.value = value;
  try {
    await api('api/goals/update', { id: li.dataset.id, progress: value });
    await load();
  } catch (e) {
    showError(e);
  }
});

$('new-goal').addEventListener('click', () => openGoalForm(null));

$('goal-cancel').addEventListener('click', closeGoalForm);

$('goal-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const title = $('goal-title').value.trim();
  if (!title) return;
  const deadline = $('goal-deadline').value;
  const priority = Number($('goal-priority').value) || 0;
  const description = $('goal-description').value.trim();
  const labels = $('goal-labels').value.trim();
  try {
    if (editingGoal) {
      // The memory keeps the labels as a list; an empty field clears them, which is what a person
      // means by deleting the text there (28.11.2026).
      await api('api/goals/update', { id: editingGoal.id, title, description, deadline, priority, labels: labels || '[]' });
    } else {
      await api('api/goals', { title, deadline, priority, description, labels });
    }
    closeGoalForm();
    await load();
  } catch (e) {
    showError(e);
  }
});

// The deeds: the module keeps them.
$('deeds').addEventListener('click', async (ev) => {
  const target = ev.target;
  const li = target.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;
  const act = target.dataset ? target.dataset.act : '';
  try {
    if (target.matches('input[data-act="done"]')) {
      await api('api/deeds/update', { id, done: target.checked });
    } else if (act === 'delete') {
      await api('api/deeds/delete', { id });
    } else if (act === 'edit') {
      state.editingDeed = id;
      renderDeeds();
      const field = li.querySelector('.edit-text');
      if (field) field.focus();
      return;
    } else if (act === 'cancel') {
      state.editingDeed = '';
      renderDeeds();
      return;
    } else if (act === 'save') {
      await saveDeed(li);
      return;
    } else {
      return;
    }
    await load();
  } catch (e) {
    showError(e);
  }
});

// saveDeed sends what the editing row says: the text, the date and the goal.
async function saveDeed(li) {
  const id = li.dataset.id;
  const text = li.querySelector('.edit-text').value.trim();
  if (!text) return;
  const due = li.querySelector('.edit-due').value;
  const goal = li.querySelector('.edit-goal').value;
  try {
    await api('api/deeds/update', { id, text, due, goal });
    state.editingDeed = '';
    await load();
  } catch (e) {
    showError(e);
  }
}

// Enter saves the row, Esc throws the change away.
$('deeds').addEventListener('keydown', (ev) => {
  const li = ev.target.closest('li.editing');
  if (!li) return;
  if (ev.key === 'Enter') {
    ev.preventDefault();
    saveDeed(li);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    state.editingDeed = '';
    renderDeeds();
  }
});

$('deed-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const text = $('deed-text').value.trim();
  if (!text) return;
  try {
    await api('api/deeds', { text, due: $('deed-due').value, goal: $('deed-goal').value });
    $('deed-text').value = '';
    await load();
    showTab('deeds');
  } catch (e) {
    showError(e);
  }
});

$('goal-search').addEventListener('input', (ev) => {
  state.goalQuery = ev.target.value;
  renderGoals();
});

$('deed-search').addEventListener('input', (ev) => {
  state.deedQuery = ev.target.value;
  renderDeeds();
});

$('show-stale').addEventListener('click', () => {
  state.filter = 'stale';
  $('goal-filter').value = 'stale';
  renderGoals();
});

$('goal-filter').addEventListener('change', (ev) => {
  state.filter = ev.target.value;
  renderGoals();
});

$('show-done').addEventListener('change', (ev) => {
  state.showDone = ev.target.checked;
  renderDeeds();
});

$('refresh').addEventListener('click', () => load());

let startTab = 'goals';
try { startTab = localStorage.getItem(TAB_KEY) || 'goals'; } catch (e) { /* private mode */ }
showTab(startTab);

load();
loadStatus();
