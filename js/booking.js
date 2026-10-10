// Booking modal (Figma: assets/PurchaseTickets).
// Step 1 seats -> POST hold -> step 2 checkout -> POST order -> confirmation.
// The seat cap, hold length and ticket types all come from GET /filter-options.
import { api } from './api.js';
import { getUser, withAuth } from './auth.js';
import { icons } from './icons.js';
import { escapeHtml, formatPrice } from './utils.js';

const HOLD_KEY = (sessionId) => `kinoxii.hold.${sessionId}`;
const EXPIRED_MESSAGE = 'Your hold time expired. Please re-select your seats.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isTopModal = (el) => [...document.querySelectorAll('.modal')].pop() === el;
const roundMoney = (n) => Math.round(n * 100) / 100;
const price = (n) => formatPrice(n).replace(' ', '');

function formatLongDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatShortDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

// "2 x Adult, 1 x Child"
function ticketCounts(names) {
  const counts = new Map();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, n]) => `${n} x ${name}`).join(', ');
}

/* ---------- Checkout form fields ---------- */

const digits = (v) => v.replace(/\D/g, '');

function expiryError(value) {
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(value)) return 'Use the MM/YY format';
  const [mm, yy] = value.split('/').map(Number);
  const now = new Date();
  const year = now.getFullYear() % 100;
  if (yy < year || (yy === year && mm < now.getMonth() + 1)) return 'This card has expired';
  return '';
}

const CHECKOUT_FIELDS = {
  fullName: {
    label: 'Full name', placeholder: 'e.g. Jane Dolidze', autocomplete: 'name',
    validate: (v) => (v.trim().length >= 3 ? '' : 'Full name must be at least 3 characters'),
  },
  email: {
    label: 'Email', placeholder: 'e.g. jane@example.com', autocomplete: 'email', type: 'email',
    validate: (v) => (EMAIL_RE.test(v.trim()) ? '' : 'Enter a valid email address'),
  },
  mobileNumber: {
    label: 'Mobile number', placeholder: 'e.g. 555 123 456', autocomplete: 'tel-national', inputmode: 'tel',
    validate: (v) => {
      const d = digits(v);
      if (!d.startsWith('5')) return 'Georgian mobile numbers start with 5';
      return d.length === 9 ? '' : 'Enter 9 digits, e.g. 555 123 456';
    },
  },
  cardNumber: {
    label: 'Card number', placeholder: 'e.g. 1234 4567 8901 2345', autocomplete: 'cc-number', inputmode: 'numeric',
    format: (v) => digits(v).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 '),
    validate: (v) => (digits(v).length === 16 ? '' : 'Card number must be 16 digits'),
  },
  expiry: {
    label: 'Expiry', placeholder: 'e.g. 12/34', autocomplete: 'cc-exp', inputmode: 'numeric',
    format: (v) => {
      const d = digits(v).slice(0, 4);
      return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
    },
    validate: expiryError,
  },
  cvv: {
    label: 'CVV', placeholder: 'e.g. 123', autocomplete: 'cc-csc', inputmode: 'numeric',
    format: (v) => digits(v).slice(0, 3),
    validate: (v) => (/^\d{3}$/.test(v) ? '' : 'CVV must be 3 digits'),
  },
};

/* ==========================================================================
   openBooking(sessionId): requires a signed-in user (the login modal opens first).
   Resolves when the modal closes, with the order if one was paid.
   ========================================================================== */

let activeBooking = null;

export async function openBooking(sessionId) {
  if (activeBooking) return activeBooking;
  activeBooking = withAuth(() => runBooking(Number(sessionId)))
    .finally(() => { activeBooking = null; });
  return activeBooking;
}

async function runBooking(sessionId) {
  const user = getUser();
  let resolveClose;
  const closed = new Promise((r) => { resolveClose = r; });

  const state = {
    sessionId,
    session: null,
    options: null,
    map: null,
    seats: new Map(), // seatId -> { seat, section, rowLabel }
    selection: new Map(), // seatId -> ticketType slug, in pick order
    lost: new Set(), // seat ids lost to a 409, shown as sold until the map refreshes
    step: 1,
    hold: null,
    clockOffset: 0,
    timer: null,
    notice: null, // { type: 'error' | 'warning' | 'success', text }
    form: {},
    touched: new Set(),
    serverErrors: {},
    paying: false,
    holding: false,
    order: null,
  };

  /* ---------- Modal shell ---------- */

  const root = document.createElement('div');
  root.className = 'modal';
  root.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <section class="booking" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <button type="button" class="modal__close booking__close" data-close aria-label="Close">${icons.close}</button>
      <div class="booking__content"><div class="booking__loading skeleton"></div></div>
    </section>`;
  const previouslyFocused = document.activeElement;
  document.body.append(root);
  document.body.classList.add('has-modal');
  const content = root.querySelector('.booking__content');

  const onKeydown = (e) => {
    if (e.key === 'Escape' && isTopModal(root)) close();
  };
  document.addEventListener('keydown', onKeydown);

  function close() {
    stopTimer();
    // Closing without paying gives the seats straight back instead of blocking them for 8 minutes.
    if (state.hold && state.step !== 'done') {
      api.releaseHold(state.hold.holdId).catch(() => {});
      forgetHold();
    }
    root.remove();
    if (!document.querySelector('.modal')) document.body.classList.remove('has-modal');
    document.removeEventListener('keydown', onKeydown);
    previouslyFocused?.focus?.();
    resolveClose(state.order);
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });

  /* ---------- Load: session, options, map, and any hold to resume ---------- */

  // Retried in place on failure (server error, network); a 404 cannot be retried.
  for (;;) {
    try {
      [state.session, state.options] = await Promise.all([api.session(sessionId), api.filterOptions()]);
      break;
    } catch (err) {
      if (err.status === 404) {
        renderFatal('This session no longer exists.');
        return closed;
      }
      await renderFatal(err.message, { retry: true });
      content.innerHTML = '<div class="booking__loading skeleton"></div>';
    }
  }

  const movie = state.session.movie;
  const maxSeats = state.options.maxSeatsPerOrder;
  // Cheapest first, as in the design: Child 60%, Student 75%, Adult 100%.
  const ticketTypes = [...state.options.ticketTypes].sort((a, b) => a.priceRatio - b.priceRatio);
  const defaultType = state.options.ticketTypes.find((t) => t.slug === 'adult')?.slug ?? ticketTypes.at(-1).slug;
  const typeBySlug = (slug) => state.options.ticketTypes.find((t) => t.slug === slug);

  const ageBlocked = user.age !== null && user.age !== undefined && user.age < movie.ageRating.minAge;

  // "Child tickets are refused on 16+ and 18+ titles": the rule comes from blockedFromRatingAge.
  function ticketRuleError(slug) {
    const type = typeBySlug(slug);
    if (type?.blockedFromRatingAge !== null && type?.blockedFromRatingAge !== undefined
      && movie.ageRating.minAge >= type.blockedFromRatingAge) {
      return `${type.name} tickets are not available for ${movie.ageRating.code} films.`;
    }
    return '';
  }

  const seatPrice = (slug) => roundMoney(state.session.price * (typeBySlug(slug)?.priceRatio ?? 1));

  renderFrame();

  if (!user.profileComplete) {
    renderProfileGate();
    return closed;
  }

  await loadMap({ restoreMine: true });
  await resumeHold();
  return closed;

  /* ---------- Rendering ---------- */

  // Resolves when "Try again" is pressed (only offered with retry: true).
  function renderFatal(message, { retry = false } = {}) {
    content.innerHTML = `
      <div class="booking-state">
        <span class="search-state__icon">${icons.error}</span>
        <p class="search-state__title">${retry ? 'We couldn&#39;t load this session' : escapeHtml(message)}</p>
        ${retry ? `<p class="search-state__text">${escapeHtml(message)}</p>` : ''}
        <div class="confirmation__actions">
          ${retry ? '<button type="button" class="btn btn--primary btn--md" data-retry>Try again</button>' : ''}
          <button type="button" class="btn btn--transparent btn--md" data-close>Close</button>
        </div>
      </div>`;
    return new Promise((resolve) => {
      content.querySelector('[data-retry]')?.addEventListener('click', resolve, { once: true });
    });
  }

  function renderFrame() {
    const s = state.session;
    content.innerHTML = `
      <header class="booking__head">
        <div>
          <h2 class="booking__title" id="booking-title">${escapeHtml(movie.title)}</h2>
          <p class="booking__meta">${[
            s.venue.name, `Hall ${s.hall.name}`, formatLongDate(s.date), s.time, s.format.name, s.language.name,
          ].map(escapeHtml).join(' · ')}</p>
        </div>
        <div class="hold-timer" role="timer" aria-live="off" hidden>
          <span class="hold-timer__label">Seats held</span>
          <span class="hold-timer__value">--:--</span>
        </div>
      </header>
      <div class="booking__grid">
        <div class="booking__main">
          <ol class="steps" aria-label="Booking steps">
            <li><button type="button" class="steps__step" data-step="1">1. Seats</button></li>
            <li><button type="button" class="steps__step" data-step="2">2. Checkout</button></li>
          </ol>
          <div class="booking__notice" role="alert"></div>
          <div class="booking__stage"></div>
        </div>
        <aside class="booking__side"></aside>
      </div>`;

    content.querySelector('.steps').addEventListener('click', (e) => {
      const step = Number(e.target.closest('[data-step]')?.dataset.step);
      // Back to seats keeps the hold (the user still wants those seats); checkout needs a live hold.
      if (step === 1 && state.step === 2) goToStep(1);
      if (step === 2 && state.step === 1 && state.hold && sameAsHold()) goToStep(2);
    });
  }

  function renderSteps() {
    for (const button of content.querySelectorAll('.steps__step')) {
      const step = Number(button.dataset.step);
      button.classList.toggle('is-active', step === state.step);
      button.classList.toggle('is-done', step < state.step);
      button.setAttribute('aria-current', step === state.step ? 'step' : 'false');
    }
  }

  function renderNotice() {
    const box = content.querySelector('.booking__notice');
    if (!box) return;
    box.innerHTML = state.notice
      ? `<p class="notice notice--${state.notice.type}">${icons.error}<span>${escapeHtml(state.notice.text)}</span></p>`
      : '';
  }

  function setNotice(type, text) {
    state.notice = text ? { type, text } : null;
    renderNotice();
  }

  function renderProfileGate() {
    content.querySelector('.booking__grid').innerHTML = `
      <div class="booking-state">
        <span class="search-state__icon">${icons.user}</span>
        <p class="search-state__title">Complete your profile to book tickets</p>
        <p class="search-state__text">Booking needs your full name, mobile number and date of birth.</p>
        <a class="btn btn--primary btn--md" href="profile.html">Complete profile</a>
      </div>`;
  }

  /* ---------- Step 1: seat map ---------- */

  async function loadMap({ restoreMine = false } = {}) {
    const stage = content.querySelector('.booking__stage');
    if (state.step === 1 && !state.map) stage.innerHTML = '<div class="seat-map skeleton seat-map--loading"></div>';
    try {
      state.map = await api.seats(state.sessionId);
    } catch (err) {
      if (state.step === 1) {
        stage.innerHTML = `
          <div class="section-error">
            <span>${escapeHtml(err.message)}</span>
            <button type="button" class="btn btn--transparent btn--sm" data-retry-map>Try again</button>
          </div>`;
        stage.querySelector('[data-retry-map]').addEventListener('click', () => loadMap());
      }
      return;
    }

    state.seats.clear();
    for (const section of state.map.sections) {
      for (const row of section.rows) {
        for (const seat of row.seats) state.seats.set(seat.id, { seat, section: section.name, rowLabel: row.label });
      }
    }
    state.lost.clear();

    // Keep only seats that are still free (or already ours).
    for (const id of [...state.selection.keys()]) {
      const entry = state.seats.get(id);
      if (!entry || !(entry.seat.state === 'available' || entry.seat.isMine)) state.selection.delete(id);
    }
    // A returning user's own live hold shows as their selection.
    if (restoreMine) {
      for (const { seat } of state.seats.values()) {
        if (seat.isMine && !state.selection.has(seat.id) && state.selection.size < maxSeats) {
          state.selection.set(seat.id, defaultType);
        }
      }
    }
    if (state.step === 1) renderStep1();
  }

  function seatMarkup(seat) {
    if (seat.state === 'unavailable') return '<span class="seat-gap" aria-hidden="true"></span>';
    const status = seatStatus(seat);
    const labels = { available: 'available', selected: 'selected', sold: 'sold', held: 'held by another user' };
    return `<button type="button" class="seat seat--${status}" data-seat="${seat.id}"
      ${status === 'sold' || status === 'held' ? 'disabled' : ''} aria-pressed="${status === 'selected'}"
      aria-label="Seat ${escapeHtml(seat.code)}, ${labels[status]}">${escapeHtml(seat.label)}</button>`;
  }

  function seatStatus(seat) {
    if (state.selection.has(seat.id)) return 'selected';
    if (state.lost.has(seat.id) || seat.state === 'sold') return 'sold';
    if (seat.state === 'held' && !seat.isMine) return 'held';
    return 'available';
  }

  function renderStep1() {
    state.step = 1;
    renderSteps();
    renderNotice();
    const stage = content.querySelector('.booking__stage');

    // Seat size follows the widest row, so every hall fits the panel without scrolling sideways.
    const widest = Math.max(...state.map.sections.flatMap((s) => s.rows.map((r) => (
      r.seats.length + r.seats.filter((seat) => seat.aisleAfter).length * 0.45
    ))));

    stage.innerHTML = `
      <div class="seat-map" style="--cols: ${widest}">
        <div class="seat-map__screen">Screen</div>
        ${state.map.sections.map((section) => {
          const labels = section.rows.map((r) => r.label);
          const range = labels.length > 1 ? `Rows ${labels[0]}–${labels.at(-1)}` : `Row ${labels[0]}`;
          return `
            <section class="seat-section">
              <h3 class="seat-section__title">${escapeHtml(section.name)} · ${escapeHtml(range)}</h3>
              <div class="seat-section__rows">
                ${section.rows.map((row) => `
                  <div class="seat-row">
                    <span class="seat-row__label">${escapeHtml(row.label)}</span>
                    ${row.seats.map((seat) => `${seatMarkup(seat)}${seat.aisleAfter ? '<span class="seat-aisle" aria-hidden="true"></span>' : ''}`).join('')}
                  </div>`).join('')}
              </div>
            </section>`;
        }).join('')}
        <ul class="seat-legend" aria-label="Legend">
          <li><span class="seat-legend__swatch seat--available"></span>Available</li>
          <li><span class="seat-legend__swatch seat--selected"></span>Selected</li>
          <li><span class="seat-legend__swatch seat--sold"></span>Sold</li>
          <li><span class="seat-legend__swatch seat--held"></span>Held by another user</li>
        </ul>
      </div>`;

    stage.querySelector('.seat-map').addEventListener('click', (e) => {
      const button = e.target.closest('[data-seat]');
      if (button && !button.disabled) toggleSeat(Number(button.dataset.seat));
    });
    renderSelection();
  }

  function refreshSeatButtons() {
    for (const button of content.querySelectorAll('[data-seat]')) {
      const { seat } = state.seats.get(Number(button.dataset.seat));
      const status = seatStatus(seat);
      button.className = `seat seat--${status}`;
      button.disabled = status === 'sold' || status === 'held';
      button.setAttribute('aria-pressed', String(status === 'selected'));
    }
  }

  function toggleSeat(id) {
    if (state.selection.has(id)) {
      state.selection.delete(id);
      setNotice();
    } else if (state.selection.size >= maxSeats) {
      setNotice('warning', `You can select up to ${maxSeats} seats per order.`);
      return;
    } else {
      state.selection.set(id, defaultType);
      setNotice();
    }
    refreshSeatButtons();
    renderSelection();
  }

  // Right panel on step 1: one card per seat with its ticket type, then the subtotal.
  function renderSelection() {
    const side = content.querySelector('.booking__side');
    const picked = [...state.selection];
    const errors = picked.map(([, slug]) => ticketRuleError(slug));
    const subtotal = roundMoney(picked.reduce((sum, [, slug]) => sum + seatPrice(slug), 0));
    const blockedReason = ageBlocked
      ? `This film is rated ${movie.ageRating.code}. You cannot buy tickets for it with this account.`
      : errors.some(Boolean) ? 'Fix the highlighted seats to continue.' : '';
    const canContinue = picked.length > 0 && !blockedReason && !state.holding;

    side.innerHTML = `
      <h3 class="booking__side-title">Your seats · Max ${maxSeats}</h3>
      ${picked.length ? `
        <ul class="picked">
          ${picked.map(([id, slug], i) => {
            const { seat, section } = state.seats.get(id);
            return `
              <li class="picked__seat ${errors[i] ? 'is-invalid' : ''}">
                <div class="picked__head">
                  <span class="picked__code"><span>Seat</span> ${escapeHtml(seat.code)}</span>
                  <span class="picked__section">${escapeHtml(section)}</span>
                  <span class="picked__price">${price(seatPrice(slug))}</span>
                  <button type="button" class="picked__remove" data-remove="${id}" aria-label="Remove seat ${escapeHtml(seat.code)}">${icons.close}</button>
                </div>
                <div class="picked__types" role="radiogroup" aria-label="Ticket type for ${escapeHtml(seat.code)}">
                  ${ticketTypes.map((t) => `
                    <button type="button" class="type-pill ${t.slug === slug ? 'is-active' : ''}" role="radio"
                      aria-checked="${t.slug === slug}" data-seat-type="${id}" data-type="${t.slug}"
                      ${t.note ? `title="${escapeHtml(t.note)}"` : ''}>${escapeHtml(t.name)} ${Math.round(t.priceRatio * 100)}%</button>`).join('')}
                </div>
                ${errors[i] ? `<p class="picked__error">${icons.error}${escapeHtml(errors[i])}</p>` : ''}
              </li>`;
          }).join('')}
        </ul>` : `<p class="booking__hint">Pick up to ${maxSeats} seats from the map. Each seat can carry its own ticket type.</p>`}
      <div class="booking__total">
        <span>Subtotal</span>
        <strong aria-live="polite">${price(subtotal)}</strong>
      </div>
      ${blockedReason ? `<p class="booking__blocked">${escapeHtml(blockedReason)}</p>` : ''}
      <button type="button" class="btn btn--primary btn--lg btn--block" data-next ${canContinue ? '' : 'disabled'}>
        ${state.holding ? '<span class="spinner" aria-hidden="true"></span> Holding seats…' : 'Next: Checkout'}
      </button>`;

    side.querySelector('.picked')?.addEventListener('click', (e) => {
      const remove = e.target.closest('[data-remove]');
      if (remove) toggleSeat(Number(remove.dataset.remove));
      const type = e.target.closest('[data-type]');
      if (type) {
        state.selection.set(Number(type.dataset.seatType), type.dataset.type);
        renderSelection();
      }
    });
    side.querySelector('[data-next]').addEventListener('click', holdSeats);
  }

  /* ---------- Step 1 -> 2: POST /sessions/{id}/holds ---------- */

  // Whether the live hold still matches the current selection (so it can be reused).
  function sameAsHold() {
    if (!state.hold || state.hold.seats.length !== state.selection.size) return false;
    return state.hold.seats.every((s) => state.selection.get(s.seatId) === s.ticketType.slug);
  }

  async function holdSeats() {
    if (state.holding || !state.selection.size) return;
    if (sameAsHold()) {
      goToStep(2);
      return;
    }
    state.holding = true;
    setNotice();
    renderSelection();
    const seats = [...state.selection].map(([seatId, ticketType]) => ({ seatId, ticketType }));

    try {
      // A new hold replaces the user's previous one for this session.
      const hold = await withAuth(() => api.holdSeats(state.sessionId, seats));
      if (!hold) return; // login closed
      startHold(hold);
      goToStep(2);
    } catch (err) {
      if (err.status === 409) {
        handleContested(err.body?.contested ?? []);
      } else if (err.errors) {
        setNotice('error', Object.values(err.errors).flat()[0] ?? err.message);
      } else {
        // 422 without `errors` is a booking rule (profile, age, session started): show it as written.
        setNotice('error', err.message);
      }
    } finally {
      state.holding = false;
      if (state.step === 1) renderSelection();
    }
  }

  // 409: someone else got some of the seats first. Name them, mark them sold,
  // keep the rest of the selection and refetch the map.
  function handleContested(codes) {
    const lostIds = [...state.seats.values()].filter(({ seat }) => codes.includes(seat.code)).map(({ seat }) => seat.id);
    lostIds.forEach((id) => {
      state.selection.delete(id);
      state.lost.add(id);
    });
    const list = codes.join(', ');
    setNotice('error', codes.length
      ? `${codes.length === 1 ? `Seat ${list} was` : `Seats ${list} were`} just taken by someone else. ${state.selection.size ? 'We kept the rest of your selection.' : 'Please pick other seats.'}`
      : 'Some of those seats were just taken. Please check your selection.');
    if (state.step !== 1) goToStep(1);
    else {
      refreshSeatButtons();
      renderSelection();
    }
    loadMap();
  }

  /* ---------- Hold timer ---------- */

  function startHold(hold) {
    state.hold = hold;
    // Tick against expiresAt; the offset corrects for a client clock that differs from the server's.
    state.clockOffset = Date.parse(hold.expiresAt) - (Date.now() + hold.secondsRemaining * 1000);
    try { sessionStorage.setItem(HOLD_KEY(state.sessionId), hold.holdId); } catch { /* ignore */ }
    stopTimer();
    tick();
    state.timer = setInterval(tick, 250);
  }

  function forgetHold() {
    try { sessionStorage.removeItem(HOLD_KEY(state.sessionId)); } catch { /* ignore */ }
  }

  function stopTimer() {
    clearInterval(state.timer);
    state.timer = null;
  }

  function tick() {
    const badge = content.querySelector('.hold-timer');
    if (!state.hold || !badge) return;
    const remaining = Math.max(0, Date.parse(state.hold.expiresAt) - state.clockOffset - Date.now());
    const seconds = Math.ceil(remaining / 1000);
    badge.hidden = false;
    badge.querySelector('.hold-timer__value').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    badge.classList.toggle('is-urgent', seconds <= 60);
    if (remaining <= 0) expireHold();
  }

  // At zero: release, clear the selection, back to step 1, reload the map, explain.
  function expireHold() {
    stopTimer();
    state.hold = null;
    forgetHold();
    state.selection.clear();
    content.querySelector('.hold-timer').hidden = true;
    setNotice('warning', EXPIRED_MESSAGE);
    goToStep(1);
    loadMap();
  }

  // After a reload mid-checkout: GET /holds/{id} and carry on if it is still live.
  async function resumeHold() {
    let holdId = null;
    try { holdId = sessionStorage.getItem(HOLD_KEY(state.sessionId)); } catch { /* ignore */ }
    if (!holdId) return;
    try {
      const hold = await api.getHold(holdId);
      if (!hold.isLive) {
        forgetHold();
        return;
      }
      state.selection.clear();
      hold.seats.forEach((s) => state.selection.set(s.seatId, s.ticketType.slug));
      startHold(hold);
      goToStep(2);
    } catch {
      forgetHold();
    }
  }

  /* ---------- Step 2: checkout ---------- */

  function goToStep(step) {
    if (step === 1) {
      if (state.map) renderStep1();
      return;
    }
    state.step = 2;
    renderSteps();
    renderNotice();
    renderCheckout();
  }

  function checkoutValues() {
    return Object.fromEntries(Object.keys(CHECKOUT_FIELDS).map((name) => [name, state.form[name] ?? '']));
  }

  function renderCheckout() {
    // Buyer details are prefilled from the profile the first time.
    if (!Object.keys(state.form).length) {
      state.form = {
        fullName: user.fullName ?? '',
        email: user.email ?? '',
        mobileNumber: user.mobileNumber ? user.mobileNumber.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') : '',
      };
      for (const name of ['fullName', 'email', 'mobileNumber']) if (state.form[name]) state.touched.add(name);
    }

    const field = (name, extraClass = '') => {
      const f = CHECKOUT_FIELDS[name];
      return `
        <div class="field ${extraClass}" data-field="${name}">
          <label class="field__label" for="checkout-${name}">${f.label}</label>
          <div class="field__control">
            <input class="field__input" id="checkout-${name}" name="${name}" type="${f.type ?? 'text'}"
              placeholder="${f.placeholder}" autocomplete="${f.autocomplete}" ${f.inputmode ? `inputmode="${f.inputmode}"` : ''}
              value="${escapeHtml(state.form[name] ?? '')}" aria-describedby="checkout-${name}-error">
            <span class="field__status field__status--valid">${icons.check}</span>
            <span class="field__status field__status--invalid">${icons.error}</span>
          </div>
          <p class="field__error" id="checkout-${name}-error"></p>
        </div>`;
    };

    const stage = content.querySelector('.booking__stage');
    stage.innerHTML = `
      <form class="checkout" novalidate>
        <fieldset class="checkout__group">
          <legend class="visually-hidden">Buyer details</legend>
          ${field('fullName')}
          <div class="checkout__row">${field('email')}${field('mobileNumber')}</div>
        </fieldset>
        <fieldset class="checkout__group checkout__group--card">
          <legend class="visually-hidden">Card details</legend>
          ${field('cardNumber')}
          <div class="checkout__row">${field('expiry')}${field('cvv')}</div>
        </fieldset>
      </form>`;

    const form = stage.querySelector('form');
    form.addEventListener('input', (e) => {
      const name = e.target.name;
      const f = CHECKOUT_FIELDS[name];
      if (!f) return;
      if (f.format) {
        const formatted = f.format(e.target.value);
        if (formatted !== e.target.value) e.target.value = formatted;
      }
      state.form[name] = e.target.value;
      delete state.serverErrors[name];
      refreshCheckout();
    });
    form.addEventListener('focusout', (e) => {
      if (CHECKOUT_FIELDS[e.target.name] && e.target.value) {
        state.touched.add(e.target.name);
        refreshCheckout();
      }
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      pay();
    });

    renderCheckoutSummary();
    refreshCheckout();
  }

  function renderCheckoutSummary() {
    const hold = state.hold;
    const s = state.session;
    const side = content.querySelector('.booking__side');
    side.innerHTML = `
      <h3 class="booking__side-title">Summary</h3>
      <div class="summary-card">
        <p class="summary-card__title">${escapeHtml(movie.title)}</p>
        <p class="summary-card__meta">${escapeHtml(s.venue.name)} · Hall ${escapeHtml(s.hall.name)} · ${formatShortDate(s.date)} · ${escapeHtml(s.time)}</p>
        <dl class="summary-card__facts">
          <div><dt>Seats</dt><dd>${hold.seats.map((seat) => escapeHtml(seat.code)).join(', ')}</dd></div>
          <div><dt>Tickets</dt><dd>${escapeHtml(ticketCounts(hold.seats.map((seat) => seat.ticketType.name)))}</dd></div>
        </dl>
      </div>
      <div class="booking__total">
        <span>Subtotal</span>
        <strong>${price(hold.subtotal)}</strong>
      </div>
      <button type="button" class="btn btn--primary btn--lg btn--block" data-pay disabled>Pay &amp; complete order</button>`;
    side.querySelector('[data-pay]').addEventListener('click', pay);
  }

  function refreshCheckout() {
    const v = checkoutValues();
    let allValid = true;
    for (const [name, f] of Object.entries(CHECKOUT_FIELDS)) {
      const el = content.querySelector(`[data-field="${name}"]`);
      if (!el) continue;
      const clientError = f.validate(v[name]);
      if (clientError) allValid = false;
      const error = state.serverErrors[name] || (state.touched.has(name) ? clientError : '');
      el.classList.toggle('is-invalid', Boolean(error));
      el.classList.toggle('is-valid', !error && !clientError);
      el.querySelector('.field__error').textContent = error;
      el.querySelector('input').setAttribute('aria-invalid', String(Boolean(error)));
    }
    const button = content.querySelector('[data-pay]');
    if (button) {
      button.disabled = !allValid || state.paying;
      button.innerHTML = state.paying ? '<span class="spinner" aria-hidden="true"></span> Processing…' : 'Pay &amp; complete order';
    }
    return allValid;
  }

  /* ---------- Step 2 -> done: POST /orders ---------- */

  async function pay() {
    // Guarded twice: the flag stops a double click even before the button repaints as disabled.
    if (state.paying) return;
    Object.keys(CHECKOUT_FIELDS).forEach((name) => state.touched.add(name));
    if (!refreshCheckout()) return;

    state.paying = true;
    refreshCheckout();
    setNotice();
    const v = checkoutValues();

    try {
      const order = await withAuth(() => api.createOrder({
        holdId: state.hold.holdId,
        fullName: v.fullName.trim(),
        email: v.email.trim(),
        mobileNumber: digits(v.mobileNumber),
        cardNumber: digits(v.cardNumber),
        expiry: v.expiry,
        cvv: v.cvv,
      }));
      if (!order) return;
      state.order = order;
      state.step = 'done';
      stopTimer();
      forgetHold();
      renderConfirmation(order);
    } catch (err) {
      if (err.status === 422 && err.errors) {
        // Field errors go next to their inputs, worded exactly as the API sent them.
        state.serverErrors = Object.fromEntries(Object.entries(err.errors).map(([k, m]) => [k, m[0]]));
        const unknown = Object.keys(state.serverErrors).filter((k) => !CHECKOUT_FIELDS[k]);
        if (unknown.length) setNotice('error', state.serverErrors[unknown[0]]);
      } else if (err.status === 422) {
        // Only `message`: the hold ran out on the server.
        expireHold();
        setNotice('warning', err.message || EXPIRED_MESSAGE);
      } else if (err.status === 409) {
        state.hold = null;
        stopTimer();
        forgetHold();
        content.querySelector('.hold-timer').hidden = true;
        handleContested(err.body?.contested ?? []);
      } else {
        setNotice('error', err.message);
      }
    } finally {
      state.paying = false;
      if (state.step === 2) refreshCheckout();
    }
  }

  /* ---------- Confirmation (rendered from the order the API returned) ---------- */

  function renderConfirmation(order) {
    const s = order.session;
    const film = s.movie ?? movie;
    content.innerHTML = `
      <div class="confirmation">
        <span class="confirmation__icon">${icons.check}</span>
        <h2 class="confirmation__title" id="booking-title">Booking confirmed!</h2>
        <p class="confirmation__text">Your tickets are ready. We've sent the confirmation to ${escapeHtml(order.contact?.email ?? 'your email')}.</p>
        <p class="confirmation__ref">Order #${escapeHtml(order.reference)}</p>
        <div class="confirmation__card">
          <div class="confirmation__film">
            ${film.posterUrl ? `<img src="${escapeHtml(film.posterUrl)}" alt="">` : ''}
            <div>
              <p class="summary-card__title">${escapeHtml(film.title)}</p>
              <p class="summary-card__meta">${escapeHtml(s.venue.name)} · Hall ${escapeHtml(s.hall.name)} · ${formatShortDate(s.date)} · ${escapeHtml(s.time)}</p>
            </div>
          </div>
          <dl class="confirmation__facts">
            <div><dt>Seats</dt><dd>${order.tickets.map((t) => escapeHtml(t.seatCode)).join(', ')}</dd></div>
            <div><dt>Tickets</dt><dd>${escapeHtml(ticketCounts(order.tickets.map((t) => t.ticketType.name)))}</dd></div>
          </dl>
          <div class="confirmation__total"><span>Total paid</span><strong>${price(order.totalPrice)}</strong></div>
        </div>
        <div class="confirmation__actions">
          <a class="btn btn--primary btn--lg" href="profile.html?tab=tickets">View my tickets</a>
          <a class="btn btn--transparent btn--lg" href="index.html">Back to home</a>
        </div>
      </div>`;
    content.querySelector('.confirmation__title').focus?.();
  }
}
