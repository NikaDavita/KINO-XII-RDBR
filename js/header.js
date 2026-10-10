import { getUser, logout } from './auth.js';
import { openAuthModal } from './auth-modal.js';
import { icons } from './icons.js';
import { $, escapeHtml, initials } from './utils.js';

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
        <input class="search__input" type="search" placeholder="Search films and live events" aria-label="Search films and live events">
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
