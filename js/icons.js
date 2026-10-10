// Icons from the Figma exports (assets/icons) are drawn as CSS masks,
// so they take the text colour like an icon font. Each one is declared in css/styles.css.
// Icons Figma does not provide stay inline SVG.
const asset = (name) => `<span class="icon icon-asset icon--${name}" aria-hidden="true"></span>`;

const svg = (body) =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  ticket: asset('ticket'),
  timer: asset('timer'),
  bell: asset('bell'),
  check: asset('check'),
  chevronDown: asset('arrow'),
  close: asset('close'),
  error: asset('error'),
  logout: asset('logout'),
  user: asset('user'),

  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  upload: svg('<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>'),
};
