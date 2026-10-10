// Log in / Sign up modal (Figma: assets/Authorization). One dialog, two modes,
// switched with the link at the bottom. Resolves with the user on success, or null if closed.
import { login, register } from './auth.js';
import { icons } from './icons.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const required = (validate) => (value, values) => (value ? validate(value, values) : 'This field is required');
const minLength = (n, label) => (value) => (value.length >= n ? '' : `${label} must be at least ${n} characters`);

const FIELDS = {
  username: { label: 'Username', type: 'text', placeholder: 'User', autocomplete: 'username', validate: required(minLength(3, 'Username')) },
  email: { label: 'Email', type: 'email', placeholder: 'example@gmail.com', autocomplete: 'email', validate: required((v) => (EMAIL_RE.test(v) ? '' : 'Enter a valid email address')) },
  password: { label: 'Password', type: 'password', placeholder: '••••••••', autocomplete: 'current-password', validate: required(minLength(3, 'Password')) },
  password_confirmation: { label: 'Confirm password', type: 'password', placeholder: '••••••••', autocomplete: 'new-password', validate: required((v, values) => (v === values.password ? '' : 'Passwords do not match')) },
};

const MODES = {
  login: {
    title: 'Log in',
    subtitle: 'Welcome back to Kino XII',
    submit: 'Log in',
    fields: ['email', 'password'],
    switchText: "Don't have an account?",
    switchLabel: 'Sign up',
    switchTo: 'signup',
  },
  signup: {
    title: 'Sign up',
    subtitle: 'Welcome to Kino XII',
    submit: 'Sign up',
    fields: ['username', 'email', 'password', 'password_confirmation'],
    switchText: 'Already have an account?',
    switchLabel: 'Log in',
    switchTo: 'login',
  },
};

let active = null;

// Escape only closes the modal on top (the login form can open over the booking modal).
const isTopModal = (el) => [...document.querySelectorAll('.modal')].pop() === el;

export function openAuthModal(mode = 'login') {
  if (active) {
    active.setMode(mode);
    return active.promise;
  }

  let resolve;
  const promise = new Promise((r) => { resolve = r; });

  const root = document.createElement('div');
  root.className = 'modal';
  root.innerHTML = `
    <div class="modal__backdrop" data-close></div>
    <form class="modal__dialog auth" role="dialog" aria-modal="true" aria-labelledby="auth-title" novalidate></form>
  `;
  const form = root.querySelector('form');
  const previouslyFocused = document.activeElement;
  document.body.append(root);
  document.body.classList.add('has-modal');

  let state;

  function setMode(next) {
    if (state?.mode === next) return;
    if (state?.avatarUrl) URL.revokeObjectURL(state.avatarUrl);
    state = { mode: next, touched: new Set(), serverErrors: {}, submitted: false, avatar: null, avatarUrl: null, avatarError: '' };
    render();
    form.querySelector('input:not([type="file"])')?.focus();
  }

  function fieldMarkup(name) {
    const f = FIELDS[name];
    const autocomplete = state.mode === 'signup' && name === 'password' ? 'new-password' : f.autocomplete;
    return `
      <div class="field" data-field="${name}">
        <label class="field__label" for="auth-${name}">${f.label}</label>
        <div class="field__control">
          <input class="field__input" id="auth-${name}" name="${name}" type="${f.type}"
            placeholder="${f.placeholder}" autocomplete="${autocomplete}" aria-describedby="auth-${name}-error">
          <span class="field__status field__status--valid">${icons.check}</span>
          <span class="field__status field__status--invalid">${icons.error}</span>
        </div>
        <p class="field__error" id="auth-${name}-error"></p>
      </div>`;
  }

  function render() {
    const m = MODES[state.mode];
    const fields = state.mode === 'signup'
      ? `${fieldMarkup('username')}${fieldMarkup('email')}
         <div class="auth__row">${fieldMarkup('password')}${fieldMarkup('password_confirmation')}</div>`
      : m.fields.map(fieldMarkup).join('');

    form.className = `modal__dialog auth auth--${state.mode}`;
    form.innerHTML = `
      <button type="button" class="modal__close" data-close aria-label="Close">${icons.close}</button>
      <header class="auth__head">
        <h2 class="auth__title" id="auth-title">${m.title}</h2>
        <p class="auth__subtitle">${m.subtitle}</p>
      </header>
      ${state.mode === 'signup' ? `
        <div class="avatar-upload">
          <label class="avatar-upload__picker" aria-label="Upload avatar">
            <input type="file" name="avatar" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" hidden>
            <span class="avatar-upload__preview">${icons.upload}</span>
          </label>
          <div>
            <div class="avatar-upload__title">Upload avatar (optional)</div>
            <div class="avatar-upload__hint">JPG, PNG or WEBP</div>
            <p class="field__error avatar-upload__error"></p>
          </div>
        </div>` : ''}
      <div class="auth__fields">${fields}</div>
      <p class="auth__form-error" role="alert" hidden>${icons.error}<span class="auth__form-error-text"></span></p>
      <button type="submit" class="btn btn--primary btn--lg btn--block" disabled>${m.submit}</button>
      <p class="auth__switch">${m.switchText} <button type="button" class="auth__switch-link" data-switch="${m.switchTo}">${m.switchLabel}</button></p>
    `;
    refresh();
  }

  const values = () => Object.fromEntries(
    MODES[state.mode].fields.map((name) => [name, form.elements[name].value.trim()]),
  );

  // Re-evaluates every field: green check when valid, red state once touched/submitted or rejected by the API.
  function refresh() {
    const v = values();
    let allValid = !state.avatarError;
    for (const name of MODES[state.mode].fields) {
      const el = form.querySelector(`[data-field="${name}"]`);
      const clientError = FIELDS[name].validate(v[name], v);
      const error = state.serverErrors[name] || ((state.touched.has(name) || state.submitted) ? clientError : '');
      if (clientError) allValid = false;
      el.classList.toggle('is-invalid', Boolean(error));
      el.classList.toggle('is-valid', !error && !clientError && Boolean(v[name]));
      el.querySelector('.field__error').textContent = error;
      form.elements[name].setAttribute('aria-invalid', String(Boolean(error)));
    }
    const avatarError = form.querySelector('.avatar-upload__error');
    if (avatarError) avatarError.textContent = state.avatarError;
    form.querySelector('[type="submit"]').disabled = !allValid || state.pending;
  }

  function showFormError(message) {
    const box = form.querySelector('.auth__form-error');
    box.querySelector('.auth__form-error-text').textContent = message;
    box.hidden = !message;
  }

  function close(user = null) {
    if (state.avatarUrl) URL.revokeObjectURL(state.avatarUrl);
    root.remove();
    if (!document.querySelector('.modal')) document.body.classList.remove('has-modal');
    document.removeEventListener('keydown', onKeydown);
    active = null;
    previouslyFocused?.focus?.();
    resolve(user);
  }

  function onKeydown(e) {
    if (e.key === 'Escape' && isTopModal(root)) close();
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
    const switcher = e.target.closest('[data-switch]');
    if (switcher) setMode(switcher.dataset.switch);
  });
  document.addEventListener('keydown', onKeydown);

  form.addEventListener('input', (e) => {
    const name = e.target.name;
    if (name === 'avatar') return;
    delete state.serverErrors[name];
    if (name === 'password') delete state.serverErrors.password_confirmation;
    showFormError('');
    refresh();
  });

  form.addEventListener('focusout', (e) => {
    const name = e.target.name;
    if (name && name !== 'avatar' && e.target.value) {
      state.touched.add(name);
      refresh();
    }
  });

  form.addEventListener('change', (e) => {
    if (e.target.name !== 'avatar') return;
    const file = e.target.files[0] ?? null;
    if (state.avatarUrl) URL.revokeObjectURL(state.avatarUrl);
    state.avatar = null;
    state.avatarUrl = null;
    state.avatarError = '';
    delete state.serverErrors.avatar;
    if (file && !AVATAR_TYPES.includes(file.type)) state.avatarError = 'Avatar must be a JPG, PNG or WEBP image';
    else if (file && file.size > AVATAR_MAX_BYTES) state.avatarError = 'Avatar must be 2MB or smaller';
    else if (file) {
      state.avatar = file;
      state.avatarUrl = URL.createObjectURL(file);
    }
    form.querySelector('.avatar-upload__preview').innerHTML = state.avatarUrl
      ? `<img src="${state.avatarUrl}" alt="">`
      : icons.upload;
    refresh();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    state.submitted = true;
    refresh();
    if (form.querySelector('[type="submit"]').disabled) return;

    state.pending = true;
    refresh();
    showFormError('');
    const v = values();

    try {
      let user;
      if (state.mode === 'login') {
        user = await login(v.email, form.elements.password.value);
      } else {
        const data = new FormData();
        data.append('username', v.username);
        data.append('email', v.email);
        data.append('password', form.elements.password.value);
        data.append('password_confirmation', form.elements.password_confirmation.value);
        if (state.avatar) data.append('avatar', state.avatar);
        user = await register(data);
      }
      close(user);
    } catch (err) {
      state.pending = false;
      if (err.errors) {
        // 422 with `errors`: put each message under its input, exactly as the API wrote it.
        for (const [name, messages] of Object.entries(err.errors)) {
          if (name === 'avatar') state.avatarError = messages[0];
          else state.serverErrors[name] = messages[0];
        }
      } else {
        // 401 on login = wrong credentials: keep the modal open and the email filled in.
        showFormError(err.message);
        if (state.mode === 'login') {
          // The password is cleared for a retry; do not flag the now-empty field as an error.
          form.elements.password.value = '';
          state.touched.delete('password');
          state.submitted = false;
          form.elements.password.focus();
        }
      }
      refresh();
    }
  });

  setMode(mode);
  active = { promise, setMode };
  return promise;
}

