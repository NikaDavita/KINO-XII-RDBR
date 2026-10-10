import { api, tokenStore } from './api.js';
import { openAuthModal } from './auth-modal.js';

let currentUser = null;

export const getUser = () => currentUser;
export const isLoggedIn = () => currentUser !== null;

// `reason` lets pages tell a deliberate logout apart from an expired session (where the
// login modal is about to open and the interrupted action will be replayed).
function setUser(user, reason = 'update') {
  currentUser = user;
  window.dispatchEvent(new CustomEvent('auth:change', { detail: { user, reason } }));
}

// On boot: restore the session from a stored token. A 401 means it is stale.
export async function initAuth() {
  if (!tokenStore.get()) {
    setUser(null);
    return;
  }
  try {
    setUser(await api.me());
  } catch (err) {
    if (err.status === 401) tokenStore.clear();
    setUser(null);
  }
}

// After the profile is saved, the API returns the fresh user; the header redraws from this.
export const updateUser = (user) => setUser(user);

export async function login(email, password) {
  const { user, token } = await api.login(email, password);
  tokenStore.set(token);
  setUser(user);
  return user;
}

// Registration signs the user in straight away (token in the same response).
export async function register(formData) {
  const { user, token } = await api.register(formData);
  tokenStore.set(token);
  setUser(user);
  return user;
}

export async function logout() {
  try {
    await api.logout();
  } catch {
    // Clear locally regardless of the response, as the spec says.
  } finally {
    tokenStore.clear();
    setUser(null, 'logout');
  }
}

// Runs a protected action. Without a session (or on a 401) it opens the login
// modal and replays the action after a successful login, so the user never clicks twice.
// Resolves to undefined if the user closes the modal instead.
export async function withAuth(action) {
  if (!isLoggedIn()) {
    const user = await openAuthModal('login');
    return user ? action() : undefined;
  }
  try {
    return await action();
  } catch (err) {
    if (err.status !== 401) throw err;
    tokenStore.clear();
    setUser(null, 'expired');
    const user = await openAuthModal('login');
    return user ? action() : undefined;
  }
}
