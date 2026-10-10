// Icons from the Figma exports (assets/icons) are drawn as CSS masks,
// so they take the text colour like an icon font. Each one is declared in css/styles.css.
const asset = (name) => `<span class="icon icon-asset icon--${name}" aria-hidden="true"></span>`;

const svg = (body) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  ticket: asset('ticket'),
  timer: asset('timer'),
  bell: asset('bell'),
  check: asset('check'),

  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
};
