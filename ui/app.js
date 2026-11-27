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
};

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

function goalTitle(id) {
  const g = state.goals.find((x) => x.id === id);
  return g ? g.title : '';
}

function renderGoals() {
  const ul = $('goals');
  const visible = state.goals.filter((g) => state.filter === 'all' || g.status === state.filter);
  ul.innerHTML = visible.map((g) => {
    const left = deadlineLeft(g.deadline);
    const progress = Math.max(0, Math.min(100, g.progress || 0));
    return `<li class="goal" data-id="${esc(g.id)}">
      <div class="goal-top">
        <span class="title">${esc(g.title)}</span>
        <span class="prio" title="приоритет">${g.priority || 0}</span>
      </div>
      <div class="bar"><span style="width:${progress}%"></span></div>
      <div class="goal-bottom">
        <span class="pct">${progress}%</span>
        ${left ? `<span class="left">${esc(left)}</span>` : ''}
        <span class="grow"></span>
        <button type="button" class="text" data-act="plus" title="+10%">+10%</button>
        <button type="button" class="text" data-act="minus" title="−10%">−10%</button>
        <button type="button" class="text" data-act="pause">${g.status === 'paused' ? 'вернуть' : 'на паузу'}</button>
        <button type="button" class="text" data-act="done">${g.status === 'done' ? 'вернуть' : 'закрыть'}</button>
      </div>
    </li>`;
  }).join('');
  $('goals-empty').hidden = visible.length > 0;

  const stale = state.goals.filter((g) => g.status === 'active' && g.updated_at && (Date.now() / 1000 - g.updated_at) > 90 * 86400);
  const box = $('stale');
  box.hidden = stale.length === 0;
  box.textContent = stale.length ? `Не двигались три месяца: ${stale.length}. Закрыть или запланировать?` : '';
}

function renderDeeds() {
  const ul = $('deeds');
  const visible = state.deeds.filter((d) => state.showDone || !d.done);
  ul.innerHTML = visible.map((d) => {
    const left = deadlineLeft(d.due);
    const goal = goalTitle(d.goal);
    return `<li class="deed${d.done ? ' done' : ''}" data-id="${esc(d.id)}">
      <input type="checkbox" ${d.done ? 'checked' : ''} data-act="done" title="сделано" />
      <span class="text">${esc(d.text)}</span>
      ${goal ? `<span class="goal-tag">${esc(goal)}</span>` : ''}
      ${left ? `<span class="left">${esc(left)}</span>` : ''}
      <span class="grow"></span>
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
  $('badges').textContent = `${active} целей · ${open} дел`;
}

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
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const li = btn.closest('li[data-id]');
  const goal = state.goals.find((g) => g.id === li.dataset.id);
  if (!goal) return;
  const act = btn.dataset.act;
  const body = { id: goal.id };
  if (act === 'plus') body.progress = Math.min(100, (goal.progress || 0) + 10);
  if (act === 'minus') body.progress = Math.max(0, (goal.progress || 0) - 10);
  if (act === 'pause') body.status = goal.status === 'paused' ? 'active' : 'paused';
  if (act === 'done') body.status = goal.status === 'done' ? 'active' : 'done';
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

$('new-goal').addEventListener('click', () => {
  $('goal-form').hidden = false;
  $('goal-title').focus();
});

$('goal-cancel').addEventListener('click', () => {
  $('goal-form').hidden = true;
  $('goal-form').reset();
});

$('goal-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const title = $('goal-title').value.trim();
  if (!title) return;
  try {
    await api('api/goals', {
      title,
      deadline: $('goal-deadline').value,
      priority: Number($('goal-priority').value) || 0,
      description: $('goal-description').value.trim(),
    });
    $('goal-form').reset();
    $('goal-form').hidden = true;
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
  try {
    if (target.matches('input[data-act="done"]')) {
      await api('api/deeds/update', { id, done: target.checked });
    } else if (target.matches('button[data-act="delete"]')) {
      await api('api/deeds/delete', { id });
    } else {
      return;
    }
    await load();
  } catch (e) {
    showError(e);
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
  } catch (e) {
    showError(e);
  }
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

load();
loadStatus();
