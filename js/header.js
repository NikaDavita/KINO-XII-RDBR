import { api } from './api.js';
import { getUser, logout } from './auth.js';
import { openAuthModal } from './auth-modal.js';
import { addRecent } from './recent.js';
import { icons } from './icons.js';
import { $, debounce, escapeHtml, formatPrice, formatRuntime, initials, movieUrl } from './utils.js';

// Header and footer markup lives here so every page shares one copy.
// `current` marks the active nav link, e.g. initHeader({ current: 'sessions' }).
function renderShell(current) {
  $('#site-header').innerHTML = `
    <div class="site-header__inner">
      <a class="logo" href="index.html" aria-label="Kino XII home">KINO <span>XII</span></a>
      <nav class="main-nav">
        <a href="sessions.html" ${current === 'sessions' ? 'aria-current="page"' : ''}>Sessions</a>
      </nav>

      <form class="search" id="header-search" role="search" autocomplete="off">
        <span class="search__icon">${icons.search}</span>
        <input class="search__input" type="search" placeholder="Search films and live events" aria-label="Search films and live events"
          role="combobox" aria-expanded="false" aria-controls="search-panel" aria-autocomplete="list">
        <button type="button" class="search__clear" aria-label="Clear search">${icons.close}</button>
        <div class="search__panel" id="search-panel" hidden></div>
      </form>

      <div class="header-auth" id="header-auth"></div>
    </div>`;

  const footer = $('#site-footer');
  if (footer) {
    footer.innerHTML = `
      <div class="site-footer__inner">
        <a class="logo logo--sm" href="index.html" aria-label="Kino XII home">KINO <span>XII</span></a>
        <p>© 2026 Kino XII. All rights reserved.</p>
      </div>`;
  }
}

export function initHeader({ current } = {}) {
  renderShell(current);
  const header = $('#site-header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 24);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Rendered on the first auth:change (after /me), so a signed-in user never sees the guest buttons flash.
  window.addEventListener('auth:change', renderAuthArea);
  initSearch();
}

/* ---------- Auth area: guest buttons or user menu ---------- */

let menuListeners = null;

function renderAuthArea() {
  menuListeners?.abort();
  const slot = $('#header-auth');
  const user = getUser();

  if (!user) {
    slot.innerHTML = `
      <button type="button" class="btn btn--primary btn--sm" data-action="signup">Sign up</button>
      <button type="button" class="btn btn--light btn--sm" data-action="login">Log in</button>
    `;
    slot.querySelector('[data-action="login"]').addEventListener('click', () => openAuthModal('login'));
    slot.querySelector('[data-action="signup"]').addEventListener('click', () => openAuthModal('signup'));
    return;
  }

  const displayName = user.fullName || user.username;
  const firstName = displayName.split(' ')[0];
  const avatar = (size) => `
    <span class="avatar avatar--${size}">
      ${user.avatar
        ? `<img src="${escapeHtml(user.avatar)}" alt="">`
        : `<span class="avatar__initials">${escapeHtml(initials(displayName))}</span>`}
      <span class="avatar__dot ${user.profileComplete ? 'avatar__dot--complete' : ''}" title="Profile ${user.profileComplete ? 'complete' : 'incomplete'}"></span>
    </span>`;

  slot.innerHTML = `
    <div class="user-menu">
      <button type="button" class="user-menu__trigger" aria-haspopup="true" aria-expanded="false">
        ${avatar('sm')}
        <span class="user-menu__name">${escapeHtml(firstName)}</span>
        <span class="user-menu__chevron">${icons.chevronDown}</span>
      </button>
      <div class="user-menu__panel" hidden>
        <div class="user-menu__head">
          ${avatar('md')}
          <div class="user-menu__identity">
            <div class="user-menu__fullname">${escapeHtml(displayName)}</div>
            <div class="user-menu__email">${escapeHtml(user.email)}</div>
          </div>
        </div>
        ${user.profileComplete
          ? `<div class="profile-status profile-status--complete">Profile Complete ${icons.check}</div>`
          : `<a class="profile-status profile-status--incomplete" href="profile.html">
               <strong>Profile incomplete</strong>
               <span>Please complete your profile to enable booking</span>
             </a>`}
        <nav class="user-menu__links">
          <a href="profile.html">${icons.user} My Profile</a>
          <a href="profile.html?tab=tickets">${icons.ticket} My Tickets</a>
        </nav>
        <button type="button" class="user-menu__logout" data-action="logout">${icons.logout} Log out</button>
      </div>
    </div>
  `;

  const menu = slot.querySelector('.user-menu');
  const trigger = menu.querySelector('.user-menu__trigger');
  const panel = menu.querySelector('.user-menu__panel');

  const setOpen = (open) => {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  // Document listeners are torn down on the next render so they do not pile up.
  menuListeners = new AbortController();
  const { signal } = menuListeners;
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) setOpen(false);
  }, { signal });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  }, { signal });
  menu.querySelector('[data-action="logout"]').addEventListener('click', () => logout());
}

/* ---------- Search (Figma: assets/Search) ---------- */
// Three panel states: empty prompt on focus, results while typing, and "no results".

const browseButton = '<a class="btn btn--transparent btn--md" href="sessions.html">Browse all sessions</a>';

const searchPrompt = (icon, title, text) => `
  <div class="search-state">
    <span class="search-state__icon">${icon}</span>
    <p class="search-state__title">${title}</p>
    <p class="search-state__text">${text}</p>
    ${browseButton}
  </div>`;

// Wraps the part of the title that matches the query, which the design shows in white.
function highlight(title, query) {
  const index = title.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1 || !query) return escapeHtml(title);
  return escapeHtml(title.slice(0, index))
    + `<mark>${escapeHtml(title.slice(index, index + query.length))}</mark>`
    + escapeHtml(title.slice(index + query.length));
}

const kindLabel = (kind) => (kind === 'event' ? 'Event' : 'Film');

function initSearch() {
  const form = $('#header-search');
  const input = form.querySelector('.search__input');
  const clear = form.querySelector('.search__clear');
  const panel = form.querySelector('.search__panel');
  let query = '';
  let found = [];
  let activeIndex = -1;

  const open = () => {
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };

  const renderEmpty = () => {
    found = [];
    panel.innerHTML = searchPrompt(icons.popcorn, 'What do you want to watch?', 'Search by title, director or cast');
  };

  const renderResults = (movies) => {
    found = movies;
    activeIndex = -1;
    if (!movies.length) {
      panel.innerHTML = searchPrompt(
        icons.search,
        `No results for “${escapeHtml(query)}”`,
        'Check the spelling or try another film or live event.',
      );
      return;
    }
    panel.innerHTML = `
      <div class="search-results__head">
        <span class="search-results__label">Films &amp; Events</span>
        <span class="search-results__count">${movies.length} ${movies.length === 1 ? 'result' : 'results'}</span>
      </div>
      <ul class="search-results__list" role="listbox" id="search-listbox">
        ${movies.map((m, i) => `
          <li role="presentation">
            <a class="search-result" href="${movieUrl(m.slug)}" data-slug="${escapeHtml(m.slug)}" role="option" id="search-option-${i}">
              ${m.posterUrl
                ? `<img class="search-result__poster" src="${escapeHtml(m.posterUrl)}" alt="" loading="lazy">`
                : '<span class="search-result__poster img-fallback"></span>'}
              <span class="search-result__info">
                <span class="search-result__title">${highlight(m.title, query)}</span>
                <span class="search-result__meta">${kindLabel(m.kind)} · ${escapeHtml(m.ageRating.code)} · ${formatRuntime(m.runtimeMinutes)}</span>
              </span>
              ${m.isComingSoon
                ? '<span class="search-result__side search-result__side--soon">Coming Soon</span>'
                : `<span class="search-result__side">from ${formatPrice(m.fromPrice).replace(' ', '')}</span>`}
            </a>
          </li>`).join('')}
      </ul>`;
  };

  const setActive = (index) => {
    const options = [...panel.querySelectorAll('.search-result')];
    if (!options.length) return;
    activeIndex = (index + options.length) % options.length;
    options.forEach((el, i) => el.classList.toggle('is-active', i === activeIndex));
    options[activeIndex].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', options[activeIndex].id);
  };

  const renderLoading = () => {
    panel.innerHTML = `
      <div class="search-loading" role="status">
        <span class="spinner" aria-hidden="true"></span> Searching for “${escapeHtml(query)}”…
      </div>`;
  };

  // A failed search is not "no results": say so and offer a retry.
  const renderError = (message) => {
    found = [];
    panel.innerHTML = `
      <div class="search-state">
        <span class="search-state__icon">${icons.error}</span>
        <p class="search-state__title">Search is unavailable right now</p>
        <p class="search-state__text">${escapeHtml(message)}</p>
        <button type="button" class="btn btn--transparent btn--md" data-search-retry>Try again</button>
      </div>`;
  };

  const search = async (q) => {
    try {
      const movies = await api.search(q);
      if (q === query) renderResults(movies);
    } catch (err) {
      if (q === query) renderError(err.message);
    }
  };
  const runSearch = debounce(search, 250);

  const update = () => {
    query = input.value.trim();
    form.classList.toggle('has-value', input.value.length > 0);
    input.removeAttribute('aria-activedescendant');
    if (!query) {
      renderEmpty();
      return;
    }
    // Keep the old results on screen while typing; show the loader only when there is nothing yet.
    if (!panel.querySelector('.search-result')) renderLoading();
    runSearch(query);
  };

  input.addEventListener('input', () => {
    update();
    open();
  });

  input.addEventListener('focus', () => {
    if (!query) renderEmpty();
    open();
  });

  clear.addEventListener('click', () => {
    input.value = '';
    update();
    input.focus();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); }
    if (e.key === 'Escape') { close(); input.blur(); }
  });

  // Enter opens the highlighted result, or the first one.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const movie = found[Math.max(activeIndex, 0)];
    if (movie && !panel.hidden) {
      addRecent(movie);
      window.location.href = movieUrl(movie.slug);
    }
  });

  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-search-retry]')) {
      renderLoading();
      search(query);
      input.focus();
      return;
    }
    const item = e.target.closest('[data-slug]');
    if (item) addRecent(found.find((m) => m.slug === item.dataset.slug));
  });

  // composedPath is fixed at dispatch, so a button that re-rendered the panel still counts as inside.
  document.addEventListener('click', (e) => {
    if (!e.composedPath().includes(form)) close();
  });
}
