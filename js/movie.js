import { api } from './api.js';
import { getUser, initAuth, withAuth } from './auth.js';
import { initHeader } from './header.js';
import { addRecent } from './recent.js';
import { icons } from './icons.js';
import {
  $, escapeHtml, formatFullDate, formatPrice, bookingUrl, formatRuntime, nextDays, showToast,
} from './utils.js';

const LOW_SEATS = 10;

let movie = null;
let selectedDate = null;
const sessionsByDate = new Map(); // iso date -> Promise<[{ venue, sessions }]>
const loadedDates = new Set(); // dates whose request has finished (the rest are still loading)

const slug = new URLSearchParams(window.location.search).get('slug');

/* ---------- Age gate ---------- */

// Logged-in users below the film's minimum age cannot book. Guests can click through:
// the check happens after they log in. A profile without a date of birth has no age yet,
// and booking itself is blocked until the profile is complete.
function ageBlocked() {
  const user = getUser();
  return Boolean(user && user.age !== null && user.age !== undefined && user.age < movie.ageRating.minAge);
}

/* ---------- Hero ---------- */

const heroImage = (url) => url?.replace('/t/p/w1280/', '/t/p/original/') ?? '';

function renderHero() {
  const hero = $('#film-hero');
  if (movie.backdropUrl) {
    $('.film-hero__backdrop', hero).innerHTML = `<img src="${escapeHtml(heroImage(movie.backdropUrl))}" alt="" fetchpriority="high">`;
  }
  $('.film-hero__poster', hero).outerHTML = movie.posterUrl
    ? `<img class="film-hero__poster" src="${escapeHtml(movie.posterUrl)}" alt="${escapeHtml(movie.title)} poster">`
    : '<div class="film-hero__poster img-fallback"></div>';

  $('.film-hero__info', hero).innerHTML = `
    <span class="hero-label">${movie.isComingSoon ? 'Coming soon' : 'Now playing'}</span>
    <h1 class="film-hero__title">${escapeHtml(movie.title)}</h1>
    <p class="film-hero__synopsis">${escapeHtml(movie.synopsis ?? '')}</p>
    <div class="film-hero__tags">
      <span class="age-badge age-badge--lg" title="${escapeHtml(movie.ageRating.description)}">${escapeHtml(movie.ageRating.code)}</span>
      <span class="tag">${icons.timer}${formatRuntime(movie.runtimeMinutes)}</span>
      ${movie.formats.map((f) => `<span class="tag">${escapeHtml(f.name)}</span>`).join('')}
    </div>`;
}

/* ---------- Details sidebar ---------- */

function renderDetails() {
  const item = (label, value) => (value ? `
    <div class="film-details__item">
      <dt>${label}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>` : '');

  $('#film-details').innerHTML = `
    <h2 class="film-details__title" id="film-details-title">Details</h2>
    <dl class="film-details__list">
      ${item('Director', movie.director)}
      ${item('Main cast', movie.cast)}
      ${item('Genre', movie.genres.map((g) => g.name).join(', '))}
      ${item('Duration', `${movie.runtimeMinutes} minutes`)}
      ${item('Release date', formatFullDate(movie.releaseDate))}
      ${item('Formats', movie.formats.map((f) => f.name).join(', '))}
      ${movie.isComingSoon ? '' : item('From', formatPrice(movie.fromPrice).replace(' ', ''))}
    </dl>
    <div class="rating-note">
      <p class="rating-note__title">Rating note</p>
      <p class="rating-note__body">
        <strong>${escapeHtml(movie.ageRating.code)}</strong>
        <span>${escapeHtml(movie.ageRating.description)}</span>
      </p>
    </div>`;
}

/* ---------- Showtimes ---------- */

function sessionsFor(date) {
  if (!sessionsByDate.has(date)) {
    const promise = api.movieSessions(movie.slug, date);
    promise.then(() => loadedDates.add(date), () => sessionsByDate.delete(date)); // a failure can be retried
    sessionsByDate.set(date, promise);
  }
  return sessionsByDate.get(date);
}

function renderSessionsShell() {
  const days = nextDays();
  const available = new Set(movie.availableDates);
  $('#film-sessions').innerHTML = `
    <div class="film-sessions__head">
      <h2 class="film-sessions__title" id="film-sessions-title">Sessions</h2>
    </div>
    <div class="day-picker" role="group" aria-label="Choose a date">
      ${days.map((d) => `
        <button type="button" class="day-picker__day ${available.has(d.iso) ? '' : 'is-empty'}" data-date="${d.iso}"
          aria-label="${d.label}${available.has(d.iso) ? '' : ', no sessions'}">
          <span>${d.weekday}</span><strong>${d.day}</strong>
        </button>`).join('')}
    </div>
    <div class="age-gate" id="age-gate" role="alert" hidden></div>
    <div class="film-sessions__list" id="film-sessions-list" aria-live="polite"></div>`;

  $('.day-picker').addEventListener('click', (e) => {
    const day = e.target.closest('[data-date]');
    if (day && day.dataset.date !== selectedDate) selectDate(day.dataset.date);
  });
}

async function selectDate(date) {
  selectedDate = date;
  // Keep the chosen day in the URL so a refresh or a shared link lands on it.
  const params = new URLSearchParams(window.location.search);
  params.set('date', date);
  history.replaceState(null, '', `?${params}`);

  for (const day of document.querySelectorAll('.day-picker__day')) {
    const selected = day.dataset.date === date;
    day.classList.toggle('is-selected', selected);
    day.setAttribute('aria-pressed', String(selected));
  }

  const list = $('#film-sessions-list');
  list.setAttribute('aria-busy', 'true');
  // Cached days render instantly; otherwise show placeholder halls while the day loads.
  if (!loadedDates.has(date)) list.innerHTML = showtimesSkeleton();
  try {
    const groups = await sessionsFor(date);
    if (date !== selectedDate) return;
    renderShowtimes(groups);
  } catch (err) {
    if (date !== selectedDate) return;
    list.innerHTML = `
      <div class="section-error">
        <span>${escapeHtml(err.message)}</span>
        <button type="button" class="btn btn--transparent btn--sm" data-retry>Try again</button>
      </div>`;
    list.querySelector('[data-retry]').addEventListener('click', () => selectDate(date));
  } finally {
    if (date === selectedDate) list.removeAttribute('aria-busy');
  }
}

const showtimesSkeleton = () => `
  <div class="venue-block">
    <span class="venue-block__title skeleton skeleton--text"></span>
    <div class="venue-block__halls">
      <div class="hall skeleton skeleton--hall"></div>
      <div class="hall skeleton skeleton--hall"></div>
    </div>
  </div>`;

function showtime(s, blocked) {
  const disabled = blocked || s.isSoldOut;
  const seats = s.isSoldOut
    ? '<span class="showtime__seats">Sold out</span>'
    : `<span class="showtime__seats ${s.seatsLeft < LOW_SEATS ? 'is-low' : ''}">${icons.ticket}${s.seatsLeft} left</span>`;
  const body = `
    <span class="showtime__main">
      <span class="showtime__time">${escapeHtml(s.time)}</span>
      <span class="showtime__meta">
        <abbr class="showtime__lang" title="${escapeHtml(s.language.name)}">${escapeHtml(s.language.code)}</abbr>
        <span class="showtime__format">${escapeHtml(s.format.name)}</span>
      </span>
    </span>
    <span class="showtime__side">
      <span class="showtime__price">${formatPrice(s.price)}</span>
      ${seats}
    </span>`;
  const label = `${s.time}, Hall ${s.hall.name}, ${s.format.name}, ${s.language.name}, ${formatPrice(s.price)}, ${s.isSoldOut ? 'sold out' : `${s.seatsLeft} seats left`}`;

  return disabled
    ? `<div class="showtime is-disabled" aria-disabled="true" aria-label="${escapeHtml(label)}">${body}</div>`
    : `<a class="showtime" href="${bookingUrl(movie.slug, s.id, selectedDate)}" data-session="${s.id}" aria-label="${escapeHtml(label)}">${body}</a>`;
}

// Grouped by venue (from the API), then by hall ("auditorium") within each venue.
function renderShowtimes(groups) {
  const list = $('#film-sessions-list');
  const blocked = ageBlocked();

  const gate = $('#age-gate');
  gate.hidden = !blocked;
  gate.innerHTML = blocked
    ? `${icons.error}<span>This film is rated ${escapeHtml(movie.ageRating.code)}. You cannot buy tickets for it with this account.</span>`
    : '';

  if (!groups.length) {
    list.innerHTML = `
      <div class="film-sessions__empty">
        <span class="search-state__icon">${icons.calendar}</span>
        <p class="search-state__title">No sessions on this day</p>
        <p class="search-state__text">Pick another date to see showtimes.</p>
      </div>`;
    return;
  }

  list.innerHTML = groups.map(({ venue, sessions }) => {
    const halls = new Map();
    for (const s of sessions) {
      if (!halls.has(s.hall.id)) halls.set(s.hall.id, { name: s.hall.name, sessions: [] });
      halls.get(s.hall.id).sessions.push(s);
    }
    return `
      <section class="venue-block">
        <h3 class="venue-block__title">${escapeHtml(venue.name)}</h3>
        <div class="venue-block__halls">
          ${[...halls.values()].map((hall) => `
            <div class="hall">
              <h4 class="hall__title">Hall ${escapeHtml(hall.name)}</h4>
              <div class="hall__showtimes">${hall.sessions.map((s) => showtime(s, blocked)).join('')}</div>
            </div>`).join('')}
        </div>
      </section>`;
  }).join('');
}

/* ---------- Coming soon: no sessions, offer Notify me ---------- */

function renderComingSoon() {
  const notified = movie.isNotified;
  $('#film-sessions').innerHTML = `
    <div class="film-sessions__head">
      <h2 class="film-sessions__title" id="film-sessions-title">Sessions</h2>
    </div>
    <div class="film-soon">
      <span class="search-state__icon">${icons.calendar}</span>
      <div>
        <p class="film-soon__title">In cinemas ${formatFullDate(movie.releaseDate)}</p>
        <p class="film-soon__text">Showtimes are not on sale yet. We can let you know when they are.</p>
      </div>
      <button type="button" class="btn btn--notify btn--md notify-btn ${notified ? 'is-notified' : ''}" ${notified ? 'disabled' : ''}>
        ${notified ? `${icons.check} Reminder set` : `${icons.bell} Notify Me`}
      </button>
    </div>`;

  const button = $('.film-soon .notify-btn');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const result = await withAuth(() => api.notify(movie.slug));
      if (!result) {
        button.disabled = false;
        return;
      }
      if (!result.subscribed) {
        button.disabled = false;
        showToast("We couldn't set the reminder. Please try again.");
        return;
      }
      movie.isNotified = true;
      button.classList.add('is-notified');
      button.innerHTML = `${icons.check} Reminder set`;
      showToast("We'll let you know when it opens.", 'success');
    } catch (err) {
      button.disabled = false;
      showToast(err.message);
    }
  });
}

/* ---------- Boot ---------- */

function renderNotFound(message) {
  $('#movie-page').innerHTML = `
    <div class="container film-missing">
      <span class="search-state__icon">${icons.search}</span>
      <h1 class="search-state__title">${escapeHtml(message)}</h1>
      <p class="search-state__text">It may have finished its run, or the link is incomplete.</p>
      <a class="btn btn--transparent btn--md" href="sessions.html">Browse all sessions</a>
    </div>`;
}

// Anything other than a 404 is worth retrying (server error, network).
function renderLoadError(message) {
  $('#movie-page').innerHTML = `
    <div class="container film-missing">
      <span class="search-state__icon">${icons.error}</span>
      <h1 class="search-state__title">We couldn't load this film</h1>
      <p class="search-state__text">${escapeHtml(message)}</p>
      <button type="button" class="btn btn--primary btn--md" data-reload>Try again</button>
    </div>`;
  $('[data-reload]').addEventListener('click', () => window.location.reload());
}

async function boot() {
  initHeader();
  // Wait for the session: it decides the age gate and the per-user `isNotified`.
  const auth = initAuth();

  if (!slug) {
    renderNotFound('Film not found');
    return;
  }

  try {
    [movie] = await Promise.all([api.movie(slug), auth]);
  } catch (err) {
    if (err.status === 404) renderNotFound('Film not found');
    else renderLoadError(err.message);
    return;
  }

  document.title = `${movie.title} · Kino XII`;
  $('#movie-page').removeAttribute('aria-busy');
  addRecent(movie);
  renderHero();
  renderDetails();

  if (movie.isComingSoon) {
    renderComingSoon();
  } else {
    renderSessionsShell();
    const days = nextDays().map((d) => d.iso);
    const requested = new URLSearchParams(window.location.search).get('date');
    selectDate(days.includes(requested) ? requested : days[0]);
  }

  // Logging in or out changes the age gate (and Notify state), so redraw what depends on it.
  window.addEventListener('auth:change', async () => {
    if (movie.isComingSoon) {
      try { movie = await api.movie(slug); } catch { /* keep what we have */ }
      renderComingSoon();
    } else if (selectedDate) {
      sessionsFor(selectedDate).then((groups) => renderShowtimes(groups)).catch(() => {});
    }
  });
}

boot();
