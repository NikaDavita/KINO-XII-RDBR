// Thin wrapper around the Kino XII REST API.
// Spec: https://api.kinoxii.redberryinternship.ge/docs

const BASE_URL = 'https://api.kinoxii.redberryinternship.ge/api';
const TOKEN_KEY = 'kinoxii.token';
const FILTER_OPTIONS_KEY = 'kinoxii.filterOptions';

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

let filterOptionsPromise = null;

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
  // Returns { data: [{ movie, sessions }], meta }; pagination counts films, not sessions.
  sessions: ({ date, venues, formats, languages, bands, sort, page }) =>
    request('/sessions', {
      query: {
        date, sort, page,
        'venues[]': venues, 'formats[]': formats, 'languages[]': languages, 'bands[]': bands,
      },
    }),
  session: (id) => request(`/sessions/${id}`).then((r) => r.data),
  // The hall map: sections -> rows -> seats. Sending a token also marks your own held seats (isMine).
  seats: (sessionId) => request(`/sessions/${sessionId}/seats`).then((r) => r.data),

  // Booking is three calls: seats, then holds, then orders.
  holdSeats: (sessionId, seats) =>
    request(`/sessions/${sessionId}/holds`, { method: 'POST', body: { seats } }).then((r) => r.data),
  getHold: (holdId) => request(`/holds/${holdId}`).then((r) => r.data),
  releaseHold: (holdId) => request(`/holds/${holdId}`, { method: 'DELETE' }),
  createOrder: (body) => request('/orders', { method: 'POST', body }).then((r) => r.data),

  search: (q) => request('/search', { query: { q } }).then((r) => r.data),
  movie: (slug) => request(`/movies/${encodeURIComponent(slug)}`).then((r) => r.data),
  // [{ venue, sessions }] for one date
  movieSessions: (slug, date) =>
    request(`/movies/${encodeURIComponent(slug)}/sessions`, { query: { date } }).then((r) => r.data),
  notify: (slug) =>
    request(`/movies/${encodeURIComponent(slug)}/notify`, { method: 'POST' }).then((r) => r.data),

  // Fetched once per browser session and cached, as the spec asks.
  filterOptions() {
    if (!filterOptionsPromise) {
      let cached = null;
      try { cached = JSON.parse(sessionStorage.getItem(FILTER_OPTIONS_KEY)); } catch { /* ignore */ }
      filterOptionsPromise = cached
        ? Promise.resolve(cached)
        : request('/filter-options').then((r) => {
            try { sessionStorage.setItem(FILTER_OPTIONS_KEY, JSON.stringify(r.data)); } catch { /* ignore */ }
            return r.data;
          });
      filterOptionsPromise.catch(() => { filterOptionsPromise = null; });
    }
    return filterOptionsPromise;
  },
};
