// @ts-check
// Pure page logic. No DOM here, so vitest can test it directly.

/**
 * @typedef {{ id: string, source: 'hn' | 'yc' | 'boards', where: string, title: string, posted_at: string, url: string }} Item
 * @typedef {{ id: string, ok: boolean, fetched_at: string, error: string | null, count: number }} Status
 * @typedef {{ generated: string, stale: boolean, sources: Status[], next_thread: string, items: Item[] }} Posts
 * @typedef {{ include: string[], exclude: string[] }} Filter
 * @typedef {{ ids: Set<string>, at: string }} Seen
 * @typedef {'auto' | 'light' | 'dark'} Theme
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** @param {string} postedAt @param {number} now */
export function age(postedAt, now) {
  const ms = Math.max(0, now - Date.parse(postedAt));
  if (ms < MINUTE) return 'now';
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  return `${Math.floor(ms / DAY)}d`;
}

const GROUPS = [
  { label: 'First hour', max: HOUR },
  { label: 'Last 24 hours', max: DAY },
  { label: 'This week', max: Infinity },
];

/**
 * Items keep their order (newest first); empty groups are left out.
 * @param {Item[]} items @param {number} now
 */
export function group(items, now) {
  /** @type {{ label: string, items: Item[] }[]} */
  const groups = GROUPS.map((g) => ({ label: g.label, items: [] }));
  for (const item of items) {
    const ms = now - Date.parse(item.posted_at);
    const i = GROUPS.findIndex((g) => ms < g.max);
    groups[i]?.items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

/** @param {string} q @returns {Filter} */
export function parseFilter(q) {
  const terms = q
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return {
    include: terms.filter((t) => !t.startsWith('-')),
    exclude: terms.filter((t) => t.startsWith('-')).map((t) => t.slice(1).trim()).filter(Boolean),
  };
}

/** @param {Filter} f */
export function isActive(f) {
  return f.include.length > 0 || f.exclude.length > 0;
}

/**
 * Whole-word match with an optional plural, so `engineer` finds "Engineers" and `go` finds "Go"
 * but not "Google" or "Chicago".
 * @param {string} haystack @param {string} term
 */
function hasWord(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?:s|es)?(?![a-z0-9])`).test(haystack);
}

/** Terms match what a row shows: the title and the source word, not the unshown `where`. @param {Item} item @param {Filter} f */
export function matches(item, f) {
  const haystack = `${item.title}\n${sourceLabel(item)}`.toLowerCase();
  if (f.exclude.some((t) => hasWord(haystack, t))) return false;
  return f.include.length === 0 || f.include.some((t) => hasWord(haystack, t));
}

const SEEN_KEY = 'firsthour:seen';

/**
 * Null on first visit, unreadable storage, or a corrupt record: then nothing is marked new.
 * @param {Pick<Storage, 'getItem'> | undefined} storage @returns {Seen | null}
 */
export function loadSeen(storage) {
  try {
    const raw = storage?.getItem(SEEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.ids) || typeof parsed.at !== 'string') return null;
    return { ids: new Set(parsed.ids.filter((/** @type {unknown} */ id) => typeof id === 'string')), at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * Seen after this visit: what was seen before and is still listed, plus what was on screen now.
 * Rows never scrolled to, or hidden by the filter, stay unseen and keep full ink next visit.
 * @param {Seen | null} seen @param {string[]} listed @param {Iterable<string>} viewed
 */
export function nextSeen(seen, listed, viewed) {
  const ids = new Set(viewed);
  for (const id of listed) if (seen?.ids.has(id)) ids.add(id);
  return [...ids];
}

/** @param {Pick<Storage, 'setItem'> | undefined} storage @param {string[]} ids @param {Date} at */
export function saveSeen(storage, ids, at) {
  try {
    storage?.setItem(SEEN_KEY, JSON.stringify({ ids, at: at.toISOString() }));
  } catch {
    // Private mode or full storage: markers just won't carry over.
  }
}

const THEME_KEY = 'firsthour:theme';

/** @param {Pick<Storage, 'getItem'> | undefined} storage @returns {Theme} */
export function loadTheme(storage) {
  try {
    const theme = storage?.getItem(THEME_KEY);
    return theme === 'light' || theme === 'dark' ? theme : 'auto';
  } catch {
    return 'auto';
  }
}

/** Auto is the absence of a choice, so it clears the key. @param {Pick<Storage, 'setItem' | 'removeItem'> | undefined} storage @param {Theme} theme */
export function saveTheme(storage, theme) {
  try {
    if (theme === 'auto') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or full storage: the choice lasts until reload.
  }
}

/** @param {Item} item @param {Seen | null} seen */
export function isNew(item, seen) {
  return seen !== null && !seen.ids.has(item.id);
}

// A URL, bare `www.` host, or one cut short by the 160-char title cap ("https:…"). Wrapping parens go with it;
// a paren that closes surrounding text stays, so "(listed here https://x)" keeps its ")".
const URLISH = /\((?:https?:|www\.)[^\s)]*\)|\b(?:https?:|www\.)[^\s)]*/gi;
const EDGES = /^[\s,;:·-]+|[\s,;:·-]+$/g;

/**
 * Display split of an untrusted title on the `Company | Role | ...` convention, URLs dropped.
 * HN job stories and titles without a pipe have no company part. Text only: callers render with textContent.
 * @param {Item} item @returns {{ company: string, role: string }}
 */
export function parts(item) {
  const segs = item.title
    .split('|')
    .map((s) => s.replace(URLISH, '').replace(/\s+/g, ' ').replace(/ \)/g, ')').replace(EDGES, ''))
    .filter(Boolean);
  if (segs.length === 0) return { company: '', role: item.title };
  if (item.source === 'yc' || segs.length < 2) return { company: '', role: segs.join(' · ') };
  return { company: segs[0] ?? '', role: segs.slice(1).join(' · ') };
}

const SOURCES = { hn: 'HN', yc: 'HN jobs', boards: 'board' };

/** @param {Item} item */
export function sourceLabel(item) {
  return SOURCES[item.source] ?? item.source;
}

const NAMES = { hn: 'HN', yc: 'HN jobs', boards: 'Boards' };

/** @param {Status} s @param {(iso: string) => string} time */
export function statusText(s, time) {
  const name = NAMES[/** @type {keyof typeof NAMES} */ (s.id)] ?? s.id;
  if (s.ok) return `${name} ok`;
  if (s.error === 'stale') return `${name} stale since ${time(s.fetched_at)}`;
  return `${name} unavailable (${s.error})`;
}

/** @param {Posts} posts */
export function allDown(posts) {
  return posts.sources.length > 0 && posts.sources.every((s) => !s.ok) && posts.items.length === 0;
}
