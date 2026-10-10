import { api } from './api.js';
import { initHeader } from './header.js';
import { addRecent, getRecent } from './recent.js';
import { icons } from './icons.js';
import {
  $, $$, escapeHtml, enableDragScroll, formatDayMonth, formatPrice, formatRuntime,
  movieUrl, primaryGenre,
} from './utils.js';

const SLIDE_DURATION_MS = 7000;
const NOW_PLAYING_LIMIT = 12;
const COMING_SOON_LIMIT = 8;

// Every movie rendered on the page, by slug, so a click can be recorded in "Recently viewed".
const moviesBySlug = new Map();

const remember = (movies) => movies.forEach((m) => moviesBySlug.set(m.slug, m));

/* ---------- Shared bits ---------- */

const ageBadge = (rating, extraClass = '') =>
  `<span class="age-badge ${extraClass}" title="${escapeHtml(rating.description)}">${escapeHtml(rating.code)}</span>`;

const movieMeta = (movie) =>
  `${escapeHtml(primaryGenre(movie))} · ${formatRuntime(movie.runtimeMinutes)}`;

const poster = (url, alt, className) => url
  ? `<img class="${className}" src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" draggable="false">`
  : `<div class="${className} img-fallback"></div>`;

function renderError(container, message, onRetry) {
  container.innerHTML = `
    <div class="section-error">
      <span>${escapeHtml(message)}</span>
      <button type="button" class="btn btn--transparent btn--sm">Try again</button>
    </div>`;
  container.querySelector('button').addEventListener('click', onRetry);
}

/* ---------- Hero carousel ---------- */

// TMDB serves larger sizes from the same path, which keeps the hero sharp at 1920px.
const heroImage = (url) => url?.replace('/t/p/w1280/', '/t/p/original/') ?? '';

async function loadHero() {
  const hero = $('#hero');
  try {
    const movies = await api.featured();
    remember(movies);
    if (movies.length) renderHero(hero, movies);
    else hero.classList.add('is-empty');
  } catch (err) {
    hero.classList.add('is-empty');
    renderError($('.hero__content', hero), err.message, loadHero);
  }
}

function renderHero(hero, movies) {
  $('.hero__slides', hero).innerHTML = movies.map((m, i) => `
    <div class="hero__slide" data-index="${i}">
      <img class="hero__bg" src="${escapeHtml(heroImage(m.backdropUrl))}" alt="" ${i === 0 ? 'fetchpriority="high"' : ''}>
    </div>`).join('');

  $('.hero__content', hero).innerHTML = movies.map((m, i) => `
    <article class="hero__item" data-index="${i}" aria-hidden="true">
      <span class="hero__label">Premiere · Week of ${formatDayMonth(m.releaseDate, 'short')}</span>
      <h1 class="hero__title">${escapeHtml(m.title)}</h1>
      <div class="hero__tags">
        ${ageBadge(m.ageRating, 'age-badge--lg')}
        <span class="tag">${icons.timer}${formatRuntime(m.runtimeMinutes)}</span>
        ${m.formats.map((f) => `<span class="tag">${escapeHtml(f.name)}</span>`).join('')}
      </div>
      <p class="hero__synopsis">${escapeHtml(m.synopsis ?? '')}</p>
      <div class="hero__actions">
        <a class="btn btn--primary" href="${movieUrl(m.slug)}" data-movie-link="${escapeHtml(m.slug)}">${icons.ticket} Buy tickets</a>
        <a class="btn btn--transparent" href="sessions.html">All sessions</a>
      </div>
    </article>`).join('');

  $('.hero__progress', hero).innerHTML = movies.map((m, i) => `
    <button type="button" class="hero__bar" data-index="${i}" aria-label="Show ${escapeHtml(m.title)}">
      <span class="hero__bar-fill"></span>
    </button>`).join('');

  hero.style.setProperty('--slide-duration', `${SLIDE_DURATION_MS}ms`);

  let current = -1;
  const show = (index) => {
    const next = (index + movies.length) % movies.length;
    if (next === current) return;
    current = next;
    for (const el of $$('[data-index]', hero)) {
      const active = Number(el.dataset.index) === current;
      el.classList.toggle('is-active', active);
      if (el.classList.contains('hero__item')) {
        el.setAttribute('aria-hidden', String(!active));
        el.inert = !active;
      }
    }
  };

  // The progress bar's CSS animation is the timer: when it finishes, advance.
  $('.hero__progress', hero).addEventListener('animationend', (e) => {
    if (e.target.classList.contains('hero__bar-fill')) show(current + 1);
  });
  $('.hero__progress', hero).addEventListener('click', (e) => {
    const bar = e.target.closest('.hero__bar');
    if (bar) show(Number(bar.dataset.index));
  });
  $('[data-hero-prev]', hero).addEventListener('click', () => show(current - 1));
  $('[data-hero-next]', hero).addEventListener('click', () => show(current + 1));

  hero.classList.add('is-ready');
  hero.classList.toggle('is-single', movies.length < 2);
  show(0);
}

/* ---------- Recently viewed ---------- */

function renderRecent() {
  const section = $('#recent-section');
  const items = getRecent();
  section.hidden = items.length === 0;
  if (!items.length) return;
  remember(items.filter((item) => !moviesBySlug.has(item.slug)));

  $('.card-row', section).innerHTML = items.map((m) => `
    <a class="recent-card" href="${movieUrl(m.slug)}" data-movie-link="${escapeHtml(m.slug)}">
      ${poster(m.posterUrl, '', 'recent-card__thumb')}
      <span class="recent-card__body">
        <span class="recent-card__title">${escapeHtml(m.title)}</span>
        <span class="card-meta">${movieMeta(m)}</span>
        ${ageBadge(m.ageRating)}
      </span>
    </a>`).join('');
}

/* ---------- Now playing ---------- */

const skeletons = (count, className) =>
  Array.from({ length: count }, () => `<div class="${className} skeleton"></div>`).join('');

async function loadNowPlaying() {
  const row = $('#now-playing .card-row');
  row.innerHTML = skeletons(7, 'movie-card');
  try {
    const movies = await api.nowPlaying(NOW_PLAYING_LIMIT);
    remember(movies);
    row.innerHTML = movies.length
      ? movies.map(movieCard).join('')
      : `<p class="section-empty">Nothing is showing right now. New sessions are added every week.
           <a class="btn btn--transparent btn--sm" href="sessions.html">Browse sessions</a></p>`;
  } catch (err) {
    renderError(row, err.message, loadNowPlaying);
  }
}

const movieCard = (m) => `
  <article class="movie-card">
    <a class="movie-card__poster-link" href="${movieUrl(m.slug)}" data-movie-link="${escapeHtml(m.slug)}" tabindex="-1">
      ${poster(m.posterUrl, m.title, 'movie-card__poster')}
    </a>
    <div class="movie-card__body">
      <h3 class="movie-card__title">
        <a href="${movieUrl(m.slug)}" data-movie-link="${escapeHtml(m.slug)}">${escapeHtml(m.title)}</a>
      </h3>
      <div class="card-meta">${movieMeta(m)}</div>
      ${ageBadge(m.ageRating)}
      <p class="movie-card__synopsis">${escapeHtml(m.synopsis ?? '')}</p>
      <div class="movie-card__footer">
        <span class="movie-card__price">From ${formatPrice(m.fromPrice)}</span>
        <a class="btn btn--primary btn--xs" href="${movieUrl(m.slug)}" data-movie-link="${escapeHtml(m.slug)}">Buy Ticket</a>
      </div>
    </div>
  </article>`;

/* ---------- Coming soon ---------- */

async function loadComingSoon() {
  const row = $('#coming-soon .card-row');
  row.innerHTML = skeletons(4, 'soon-card');
  try {
    const movies = await api.comingSoon(COMING_SOON_LIMIT);
    remember(movies);
    row.innerHTML = movies.length
      ? movies.map(soonCard).join('')
      : '<p class="section-empty">No upcoming titles announced yet.</p>';
  } catch (err) {
    renderError(row, err.message, loadComingSoon);
  }
}

const notifyButtonContent = (notified) =>
  notified ? `${icons.check} Reminder set` : `${icons.bell} Notify Me`;

// Coming soon titles have no sessions, so the card opens the details page, never seat selection.
const soonCard = (m) => {
  const notified = m.isNotified;
  return `
  <article class="soon-card">
    <a class="soon-card__image-link" href="${movieUrl(m.slug)}" data-movie-link="${escapeHtml(m.slug)}" tabindex="-1">
      ${poster(m.backdropUrl || m.posterUrl, m.title, 'soon-card__image')}
    </a>
    <div class="soon-card__body">
      <span class="soon-card__date">In cinemas ${formatDayMonth(m.releaseDate)}</span>
      <h3 class="soon-card__title">
        <a href="${movieUrl(m.slug)}" data-movie-link="${escapeHtml(m.slug)}">${escapeHtml(m.title)}</a>
      </h3>
      <div class="card-meta">${movieMeta(m)}</div>
      ${ageBadge(m.ageRating)}
      <button type="button" class="btn btn--notify btn--xs notify-btn ${notified ? 'is-notified' : ''}"
        data-notify="${escapeHtml(m.slug)}" ${notified ? 'disabled' : ''}>
        ${notifyButtonContent(notified)}
      </button>
    </div>
  </article>`;
};

/* ---------- Boot ---------- */

function bindPageEvents() {
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-movie-link]');
    if (link) addRecent(moviesBySlug.get(link.dataset.movieLink));

  });

  $$('.card-row').forEach(enableDragScroll);

  // Coming back with the browser's Back button should show the newly viewed title.
  window.addEventListener('pageshow', (e) => { if (e.persisted) renderRecent(); });
}

function boot() {
  bindPageEvents();
  initHeader();
  renderRecent();
  loadHero();
  loadNowPlaying();
  loadComingSoon();
}

boot();
