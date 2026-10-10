import { api } from './api.js';
import { initAuth } from './auth.js';
import { initHeader } from './header.js';
import { addRecent } from './recent.js';
import { icons } from './icons.js';
import {
  $, $$, escapeHtml, enableDragScroll, formatPrice, formatRuntime, movieUrl, nextDays, bookingUrl,
} from './utils.js';

const DEFAULT_SORT = 'time_asc';
const LOW_SEATS = 10; // "X left" turns red below this

// The whole view lives in the URL, in the format the brief asks for:
// sessions.html?venue=galleria,batumi&date=2026-11-14&format=max&language=georgian-dub&time=evening&sort=price_asc&page=2
const URL_KEYS = { venues: 'venue', formats: 'format', languages: 'language', bands: 'time' };
const FILTER_KEYS = Object.keys(URL_KEYS);

let options = null; // GET /filter-options
let state = null;
let requestId = 0;
const moviesBySlug = new Map();

/* ---------- URL <-> state ---------- */

function readState() {
  const params = new URLSearchParams(window.location.search);
  const list = (key) => (params.get(key) || '').split(',').map((s) => s.trim()).filter(Boolean);
  const days = nextDays().map((d) => d.iso);

  // Anything not in /filter-options is dropped, so a hand-edited or stale link never hits a 422.
  const valid = {
    venues: options.venues.map((v) => v.slug),
    formats: options.formats.map((f) => f.slug),
    languages: options.languages.map((l) => l.slug),
    bands: options.timeBands.map((b) => b.id),
  };
  const next = {};
  for (const key of FILTER_KEYS) {
    next[key] = [...new Set(list(URL_KEYS[key]))].filter((slug) => valid[key].includes(slug));
  }
  next.date = days.includes(params.get('date')) ? params.get('date') : days[0];
  next.sort = options.sorts.some((s) => s.id === params.get('sort')) ? params.get('sort') : DEFAULT_SORT;
  next.page = Math.max(1, parseInt(params.get('page'), 10) || 1);
  return narrowFormats(next);
}

function stateToSearch(s) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) if (s[key].length) params.set(URL_KEYS[key], s[key].join(','));
  params.set('date', s.date);
  if (s.sort !== DEFAULT_SORT) params.set('sort', s.sort);
  if (s.page > 1) params.set('page', s.page);
  // Keep commas readable in the address bar.
  return `?${params.toString().replaceAll('%2C', ',')}`;
}

// Formats the selected venues can actually show. No venues selected = every format.
function availableFormats(venues) {
  if (!venues.length) return options.formats.map((f) => f.slug);
  const slugs = new Set(options.venues.filter((v) => venues.includes(v.slug)).flatMap((v) => v.formats.map((f) => f.slug)));
  return options.formats.map((f) => f.slug).filter((slug) => slugs.has(slug));
}

function narrowFormats(s) {
  const available = availableFormats(s.venues);
  return { ...s, formats: s.formats.filter((slug) => available.includes(slug)) };
}

const activeFilterCount = (s) => FILTER_KEYS.reduce((sum, key) => sum + s[key].length, 0);

// Every change goes through here. Changing a filter, the date or the sort resets to page 1.
function update(changes, { resetPage = true } = {}) {
  const next = narrowFormats({ ...state, ...changes, ...(resetPage ? { page: 1 } : {}) });
  const search = stateToSearch(next);
  if (search !== window.location.search) history.pushState(null, '', search);
  state = next;
  syncFilters();
  renderSort();
  loadSessions();
}

/* ---------- Filters sidebar ---------- */

// "Morning (before 12:00)" -> ["Morning", "before 12:00"], to match the design's "Morning · before 12:00"
function splitLabel(label) {
  const match = /^(.*?)\s*\((.*)\)\s*$/.exec(label);
  return match ? [match[1], match[2].replace(' - ', '–')] : [label, ''];
}

const checkbox = (group, value, label, detail = '') => `
  <label class="check" data-value="${escapeHtml(value)}">
    <input type="checkbox" class="check__input" name="${group}" value="${escapeHtml(value)}">
    <span class="check__box" aria-hidden="true">${icons.check}</span>
    <span class="check__label">${escapeHtml(label)}${detail ? `<span class="check__detail"> · ${escapeHtml(detail)}</span>` : ''}</span>
  </label>`;

function renderFilters() {
  const days = nextDays();
  $('#filters-body').innerHTML = `
    <fieldset class="filter-group">
      <legend class="filter-group__title">Venue</legend>
      ${options.venues.map((v) => checkbox('venues', v.slug, v.name, v.city)).join('')}
    </fieldset>

    <fieldset class="filter-group">
      <legend class="filter-group__title">Date</legend>
      <div class="date-picker">
        ${days.map((d) => `
          <button type="button" class="date-picker__day" data-date="${d.iso}" aria-label="${d.label}">
            <span>${d.weekday}</span><strong>${d.day}</strong>
          </button>`).join('')}
      </div>
    </fieldset>

    <fieldset class="filter-group">
      <legend class="filter-group__title">Format</legend>
      ${options.formats.map((f) => checkbox('formats', f.slug, f.name)).join('')}
    </fieldset>

    <fieldset class="filter-group">
      <legend class="filter-group__title">Language</legend>
      ${options.languages.map((l) => checkbox('languages', l.slug, l.name)).join('')}
    </fieldset>

    <fieldset class="filter-group">
      <legend class="filter-group__title">Time of day</legend>
      ${options.timeBands.map((b) => checkbox('bands', b.id, ...splitLabel(b.label))).join('')}
    </fieldset>
  `;

  $('#filters-body').addEventListener('change', (e) => {
    const group = e.target.name;
    if (!FILTER_KEYS.includes(group)) return;
    const values = $$(`input[name="${group}"]:checked`).map((input) => input.value);
    update({ [group]: values });
  });

  $('#filters-body').addEventListener('click', (e) => {
    const day = e.target.closest('[data-date]');
    if (day && day.dataset.date !== state.date) update({ date: day.dataset.date });
  });

  $('#clear-filters').addEventListener('click', () => {
    update(Object.fromEntries(FILTER_KEYS.map((key) => [key, []])));
  });
}

// Reflects the state onto the existing inputs, so focus is kept while the user works through the list.
function syncFilters() {
  for (const key of FILTER_KEYS) {
    for (const input of $$(`input[name="${key}"]`)) input.checked = state[key].includes(input.value);
  }
  const available = availableFormats(state.venues);
  for (const label of $$('input[name="formats"]')) {
    label.closest('.check').hidden = !available.includes(label.value);
  }
  for (const day of $$('[data-date]')) {
    const selected = day.dataset.date === state.date;
    day.classList.toggle('is-selected', selected);
    day.setAttribute('aria-pressed', String(selected));
  }
  const count = activeFilterCount(state);
  $('#filters-count').textContent = `${count} ${count === 1 ? 'filter' : 'filters'} active`;
  $('#clear-filters').style.visibility = count === 0 ? 'hidden' : '';
}

/* ---------- Sort dropdown ---------- */

function renderSort() {
  const current = options.sorts.find((s) => s.id === state.sort);
  const sort = $('#sort');
  sort.innerHTML = `
    <span class="sort__label" id="sort-label">Sort:</span>
    <button type="button" class="sort__trigger" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="sort-label sort-value">
      <span id="sort-value">${escapeHtml(current.label)}</span>${icons.chevronDown}
    </button>
    <ul class="sort__menu" role="listbox" aria-labelledby="sort-label" hidden>
      ${options.sorts.map((s) => `
        <li role="option" aria-selected="${s.id === state.sort}">
          <button type="button" class="sort__option" data-sort="${s.id}">${escapeHtml(s.label)}${s.id === state.sort ? icons.check : ''}</button>
        </li>`).join('')}
    </ul>`;
}

function initSort() {
  const sort = $('#sort');
  const setOpen = (open) => {
    const menu = sort.querySelector('.sort__menu');
    menu.hidden = !open;
    sort.querySelector('.sort__trigger').setAttribute('aria-expanded', String(open));
    sort.classList.toggle('is-open', open);
    if (open) sort.querySelector('[aria-selected="true"] button')?.focus();
  };
  sort.addEventListener('click', (e) => {
    if (e.target.closest('.sort__trigger')) {
      setOpen(sort.querySelector('.sort__menu').hidden);
      return;
    }
    const option = e.target.closest('[data-sort]');
    if (option) {
      setOpen(false);
      if (option.dataset.sort !== state.sort) update({ sort: option.dataset.sort });
      sort.querySelector('.sort__trigger').focus();
    }
  });
  sort.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      sort.querySelector('.sort__trigger').focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = $$('.sort__option', sort);
      const index = items.indexOf(document.activeElement);
      if (index === -1) return;
      e.preventDefault();
      items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  });
  document.addEventListener('click', (e) => {
    if (!sort.contains(e.target)) setOpen(false);
  });
}

/* ---------- Session list ---------- */

function sessionCard(movie, s) {
  const seats = s.isSoldOut
    ? '<span class="session-card__seats is-sold-out">Sold out</span>'
    : `<span class="session-card__seats ${s.seatsLeft < LOW_SEATS ? 'is-low' : ''}">${icons.ticket}${s.seatsLeft} left</span>`;
  const body = `
    <span class="session-card__top">
      <span class="session-card__time">${escapeHtml(s.time)}</span>
      <span class="session-card__format">${escapeHtml(s.format.name)}</span>
    </span>
    <span class="session-card__row">
      <span class="session-card__language">${escapeHtml(s.language.name)}</span>
      ${seats}
    </span>
    <span class="session-card__row">
      <span class="session-card__hall">${escapeHtml(s.venue.name)} · Hall ${escapeHtml(s.hall.name)}</span>
      <span class="session-card__price"><small>from</small> ${formatPrice(s.price).replace(' ', '')}</span>
    </span>`;

  // Sold out stays visible but is not a link, so it cannot be clicked or tabbed to.
  return s.isSoldOut
    ? `<div class="session-card is-disabled" aria-disabled="true">${body}</div>`
    : `<a class="session-card" href="${bookingUrl(movie.slug, s.id, state.date)}" data-movie-link="${escapeHtml(movie.slug)}"
         aria-label="${escapeHtml(`${movie.title}, ${s.time}, ${s.format.name}, ${s.language.name}, ${s.venue.name} Hall ${s.hall.name}, ${s.seatsLeft} seats left`)}">${body}</a>`;
}

function movieGroup({ movie, sessions }) {
  return `
    <article class="movie-group">
      <header class="movie-group__head">
        <a href="${movieUrl(movie.slug)}" data-movie-link="${escapeHtml(movie.slug)}" tabindex="-1">
          ${movie.posterUrl
            ? `<img class="movie-group__poster" src="${escapeHtml(movie.posterUrl)}" alt="" loading="lazy">`
            : '<span class="movie-group__poster img-fallback"></span>'}
        </a>
        <div>
          <h2 class="movie-group__title">
            <a href="${movieUrl(movie.slug)}" data-movie-link="${escapeHtml(movie.slug)}">${escapeHtml(movie.title)}</a>
            <span class="age-badge" title="${escapeHtml(movie.ageRating.description)}">${escapeHtml(movie.ageRating.code)}</span>
          </h2>
          <p class="movie-group__runtime">${formatRuntime(movie.runtimeMinutes)}</p>
        </div>
      </header>
      <div class="session-row card-row">
        ${sessions.map((s) => sessionCard(movie, s)).join('')}
      </div>
    </article>`;
}

const listSkeleton = () => Array.from({ length: 3 }, () => `
  <div class="movie-group">
    <div class="movie-group__head"><span class="movie-group__poster skeleton"></span></div>
    <div class="session-row">${'<span class="session-card skeleton"></span>'.repeat(5)}</div>
  </div>`).join('');

async function loadSessions() {
  const id = ++requestId;
  const list = $('#sessions-list');
  // Every load (first paint, filter, sort, page) shows the skeleton rather than an overlay spinner.
  list.innerHTML = listSkeleton();
  list.setAttribute('aria-busy', 'true');
  $('#sessions-count').textContent = 'Loading sessions…';
  $('#pagination').hidden = true;

  try {
    const { data, meta } = await api.sessions(state);
    if (id !== requestId) return; // a newer request has started

    // The API clamps an out-of-range page (e.g. ?page=99) to the last one; mirror that in the URL.
    if (meta.currentPage !== state.page && data.length) {
      state = { ...state, page: meta.currentPage };
      history.replaceState(null, '', stateToSearch(state));
    }

    data.forEach(({ movie }) => moviesBySlug.set(movie.slug, movie));
    $('#sessions-count').textContent = meta.totalSessions
      ? `Showing ${meta.totalSessions} ${meta.totalSessions === 1 ? 'session' : 'sessions'}`
      : 'No sessions found';

    list.innerHTML = data.length
      ? data.map(movieGroup).join('')
      : `<div class="sessions-empty">
           <span class="search-state__icon">${icons.calendar}</span>
           <p class="search-state__title">No sessions found</p>
           <p class="search-state__text">Try another date or loosen the filters.</p>
           ${activeFilterCount(state) ? '<button type="button" class="btn btn--transparent btn--md" data-clear>Clear all filters</button>' : ''}
         </div>`;
    $$('.session-row', list).forEach(enableDragScroll);
    renderPagination(meta);
  } catch (err) {
    if (id !== requestId) return;
    $('#sessions-count').textContent = '';
    list.innerHTML = `
      <div class="section-error">
        <span>${escapeHtml(err.message)}</span>
        <button type="button" class="btn btn--transparent btn--sm" data-retry>Try again</button>
      </div>`;
    $('#pagination').hidden = true;
  } finally {
    if (id === requestId) list.removeAttribute('aria-busy');
  }
}

/* ---------- Pagination ---------- */

// 1 … 4 5 6 … 10: first, last, and the neighbours of the current page.
function pageItems(current, last) {
  const pages = new Set([1, last, current - 1, current, current + 1].filter((p) => p >= 1 && p <= last));
  const sorted = [...pages].sort((a, b) => a - b);
  const items = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) items.push('…');
    items.push(p);
  });
  return items;
}

function renderPagination({ currentPage, lastPage }) {
  const nav = $('#pagination');
  nav.hidden = lastPage <= 1;
  if (lastPage <= 1) {
    nav.innerHTML = '';
    return;
  }
  nav.innerHTML = `
    <button type="button" class="round-btn pagination__arrow" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} aria-label="Previous page">${icons.chevronDown}</button>
    ${pageItems(currentPage, lastPage).map((p) => (p === '…'
      ? '<span class="pagination__gap" aria-hidden="true">…</span>'
      : `<button type="button" class="pagination__page ${p === currentPage ? 'is-current' : ''}" data-page="${p}" ${p === currentPage ? 'aria-current="page"' : ''} aria-label="Page ${p}">${p}</button>`)).join('')}
    <button type="button" class="round-btn pagination__arrow pagination__arrow--next" data-page="${currentPage + 1}" ${currentPage === lastPage ? 'disabled' : ''} aria-label="Next page">${icons.chevronDown}</button>
    <span class="pagination__status">Page ${currentPage} of ${lastPage}</span>`;
}

/* ---------- Boot ---------- */

function bindEvents() {
  $('#pagination').addEventListener('click', (e) => {
    const button = e.target.closest('[data-page]');
    if (!button || button.disabled) return;
    update({ page: Number(button.dataset.page) }, { resetPage: false });
    $('.sessions').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#sessions-list').addEventListener('click', (e) => {
    if (e.target.closest('[data-retry]')) loadSessions();
    if (e.target.closest('[data-clear]')) $('#clear-filters').click();
    const link = e.target.closest('[data-movie-link]');
    if (link) addRecent(moviesBySlug.get(link.dataset.movieLink));
  });

  // Back / forward: re-read the URL and redraw that exact view.
  window.addEventListener('popstate', () => {
    state = readState();
    syncFilters();
    renderSort();
    loadSessions();
  });
}

async function boot() {
  initHeader({ current: 'sessions' });
  initAuth();

  try {
    options = await api.filterOptions();
  } catch (err) {
    $('#filters-body').innerHTML = '';
    $('#sessions-list').innerHTML = `
      <div class="section-error">
        <span>${escapeHtml(err.message)}</span>
        <button type="button" class="btn btn--transparent btn--sm" onclick="location.reload()">Try again</button>
      </div>`;
    return;
  }

  state = readState();
  // Normalise the address bar (e.g. add today's date, drop unknown values) without a new history entry.
  history.replaceState(null, '', stateToSearch(state));

  renderFilters();
  initSort();
  renderSort();
  syncFilters();
  bindEvents();
  loadSessions();
}

boot();
