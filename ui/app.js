// Copyright 2026 Kirill Scherba. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.

// app.js — the screen: goals from the installation's memory, deeds from this module.
const $ = (id) => document.getElementById(id);

// --- language -----------------------------------------------------------------------------------
// The installation keeps its language in anytext.lang; a module that speaks only Russian is a module
// half its people cannot use.
const LANGS = ['ru', 'en'];

function storedLang() {
  try {
    const value = localStorage.getItem('anytext.lang');
    if (LANGS.includes(value)) return value;
  } catch (e) { /* private mode: the system language is enough */ }
  const system = (navigator.language || '').toLowerCase();
  return system.startsWith('ru') ? 'ru' : 'en';
}

let lang = storedLang();

const STRINGS = {
  ru: {
    title: 'Цели', goalsTab: 'Цели', deedsTab: 'Дела', refresh: 'Перечитать',
    searchGoals: 'поиск по целям', searchDeeds: 'поиск по делам',
    filterActive: 'активные', filterCompleted: 'закрытые', filterArchived: 'в архиве',
    filterStale: 'не двигались', filterAll: 'все',
    newGoal: '+ Цель', addGoal: 'Добавить цель', save: 'Сохранить', add: 'Добавить', cancel: 'Отмена',
    goalTitlePh: 'чего хотите достичь', priorityPh: 'приоритет', labelsPh: 'метки через запятую',
    descPh: 'описание (необязательно)', deedPh: 'что сделать', withoutGoal: 'без цели',
    showDone: 'показывать закрытые', noGoals: 'Целей нет.', noDeeds: 'Дел нет.',
    stale: 'Не двигались три месяца: {n}. Показать',
    moved: 'двигалась {ago}', today: 'сегодня', yesterday: 'вчера',
    daysAgo: '{n} дн. назад', monthsAgo: '{n} мес. назад', yearsAgo: '{n} г. назад',
    overdue: 'просрочено на {n} дн.', dueToday: 'срок сегодня', leftDays: 'осталось {n} дн.',
    edit: 'изменить', editTitle: 'изменить', plus10: '+10%', minus10: '−10%',
    toArchive: 'в архив', back: 'вернуть', close: 'закрыть', done: 'сделано', remove: 'удалить',
    progress: 'прогресс, %', due: 'срок', saveHint: 'сохранить (Enter)', cancelHint: 'отменить (Esc)',
    noLink: 'нет связи с модулем', gateway: 'шлюз {gateway}', version: 'цели {version}',
    goalMissing: 'нет такой цели',
  },
  en: {
    title: 'Goals', goalsTab: 'Goals', deedsTab: 'Deeds', refresh: 'Reload',
    searchGoals: 'search goals', searchDeeds: 'search deeds',
    filterActive: 'active', filterCompleted: 'completed', filterArchived: 'archived',
    filterStale: 'not moving', filterAll: 'all',
    newGoal: '+ Goal', addGoal: 'Add a goal', save: 'Save', add: 'Add', cancel: 'Cancel',
    goalTitlePh: 'what you want to achieve', priorityPh: 'priority', labelsPh: 'labels, comma separated',
    descPh: 'description (optional)', deedPh: 'what to do', withoutGoal: 'no goal',
    showDone: 'show completed', noGoals: 'No goals.', noDeeds: 'No deeds.',
    stale: 'Not moving for three months: {n}. Show',
    moved: 'moved {ago}', today: 'today', yesterday: 'yesterday',
    daysAgo: '{n} days ago', monthsAgo: '{n} months ago', yearsAgo: '{n} years ago',
    overdue: '{n} days overdue', dueToday: 'due today', leftDays: '{n} days left',
    edit: 'edit', editTitle: 'edit', plus10: '+10%', minus10: '−10%',
    toArchive: 'archive', back: 'restore', close: 'complete', done: 'done', remove: 'delete',
    progress: 'progress, %', due: 'due date', saveHint: 'save (Enter)', cancelHint: 'cancel (Esc)',
    noLink: 'the module is not answering', gateway: 'gateway {gateway}', version: 'goals {version}',
    goalMissing: 'no such goal',
  },
};

function t(key, values) {
  const table = STRINGS[lang] || STRINGS.ru;
  let text = table[key] !== undefined ? table[key] : key;
  if (values) {
    for (const k of Object.keys(values)) text = text.split('{' + k + '}').join(String(values[k]));
  }
  return text;
}

function applyTexts() {
  document.documentElement.lang = lang;
  document.title = t('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
}

const state = {
  goals: [],
  deeds: [],
  filter: 'active',
  showDone: false,
  goalQuery: '',
  deedQuery: '',
  editingDeed: '',
  editingGoal: '',
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
  if (days < 0) return t('overdue', { n: -days });
  if (days === 0) return t('dueToday');
  if (days <= 3) return t('leftDays', { n: days });
  return '';
}

// ago answers how long ago a moment was: "сегодня", "3 дн. назад", "2 мес. назад".
function ago(ts) {
  if (!ts) return '';
  const days = Math.floor((Date.now() / 1000 - ts) / 86400);
  if (days <= 0) return t('today');
  if (days === 1) return t('yesterday');
  if (days < 30) return t('daysAgo', { n: days });
  const months = Math.floor(days / 30);
  return months < 12 ? t('monthsAgo', { n: months }) : t('yearsAgo', { n: Math.floor(months / 12) });
}

function goalTitle(id) {
  const g = state.goals.find((x) => x.id === id);
  return g ? g.title : '';
}

// goalCard is one goal as a person reads it.
function goalCard(g) {
  const progress = Math.max(0, Math.min(100, g.progress || 0));
  const labels = (g.labels || []).map((l) => `<button type="button" class="label" data-label="${esc(l)}">${esc(l)}</button>`).join('');
  const moved = ago(g.updated_at);
  const left = deadlineLeft(g.deadline);
  return `<li class="goal" data-id="${esc(g.id)}">
      <div class="goal-top">
        <span class="title">${esc(g.title)}</span>
        <span class="prio" title="${esc(t('priorityPh'))}">${g.priority || 0}</span>
      </div>
      ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ''}
      ${labels ? `<div class="labels">${labels}</div>` : ''}
      <div class="bar"><span style="width:${progress}%"></span></div>
      <div class="goal-bottom">
        <input class="progress" type="number" min="0" max="100" step="5" value="${progress}"
               data-act="progress" title="${esc(t('progress'))}" /> %
        ${moved ? `<span class="moved">${esc(t('moved', { ago: moved }))}</span>` : ''}
        ${left ? `<span class="left">${esc(left)}</span>` : ''}
        <span class="grow"></span>
        <button type="button" class="text" data-act="edit" title="${esc(t('editTitle'))}">✎</button>
        <button type="button" class="text" data-act="plus" title="${esc(t('plus10'))}">${esc(t('plus10'))}</button>
        <button type="button" class="text" data-act="minus" title="${esc(t('minus10'))}">${esc(t('minus10'))}</button>
        <button type="button" class="text" data-act="pause">${esc(g.status === 'archived' ? t('back') : t('toArchive'))}</button>
        <button type="button" class="text" data-act="done">${esc(g.status === 'completed' ? t('back') : t('close'))}</button>
      </div>
    </li>`;
}

// goalEditor is the same goal, open for a change, in its own place in the list.
function goalEditor(g) {
  const labels = (g.labels || []).join(', ');
  const deadline = g.deadline ? String(g.deadline).slice(0, 10) : '';
  return `<li class="goal editing" data-id="${esc(g.id)}">
      <input class="goal-edit-title" value="${esc(g.title)}" maxlength="160"
             placeholder="${esc(t('goalTitlePh'))}" />
      <textarea class="goal-edit-desc" rows="2" placeholder="${esc(t('descPh'))}">${esc(g.description || '')}</textarea>
      <div class="row">
        <input class="goal-edit-labels" value="${esc(labels)}" maxlength="120" placeholder="${esc(t('labelsPh'))}" />
        <input class="goal-edit-deadline" type="date" value="${esc(deadline)}" title="${esc(t('due'))}" />
        <input class="goal-edit-priority" type="number" min="0" max="10" value="${g.priority || 0}" placeholder="${esc(t('priorityPh'))}" />
      </div>
      <div class="row">
        <button type="button" class="primary" data-act="save">${esc(t('save'))}</button>
        <button type="button" class="text" data-act="cancel" title="${esc(t('cancelHint'))}">${esc(t('cancel'))}</button>
      </div>
    </li>`;
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
  // A stable order: by status, then priority, then title. The memory answers in its own order (by
  // updated_at), and an edited goal jumped to the top of the list — that is what "opening the form
  // moved the list" was about (28.11.2026).
  const statusOrder = { active: 0, completed: 1, archived: 2 };
  visible.sort((a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) ||
    (b.priority || 0) - (a.priority || 0) ||
    String(a.title).localeCompare(String(b.title), lang));

  ul.innerHTML = visible.map((g) => (g.id === state.editingGoal ? goalEditor(g) : goalCard(g))).join('');
  $('goals-empty').hidden = visible.length > 0;

  const stale = state.goals.filter(isStale);
  const box = $('stale');
  box.hidden = stale.length === 0 || state.filter === 'stale';
  $('show-stale').textContent = stale.length ? t('stale', { n: stale.length }) : '';
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
      const options = [`<option value="">${esc(t('withoutGoal'))}</option>`].concat(
        state.goals.filter((g) => g.status === 'active' || g.id === d.goal)
          .map((g) => `<option value="${esc(g.id)}" ${g.id === d.goal ? 'selected' : ''}>${esc(g.title)}</option>`)).join('');
      return `<li class="deed editing" data-id="${esc(d.id)}">
        <input class="edit-text" value="${esc(d.text)}" maxlength="240" />
        <input class="edit-due" type="date" value="${esc(d.due || '')}" />
        <select class="edit-goal">${options}</select>
        <button type="button" class="text" data-act="save" title="${esc(t('saveHint'))}">✓</button>
        <button type="button" class="text" data-act="cancel" title="${esc(t('cancelHint'))}">×</button>
      </li>`;
    }
    return `<li class="deed${d.done ? ' done' : ''}" data-id="${esc(d.id)}">
      <input type="checkbox" ${d.done ? 'checked' : ''} data-act="done" title="сделано" />
      <span class="deed-text" data-act="edit" title="${esc(t('editTitle'))}">${esc(d.text)}</span>
      ${goal ? `<span class="goal-tag">${esc(goal)}</span>` : ''}
      ${left ? `<span class="left">${esc(left)}</span>` : ''}
      <span class="grow"></span>
      <button type="button" class="text" data-act="edit" title="${esc(t('editTitle'))}">✎</button>
      <button type="button" class="text" data-act="delete" title="${esc(t('remove'))}">×</button>
    </li>`;
  }).join('');
  $('deeds-empty').hidden = visible.length > 0;
}

function renderGoalPicker() {
  const select = $('deed-goal');
  select.innerHTML = `<option value="">${esc(t('withoutGoal'))}</option>` +
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
    $('status').textContent = `${t('version', { version: s.version })} · ${t('gateway', { gateway: s.gateway })}`;
  } catch (e) {
    $('status').textContent = t('noLink');
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
    state.editingGoal = goal.id;
    renderGoals();
    const field = document.querySelector('li.goal.editing .goal-edit-title');
    if (field) field.focus();
    return;
  }
  if (act === 'cancel') {
    state.editingGoal = '';
    renderGoals();
    return;
  }
  if (act === 'save') {
    await saveGoalFromCard(li);
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

function openGoalForm() {
  $('goal-form').hidden = false;
  $('goal-title').focus();
}

function closeGoalForm() {
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

$('new-goal').addEventListener('click', openGoalForm);

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
    await api('api/goals', { title, deadline, priority, description, labels });
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

// saveGoalFromCard sends what the editing card says. An emptied labels field clears them, which is
// what a person means by deleting the text there.
async function saveGoalFromCard(li) {
  const id = li.dataset.id;
  const title = li.querySelector('.goal-edit-title').value.trim();
  if (!title) return;
  try {
    await api('api/goals/update', {
      id,
      title,
      description: li.querySelector('.goal-edit-desc').value.trim(),
      deadline: li.querySelector('.goal-edit-deadline').value,
      priority: Number(li.querySelector('.goal-edit-priority').value) || 0,
      labels: li.querySelector('.goal-edit-labels').value.trim() || '[]',
    });
    state.editingGoal = '';
    await load();
  } catch (e) {
    showError(e);
  }
}

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

// The same keys in the goal card: Enter saves, Esc drops the change.
$('goals').addEventListener('keydown', (ev) => {
  const li = ev.target.closest('li.goal.editing');
  if (!li) return;
  if (ev.key === 'Enter' && !ev.shiftKey) {
    ev.preventDefault();
    saveGoalFromCard(li);
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    state.editingGoal = '';
    renderGoals();
  }
});

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

applyTexts();

let startTab = 'goals';
try { startTab = localStorage.getItem(TAB_KEY) || 'goals'; } catch (e) { /* private mode */ }
showTab(startTab);

load();
loadStatus();
