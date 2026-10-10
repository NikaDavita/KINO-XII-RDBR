export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const formatRuntime = (minutes) => `${minutes} min`;

export const primaryGenre = (movie) => movie.genres?.[0]?.name ?? '';

export const formatPrice = (amount) =>
  `₾ ${Number(amount).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

// "2026-10-02" -> "2 October" (parsed as a local date, not UTC midnight)
export function formatDayMonth(isoDate, month = 'long') {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month });
}

export const movieUrl = (slug) => `movie.html?slug=${encodeURIComponent(slug)}`;

export function initials(name) {
  return String(name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

// Lets mouse users drag horizontal card rows; a drag does not count as a click.
// The window listeners are shared and added once, so rows can be re-rendered freely.
let drag = null; // { track, startX, startScroll, moved }

function onDragMove(e) {
  if (!drag) return;
  const dx = e.clientX - drag.startX;
  if (Math.abs(dx) > 5 && !drag.moved) {
    drag.moved = true;
    drag.track.classList.add('is-dragging');
  }
  if (drag.moved) drag.track.scrollLeft = drag.startScroll - dx;
}

function onDragEnd() {
  if (!drag) return;
  drag.track.classList.remove('is-dragging');
  // Keep `moved` on the track until the click that follows this pointerup has been swallowed.
  drag.track.dataset.dragged = drag.moved ? '1' : '';
  drag = null;
}

let dragListenersAdded = false;

export function enableDragScroll(track) {
  if (!dragListenersAdded) {
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    dragListenersAdded = true;
  }

  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { track, startX: e.clientX, startScroll: track.scrollLeft, moved: false };
  });

  track.addEventListener('click', (e) => {
    if (track.dataset.dragged) {
      e.preventDefault();
      e.stopPropagation();
      track.dataset.dragged = '';
    }
  }, true);

  track.addEventListener('dragstart', (e) => e.preventDefault());
}

let toastTimer;
export function showToast(message, type = 'error') {
  let toast = $('#toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 4000);
}
