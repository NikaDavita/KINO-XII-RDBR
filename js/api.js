// Thin wrapper around the Kino XII REST API.
// Spec: https://api.kinoxii.redberryinternship.ge/docs

const BASE_URL = 'https://api.kinoxii.redberryinternship.ge/api';
const TOKEN_KEY = 'kinoxii.token';

export const tokenStore = {
  get() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage blocked */ }
  },
  clear() {
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  },
};

export const SERVER_ERROR_MESSAGE = 'Something went wrong on our side. Please try again.';

export class ApiError extends Error {
  constructor(status, body) {
    // 5xx: one generic message (the server's own text is not written for users). 4xx messages are.
    super(status >= 500 ? SERVER_ERROR_MESSAGE : (body?.message || `Request failed (${status})`));
    this.status = status;
    this.body = body;
    // 422 comes in two shapes: `errors` present = form problem, absent = booking rule (show message as is).
    this.errors = body?.errors ?? null;
  }
}

export async function request(path, { method = 'GET', query, body } = {}) {
  const url = new URL(BASE_URL + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      // Arrays become repeated keys: { 'venues[]': ['a', 'b'] } -> venues[]=a&venues[]=b
      if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
      else if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    }
  }

  const headers = { Accept: 'application/json' };
  // Sent on public calls too, so per-user fields like `isNotified` come back filled in.
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, { message: 'Network error. Check your connection and try again.' });
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

export const api = {
  login: (email, password) =>
    request('/login', { method: 'POST', body: { email, password } }).then((r) => r.data),
  // multipart/form-data because of the optional avatar; note `password_confirmation` is snake_case.
  register: (formData) => request('/register', { method: 'POST', body: formData }).then((r) => r.data),
  logout: () => request('/logout', { method: 'POST' }),
  me: () => request('/me').then((r) => r.data),

  featured: () => request('/movies/featured').then((r) => r.data),
  nowPlaying: (limit) => request('/movies/now-playing', { query: { limit } }).then((r) => r.data),
  comingSoon: (limit) => request('/movies/coming-soon', { query: { limit } }).then((r) => r.data),
  search: (q) => request('/search', { query: { q } }).then((r) => r.data),
  notify: (slug) =>
    request(`/movies/${encodeURIComponent(slug)}/notify`, { method: 'POST' }).then((r) => r.data),
};
