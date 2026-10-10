import { icons } from './icons.js';
import { $ } from './utils.js';

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

      <div class="header-auth" id="header-auth">
        <button type="button" class="btn btn--primary btn--sm">Sign up</button>
        <button type="button" class="btn btn--light btn--sm">Log in</button>
      </div>
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
}
