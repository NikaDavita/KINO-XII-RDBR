// My Profile (Figma: assets/MyProfile): personal information form + My Tickets.
// Signed-in users only; guests get the login modal first.
import { api } from './api.js';
import { getUser, initAuth, updateUser, withAuth } from './auth.js';
import { openAuthModal } from './auth-modal.js';
import { initHeader } from './header.js';
import { icons } from './icons.js';
import { $, $$, escapeHtml, formatPrice, formatRuntime, movieUrl, showToast, toIsoDate } from './utils.js';

// Only used to print "Refundable until 14:30": whether a refund is allowed comes from isRefundable.
const REFUND_CUTOFF_HOURS = 2;
const MIN_AGE = 12;

let options = null;
let saved = null; // the form values as last saved, to know whether anything changed
let tickets = { upcoming: [], past: [] };
let ticketsLoaded = false;

/* ---------- Tabs (kept in the URL: ?tab=tickets&list=past) ---------- */

function currentTabs() {
  const params = new URLSearchParams(window.location.search);
  return {
    tab: params.get('tab') === 'tickets' ? 'tickets' : 'info',
    list: params.get('list') === 'past' ? 'past' : 'upcoming',
  };
}

function setTabs(next) {
  const params = new URLSearchParams(window.location.search);
  const merged = { ...currentTabs(), ...next };
  if (merged.tab === 'tickets') params.set('tab', 'tickets'); else params.delete('tab');
  if (merged.tab === 'tickets' && merged.list === 'past') params.set('list', 'past'); else params.delete('list');
  const search = params.toString();
  history.replaceState(null, '', search ? `?${search}` : window.location.pathname);
  showTabs();
}

function showTabs() {
  const { tab, list } = currentTabs();
  for (const button of $$('.profile-tabs__tab')) {
    const active = button.dataset.tab === tab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  $('#panel-info').hidden = tab !== 'info';
  $('#panel-tickets').hidden = tab !== 'tickets';
  for (const button of $$('.ticket-tabs__tab')) {
    const active = button.dataset.list === list;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
  if (tab === 'tickets') renderTicketList();
}

/* ==========================================================================
   Personal information
   ========================================================================== */

// Validation messages are the exact strings from the brief.
function nameError(v) {
  const name = v.trim();
  if (!name) return 'Name is required';
  if (name.length < 3) return 'Name must be at least 3 characters';
  if (name.length > 50) return 'Name must not exceed 50 characters';
  return '';
}

function mobileError(v) {
  const value = v.trim();
  if (!value) return 'Mobile number is required';
  // "5XX XXX XXX" or "5XXXXXXXX": spaces are allowed, anything else is a format error.
  if (!/^[\d ]+$/.test(value)) return 'Please enter a valid Georgian mobile number (9 digits starting with 5)';
  const digits = value.replace(/ /g, '');
  if (!digits.startsWith('5')) return 'Georgian mobile numbers must start with 5';
  if (digits.length !== 9) return 'Mobile number must be exactly 9 digits';
  if (!/^5\d{2} ?\d{3} ?\d{3}$/.test(value)) return 'Please enter a valid Georgian mobile number (9 digits starting with 5)';
  return '';
}

function ageOn(isoDate, today = new Date()) {
  const [y, m, d] = isoDate.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

function dobError(v) {
  if (!v) return 'Date of birth is required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)) || v > toIsoDate(new Date()) || v < '1900-01-01') {
    return 'Please enter a valid date of birth';
  }
  if (ageOn(v) < MIN_AGE) return 'You must be at least 12 years old to create an account';
  return '';
}

const VALIDATORS = { fullName: nameError, mobileNumber: mobileError, dateOfBirth: dobError };

// "You are 14: you cannot buy tickets for 16+ or 18+ titles", from the age ratings in /filter-options.
function eligibilityText(age) {
  const blocked = options.ageRatings.filter((r) => r.minAge > age).map((r) => r.code);
  if (!blocked.length) return { blocked: false, text: `You are ${age}, you can buy tickets for all age ratings.` };
  const list = blocked.length > 1 ? `${blocked.slice(0, -1).join(', ')} or ${blocked.at(-1)}` : blocked[0];
  return { blocked: true, text: `You are ${age}, you cannot buy tickets for ${list} titles.` };
}

const formatMobile = (digits) => (digits ? digits.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3') : '');

function valuesFromUser(user) {
  return {
    fullName: user.fullName ?? '',
    mobileNumber: formatMobile(user.mobileNumber ?? ''),
    dateOfBirth: user.dateOfBirth ?? '',
    preferredVenueId: user.preferredVenue?.id ? String(user.preferredVenue.id) : '',
  };
}

function renderInfo() {
  const user = getUser();
  saved = valuesFromUser(user);
  const field = (name, label, input, hint = '') => `
    <div class="field" data-field="${name}">
      <label class="field__label" for="profile-${name}">${label}</label>
      <div class="field__control">
        ${input}
        <span class="field__status field__status--valid">${icons.check}</span>
        <span class="field__status field__status--invalid">${icons.error}</span>
      </div>
      <p class="field__error" id="profile-${name}-error"></p>
      ${hint}
    </div>`;

  $('#panel-info').innerHTML = `
    <div class="profile-status-bar" id="profile-status"></div>
    <form class="profile-form" novalidate>
      ${field('fullName', 'Full name', `<input class="field__input" id="profile-fullName" name="fullName" type="text" autocomplete="name" placeholder="e.g. Jane Dolidze" value="${escapeHtml(saved.fullName)}" aria-describedby="profile-fullName-error">`)}

      <div class="field field--readonly">
        <label class="field__label" for="profile-email">Email</label>
        <div class="field__control">
          <input class="field__input" id="profile-email" type="email" value="${escapeHtml(user.email)}" readonly aria-describedby="profile-email-hint">
        </div>
        <p class="field__hint" id="profile-email-hint">Set at registration and cannot be changed</p>
      </div>

      ${field('mobileNumber', 'Mobile number', `<input class="field__input" id="profile-mobileNumber" name="mobileNumber" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="e.g. 555 123 456" value="${escapeHtml(saved.mobileNumber)}" aria-describedby="profile-mobileNumber-error">`)}

      ${field('dateOfBirth', 'Date of birth', `<input class="field__input field__input--date" id="profile-dateOfBirth" name="dateOfBirth" type="date" max="${toIsoDate(new Date())}" min="1900-01-01" value="${escapeHtml(saved.dateOfBirth)}" aria-describedby="profile-dateOfBirth-error profile-eligibility">`,
        '<p class="eligibility" id="profile-eligibility" aria-live="polite"></p>')}

      <div class="field" data-field="preferredVenueId">
        <label class="field__label" for="profile-preferredVenueId">Preferred venue (optional)</label>
        <div class="field__control select-control">
          <select class="field__input" id="profile-preferredVenueId" name="preferredVenueId">
            <option value="">No preference</option>
            ${options.venues.map((v) => `<option value="${v.id}" ${String(v.id) === saved.preferredVenueId ? 'selected' : ''}>${escapeHtml(v.name)} · ${escapeHtml(v.city)}</option>`).join('')}
          </select>
          <span class="select-control__chevron">${icons.chevronDown}</span>
        </div>
      </div>

      <div class="profile-form__actions">
        <button type="submit" class="btn btn--primary btn--md" disabled>Save changes</button>
        <span class="profile-form__dirty" hidden>Unsaved changes</span>
      </div>
    </form>`;

  const form = $('.profile-form');
  const touched = new Set(Object.keys(VALIDATORS).filter((k) => saved[k]));
  let serverErrors = {};
  let saving = false;

  const values = () => ({
    fullName: form.fullName.value,
    mobileNumber: form.mobileNumber.value,
    dateOfBirth: form.dateOfBirth.value,
    preferredVenueId: form.preferredVenueId.value,
  });

  function refresh() {
    const v = values();
    let valid = true;
    for (const [name, validate] of Object.entries(VALIDATORS)) {
      const el = form.querySelector(`[data-field="${name}"]`);
      const clientError = validate(v[name]);
      if (clientError) valid = false;
      const error = serverErrors[name] || (touched.has(name) ? clientError : '');
      el.classList.toggle('is-invalid', Boolean(error));
      el.classList.toggle('is-valid', !error && !clientError);
      el.querySelector('.field__error').textContent = error;
      form[name].setAttribute('aria-invalid', String(Boolean(error)));
    }

    // Live eligibility notice from the date being entered.
    const eligibility = $('#profile-eligibility');
    if (!dobError(v.dateOfBirth)) {
      const { blocked, text } = eligibilityText(ageOn(v.dateOfBirth));
      eligibility.textContent = text;
      eligibility.className = `eligibility ${blocked ? 'is-blocked' : 'is-ok'}`;
    } else {
      eligibility.textContent = '';
      eligibility.className = 'eligibility';
    }

    const dirty = Object.keys(saved).some((k) => v[k].trim() !== saved[k]);
    form.querySelector('.profile-form__dirty').hidden = !dirty || saving;
    const button = form.querySelector('[type="submit"]');
    button.disabled = !dirty || !valid || saving;
    button.innerHTML = saving ? '<span class="spinner" aria-hidden="true"></span> Saving…' : 'Save changes';
  }

  form.addEventListener('input', (e) => {
    delete serverErrors[e.target.name];
    refresh();
  });
  form.addEventListener('change', refresh);
  form.addEventListener('focusout', (e) => {
    if (VALIDATORS[e.target.name]) {
      touched.add(e.target.name);
      refresh();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    Object.keys(VALIDATORS).forEach((k) => touched.add(k));
    refresh();
    if (saving || form.querySelector('[type="submit"]').disabled) return;

    saving = true;
    refresh();
    const v = values();
    try {
      // On a 401 the login modal opens and, once logged in, the same save is sent again.
      const user = await withAuth(() => api.updateProfile({
        fullName: v.fullName.trim(),
        mobileNumber: v.mobileNumber.replace(/ /g, ''),
        dateOfBirth: v.dateOfBirth,
        preferredVenueId: v.preferredVenueId ? Number(v.preferredVenueId) : null,
      }));
      if (!user) { // login modal closed: nothing was saved
        if (!getUser()) renderGate();
        return;
      }
      updateUser(user);
      saved = valuesFromUser(user);
      form.mobileNumber.value = saved.mobileNumber;
      renderStatus();
      showToast('Profile saved.', 'success');
    } catch (err) {
      if (err.errors) {
        // The API's messages are the brief's exact strings; show them as returned.
        serverErrors = Object.fromEntries(Object.entries(err.errors).map(([k, m]) => [k, m[0]]));
      } else {
        showToast(err.message);
      }
    } finally {
      saving = false;
      refresh();
    }
  });

  renderStatus();
  refresh();
}

// Incomplete: warning banner. Complete: "Profile Complete ✓".
function renderStatus() {
  const user = getUser();
  $('#profile-status').innerHTML = user.profileComplete
    ? `<p class="profile-status-bar__complete">Profile Complete ${icons.check}</p>`
    : `<p class="profile-status-bar__incomplete">${icons.error}<span>Please complete your profile to enable booking.</span></p>`;
}

/* ==========================================================================
   My Tickets
   ========================================================================== */

function formatSessionDate(isoDate, time) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const day = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${time}`;
}

// "14:30, Tue 15 Sep": 2 hours before the start. Built from the session's own date and time
// (cinema wall-clock time); `startsAt` carries a +00:00 offset that does not match `time`.
function refundDeadline(session) {
  const [y, m, d0] = session.date.split("-").map(Number);
  const [hh, mm] = session.time.split(":").map(Number);
  const d = new Date(new Date(y, m - 1, d0, hh, mm).getTime() - REFUND_CUTOFF_HOURS * 3600 * 1000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${time}, ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}`;
}

function ticketCard(order) {
  const s = order.session;
  const film = s.movie;
  const refunded = order.status === 'refunded';
  let action = '';
  if (!refunded && order.isUpcoming) {
    action = order.isRefundable
      ? `<button type="button" class="btn btn--transparent btn--sm btn--block" data-refund="${escapeHtml(order.reference)}">Refund</button>
         <p class="ticket-card__note">Refundable until ${refundDeadline(s)}</p>`
      : `<button type="button" class="btn btn--transparent btn--sm btn--block" disabled aria-describedby="refund-note-${order.id}">Refund</button>
         <p class="ticket-card__note" id="refund-note-${order.id}">Refunds closed at ${refundDeadline(s)}, ${REFUND_CUTOFF_HOURS} hours before the screening.</p>`;
  } else if (refunded) {
    action = '<p class="ticket-card__refunded">Refunded</p>';
  }

  return `
    <article class="ticket-card ${refunded ? 'is-refunded' : ''}" data-order="${escapeHtml(order.reference)}">
      <a class="ticket-card__poster" href="${movieUrl(film.slug)}" tabindex="-1">
        ${film.posterUrl ? `<img src="${escapeHtml(film.posterUrl)}" alt="" loading="lazy">` : '<span class="img-fallback"></span>'}
      </a>
      <div class="ticket-card__body">
        <h3 class="ticket-card__title">
          <a href="${movieUrl(film.slug)}">${escapeHtml(film.title)}</a>
          <span class="age-badge" title="${escapeHtml(film.ageRating.description)}">${escapeHtml(film.ageRating.code)}</span>
          <span class="ticket-card__runtime">${formatRuntime(film.runtimeMinutes)}</span>
        </h3>
        <dl class="ticket-card__facts">
          <div><dt>Date</dt><dd>${formatSessionDate(s.date, s.time)}</dd></div>
          <div><dt>Venue</dt><dd>${escapeHtml(s.venue.name)} · Hall ${escapeHtml(s.hall.name)}</dd></div>
          <div><dt>Format</dt><dd>${escapeHtml(s.format.name)} · ${escapeHtml(s.language.name)}</dd></div>
        </dl>
        <div class="ticket-card__seats">
          <span class="ticket-card__label">Seats</span>
          ${order.tickets.map((t) => `<span class="seat-chip">${escapeHtml(t.seatCode)} · ${escapeHtml(t.ticketType.name)}</span>`).join('')}
        </div>
      </div>
      <div class="ticket-card__side">
        <p class="ticket-card__label">Order</p>
        <p class="ticket-card__ref">#${escapeHtml(order.reference)}</p>
        <p class="ticket-card__total"><span>Total paid</span><strong>${formatPrice(order.totalPrice).replace(' ', '')}</strong></p>
        ${action}
      </div>
    </article>`;
}

function renderTicketsShell() {
  $('#panel-tickets').innerHTML = `
    <div class="ticket-tabs" role="tablist" aria-label="Tickets">
      <button type="button" class="ticket-tabs__tab" role="tab" data-list="upcoming">Upcoming <span class="ticket-tabs__count" id="count-upcoming"></span></button>
      <button type="button" class="ticket-tabs__tab" role="tab" data-list="past">Past <span class="ticket-tabs__count" id="count-past"></span></button>
    </div>
    <div class="ticket-list" id="ticket-list" aria-live="polite">
      ${'<div class="ticket-card skeleton"></div>'.repeat(2)}
    </div>`;
  $('.ticket-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-list]');
    if (tab) setTabs({ list: tab.dataset.list });
  });
  $('#ticket-list').addEventListener('click', (e) => {
    const button = e.target.closest('[data-refund]');
    if (button) confirmRefund(button.dataset.refund);
  });
}

async function loadTickets() {
  if (ticketsLoaded) $('#ticket-list').setAttribute('aria-busy', 'true');
  try {
    const result = await withAuth(() => Promise.all([api.tickets('upcoming'), api.tickets('past')]));
    if (!result) {
      if (!getUser()) renderGate();
      return;
    }
    const [upcoming, past] = result;
    tickets = { upcoming, past };
    ticketsLoaded = true;
    $('#ticket-list').removeAttribute('aria-busy');
    renderCounts();
    renderTicketList();
  } catch (err) {
    $('#ticket-list').innerHTML = `
      <div class="section-error">
        <span>${escapeHtml(err.message)}</span>
        <button type="button" class="btn btn--transparent btn--sm" data-retry>Try again</button>
      </div>`;
    $('#ticket-list [data-retry]').addEventListener('click', loadTickets);
  }
}

function renderCounts() {
  $('#count-upcoming').textContent = tickets.upcoming.length;
  $('#count-past').textContent = tickets.past.length;
  const badge = $('#upcoming-badge');
  badge.textContent = tickets.upcoming.length;
  badge.hidden = !tickets.upcoming.length;
  badge.setAttribute('aria-label', `${tickets.upcoming.length} upcoming`);
}

function renderTicketList() {
  const list = $('#ticket-list');
  if (!list || !ticketsLoaded) return; // the skeleton stays until the first load
  const { list: which } = currentTabs();
  const orders = tickets[which];
  list.innerHTML = orders.length
    ? orders.map(ticketCard).join('')
    : `<div class="tickets-empty">
         <span class="search-state__icon">${icons.ticket}</span>
         <p class="search-state__title">${which === 'upcoming' ? 'No upcoming tickets' : 'No past tickets yet'}</p>
         <p class="search-state__text">${which === 'upcoming' ? 'Find a showtime and your tickets will appear here.' : 'Tickets for screenings you have been to will show up here.'}</p>
         ${which === 'upcoming' ? '<a class="btn btn--primary btn--md" href="sessions.html">Browse sessions</a>' : ''}
       </div>`;
}

/* ---------- Refund: confirm first (it cannot be undone), then POST ---------- */

function confirmRefund(reference) {
  const order = tickets.upcoming.find((o) => o.reference === reference);
  if (!order) return;
  const root = document.createElement('div');
  root.className = 'modal';
  root.innerHTML = `
    <div class="modal__backdrop" data-cancel></div>
    <div class="modal__dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="refund-title" aria-describedby="refund-text">
      <h2 class="auth__title" id="refund-title">Refund this order?</h2>
      <p class="confirm-dialog__text" id="refund-text">
        ${escapeHtml(order.session.movie.title)}, ${formatSessionDate(order.session.date, order.session.time)}.
        Seats ${order.tickets.map((t) => escapeHtml(t.seatCode)).join(', ')} will be released and
        ${formatPrice(order.totalPrice).replace(' ', '')} refunded to the card ending ${escapeHtml(order.cardLastFour ?? '')}. This cannot be undone.
      </p>
      <p class="auth__form-error" role="alert" hidden>${icons.error}<span class="auth__form-error-text"></span></p>
      <div class="confirm-dialog__actions">
        <button type="button" class="btn btn--transparent btn--md" data-cancel>Keep tickets</button>
        <button type="button" class="btn btn--primary btn--md" data-confirm>Refund</button>
      </div>
    </div>`;
  const previouslyFocused = document.activeElement;
  document.body.append(root);
  document.body.classList.add('has-modal');
  root.querySelector('[data-confirm]').focus();

  const close = () => {
    root.remove();
    if (!document.querySelector('.modal')) document.body.classList.remove('has-modal');
    document.removeEventListener('keydown', onKey);
    previouslyFocused?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  let busy = false;
  root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cancel]') && !busy) close();
    if (!e.target.closest('[data-confirm]') || busy) return;
    busy = true;
    const button = root.querySelector('[data-confirm]');
    button.disabled = true;
    button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Refunding…';
    try {
      const updated = await withAuth(() => api.refund(reference));
      if (!updated) { // login modal closed: nothing was refunded
        busy = false;
        button.disabled = false;
        button.textContent = 'Refund';
        if (!getUser()) {
          close();
          renderGate();
        }
        return;
      }
      close();
      showToast(`Order #${updated.reference} refunded. The seats are back on sale.`, 'success');
      // Both tabs come from the server again, so what is shown is what was actually stored.
      await loadTickets();
    } catch (err) {
      // 422: already refunded or inside the cutoff. The message says which.
      busy = false;
      button.disabled = false;
      button.textContent = 'Refund';
      const box = root.querySelector('.auth__form-error');
      box.querySelector('.auth__form-error-text').textContent = err.message;
      box.hidden = false;
      if (err.status === 422) loadTickets();
    }
  });
}

/* ---------- Boot: signed-in users only ---------- */

function renderGate() {
  $('.profile-tabs').hidden = true;
  $('#panel-info').hidden = true;
  $('#panel-tickets').hidden = true;
  const gate = $('#profile-gate');
  gate.hidden = false;
  gate.innerHTML = `
    <span class="search-state__icon">${icons.user}</span>
    <p class="search-state__title">Log in to see your profile</p>
    <p class="search-state__text">Your personal details and tickets live here.</p>
    <button type="button" class="btn btn--primary btn--md" data-login>Log in</button>`;
  gate.querySelector('[data-login]').addEventListener('click', () => openAuthModal('login'));
}

async function loadInfo() {
  $('#panel-info').innerHTML = '<div class="skeleton profile-skeleton"></div>';
  try {
    options = await api.filterOptions();
    renderInfo();
  } catch (err) {
    $('#panel-info').innerHTML = `
      <div class="section-error">
        <span>${escapeHtml(err.message)}</span>
        <button type="button" class="btn btn--transparent btn--sm" data-retry-info>Try again</button>
      </div>`;
    $('#panel-info [data-retry-info]').addEventListener('click', loadInfo);
  }
}

let started = false;

async function start() {
  if (started) {
    // Back from the gate after an expired session: show the page again with fresh tickets.
    if (!$('#profile-gate').hidden) {
      $('#profile-gate').hidden = true;
      $('.profile-tabs').hidden = false;
      showTabs();
      loadTickets();
    }
    return;
  }
  started = true;
  $('#profile-gate').hidden = true;
  $('.profile-tabs').hidden = false;

  await loadInfo();
  renderTicketsShell();
  showTabs();
  loadTickets();
}

async function boot() {
  initHeader();
  $('.profile-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) setTabs({ tab: tab.dataset.tab });
  });
  // Arrow keys move between the two tabs.
  $('.profile-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = currentTabs().tab === 'info' ? 'tickets' : 'info';
    setTabs({ tab: next });
    $(`[data-tab="${next}"]`).focus();
  });

  await initAuth();
  window.addEventListener('auth:change', (e) => {
    if (getUser()) start();
    else if (e.detail.reason === 'logout') window.location.href = 'index.html'; // logged out from the header
  });

  if (getUser()) {
    start();
    return;
  }
  renderGate();
  // Guests get the login modal straight away.
  openAuthModal('login');
}

boot();
