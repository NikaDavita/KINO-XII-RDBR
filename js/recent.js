// "Recently viewed" lives in the browser: the API has no endpoint for it.
const KEY = 'kinoxii.recentlyViewed';
const MAX_ITEMS = 10;

export function getRecent() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

export function addRecent(movie) {
  if (!movie?.slug) return;
  const snapshot = {
    slug: movie.slug,
    title: movie.title,
    posterUrl: movie.posterUrl,
    runtimeMinutes: movie.runtimeMinutes,
    genres: movie.genres?.slice(0, 1) ?? [],
    ageRating: movie.ageRating,
  };
  const items = [snapshot, ...getRecent().filter((item) => item.slug !== movie.slug)].slice(0, MAX_ITEMS);
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage blocked */ }
}
