// @ts-check
// Pure page logic. No DOM here, so vitest can test it directly.

/**
 * @typedef {{ id: string, source: 'hn' | 'yc' | 'boards', where: string, title: string, posted_at: string, url: string }} Item
 * @typedef {{ id: string, ok: boolean, fetched_at: string, error: string | null, count: number }} Status
 * @typedef {{ generated: string, stale: boolean, sources: Status[], next_thread: string, items: Item[] }} Posts
 * @typedef {{ include: string[], exclude: string[] }} Filter
 * @typedef {{ ids: Set<string>, read: Set<string>, at: string }} Seen ids listed last visit (arrival); read: rows that were on screen
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

/**
 * Terms match the row's content as shown: company and role. Not the dropped URLs, the unshown `where`,
 * or the source word (`-hn` would also drop "HN jobs").
 * @param {Item} item @param {Filter} f
 */
export function matches(item, f) {
  const { company, role } = parts(item);
  const haystack = `${company}\n${role}`.toLowerCase();
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
    const strings = (/** @type {unknown[]} */ list) => new Set(/** @type {string[]} */ (list.filter((id) => typeof id === 'string')));
    const ids = strings(parsed.ids);
    // A record from before `read` existed: count everything it listed as read, so nothing jumps back to full ink.
    return { ids, read: Array.isArray(parsed.read) ? strings(parsed.read) : new Set(ids), at: parsed.at };
  } catch {
    return null;
  }
}

/**
 * The record after this visit, pruned to what is still listed. `ids` (arrival): what was listed before plus what the
 * filter showed now, so filtered-out items still arrive as new later. `read`: what was read before plus what was on
 * screen now, so rows never scrolled to keep full ink.
 * @param {Seen | null} seen @param {string[]} listed @param {string[]} shown @param {Iterable<string>} viewed
 */
export function nextSeen(seen, listed, shown, viewed) {
  const ids = new Set(shown);
  const read = new Set(viewed);
  for (const id of listed) {
    if (seen?.ids.has(id)) ids.add(id);
    if (seen?.read.has(id)) read.add(id);
  }
  return { ids: [...ids], read: [...read] };
}

/** @param {Pick<Storage, 'setItem'> | undefined} storage @param {{ ids: string[], read: string[] }} next @param {Date} at */
export function saveSeen(storage, next, at) {
  try {
    storage?.setItem(SEEN_KEY, JSON.stringify({ ...next, at: at.toISOString() }));
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

/** Arrived since the last visit. A first visit has no baseline, so nothing is new. @param {Item} item @param {Seen | null} seen */
export function isNew(item, seen) {
  return seen !== null && !seen.ids.has(item.id);
}

/** On screen during an earlier visit. A first visit has read nothing. @param {Item} item @param {Seen | null} seen */
export function isRead(item, seen) {
  return seen !== null && seen.read.has(item.id);
}

// A URL or bare `www.` host, with its wrapping parens, the closing one possibly lost to the 160-char title cap.
// A paren that closes surrounding text stays, so "(listed here https://x)" keeps its ")".
const URLISH = /\((?:https?:|www\.)[^\s)]*\)?|\b(?:https?:|www\.)[^\s)]*/gi;
// The cap can also cut a URL before its colon: "(http…", "ww…".
const CUT_URL = /\s*\(?\b(?:h(?:t(?:t(?:ps?)?)?)?|w{1,3})…$/i;
const EDGES = /^[\s,;:·-]+|[\s,;:·-]+$/g;

/**
 * Display split of an untrusted title on the `Company | Role | ...` convention, URLs dropped.
 * HN job stories and titles without a pipe have no company part. Text only: callers render with textContent.
 * @param {Item} item @returns {{ company: string, role: string }}
 */
export function parts(item) {
  const segs = item.title
    .split('|')
    .map((s) => s.replace(URLISH, '').replace(CUT_URL, '').replace(/\s+/g, ' ').replace(/ \)/g, ')').replace(EDGES, ''))
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
