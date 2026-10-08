import { fetchJson, hitsOf, isRecord, str } from '../http.ts';
import { select, WINDOW_MS } from '../select.ts';
import { firstLine, htmlToText } from '../text.ts';
import { SourceError, type Adapter, type Candidate, type Deps, type Item, type Loaded } from '../types.ts';
import { DROP_AFTER_MS, STALE_AFTER_MS } from './boards.ts';

const ALGOLIA = 'https://hn.algolia.com/api/v1/search_by_date';
const THREAD_PREFIX = 'Ask HN: Who is hiring?';

export const THREADS_URL = `${ALGOLIA}?tags=story,author_whoishiring&hitsPerPage=5`;

// Never lower this: a capped page drops the oldest postings, which are the day-one burst. The
// parent_id filter keeps replies from counting toward it.
export const HITS_PER_PAGE = 1000;

/** Top-level comments of a thread, only those from `since` (unix seconds) on when given. */
export function commentsUrl(threadId: string, since?: number): string {
  const filters = [`parent_id=${threadId}`, ...(since === undefined ? [] : [`created_at_i>=${since}`])].join(',');
  return `${ALGOLIA}?tags=comment,story_${threadId}&numericFilters=${encodeURIComponent(filters)}&hitsPerPage=${HITS_PER_PAGE}&attributesToRetrieve=comment_text,created_at,parent_id&attributesToHighlight=none`;
}

/** Algolia matched more than it returned, so postings were cut. */
export function isTruncated(json: unknown): boolean {
  return isRecord(json) && typeof json.nbHits === 'number' && json.nbHits > hitsOf(json).length;
}

export function itemUrl(id: string): string {
  return `https://news.ycombinator.com/item?id=${id}`;
}

export interface Thread {
  id: string;
  title: string;
  created_at: string;
}

/** "Who is hiring?" stories among whoishiring's recent posts, newest first. */
export function pickThreads(json: unknown): Thread[] {
  const threads: Thread[] = [];
  for (const hit of hitsOf(json)) {
    if (!isRecord(hit)) continue;
    const id = str(hit.objectID);
    const title = str(hit.title);
    const created = str(hit.created_at);
    if (!id || !/^\d+$/.test(id) || !title?.startsWith(THREAD_PREFIX) || !created || !Number.isFinite(Date.parse(created))) {
      continue;
    }
    threads.push({ id, title, created_at: created });
  }
  return threads.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

/** "Ask HN: Who is hiring? (October 2026)" -> "HN Who is hiring (Oct)". */
export function threadLabel(thread: Thread): string {
  const month = /\(([A-Za-z]{3})[A-Za-z]* \d{4}\)/.exec(thread.title)?.[1];
  return month ? `HN Who is hiring (${month})` : 'HN Who is hiring';
}

export interface Comment {
  id: string;
  html: string;
  created_at: string;
}

/** Top-level comments of a thread. Replies and hits missing required fields are skipped. */
export function topLevelComments(json: unknown, threadId: string): Comment[] {
  const comments: Comment[] = [];
  for (const hit of hitsOf(json)) {
    if (!isRecord(hit) || String(hit.parent_id) !== threadId) continue;
    const id = str(hit.objectID);
    const html = str(hit.comment_text);
    const created = str(hit.created_at);
    if (!id || !/^\d+$/.test(id) || !html || !created) continue;
    comments.push({ id, html, created_at: created });
  }
  return comments;
}

/** First line of the text, read from the first paragraph alone when that is enough. */
export function titleOf(html: string): string {
  const end = html.search(/<p>/i);
  return (end > 0 && firstLine(htmlToText(html.slice(0, end)))) || firstLine(htmlToText(html));
}

/** `body` converts on first read: only the deny check reads it, and select runs that last. */
export function toCandidates(comments: readonly Comment[], thread: Thread): Candidate[] {
  const where = threadLabel(thread);
  return comments.map((c) => {
    let body: string | undefined;
    return {
      id: `hn:${c.id}`,
      source: 'hn',
      where,
      title: titleOf(c.html),
      posted_at: c.created_at,
      url: itemUrl(c.id),
      get body() {
        return (body ??= htmlToText(c.html));
      },
    };
  });
}

export const BASELINE_KEY = 'hn:latest';

/** The current thread, selected offline. The Worker adds postings newer than `watermark`. */
export interface Baseline {
  generated: string;
  thread_id: string;
  thread_at: string;
  /** Newest posting seen, not the build time: Algolia indexes with a lag. */
  watermark: string;
  items: Item[];
}

export function buildBaseline(thread: Thread, comments: readonly Comment[], now: Date): Baseline {
  const newest = Math.max(Date.parse(thread.created_at), ...comments.map((c) => Date.parse(c.created_at)).filter(Number.isFinite));
  return {
    generated: now.toISOString(),
    thread_id: thread.id,
    thread_at: thread.created_at,
    watermark: new Date(newest).toISOString(),
    items: select(toCandidates(comments, thread), now),
  };
}

function isTime(s: string | undefined): s is string {
  return s !== undefined && Number.isFinite(Date.parse(s));
}

/** Validates a baseline read back from KV. Item urls are rebuilt from validated ids; bad items drop. */
export function parseBaseline(json: unknown): Baseline {
  if (!isRecord(json) || !Array.isArray(json.items)) throw new SourceError('schema');
  const generated = str(json.generated);
  const threadId = str(json.thread_id);
  const threadAt = str(json.thread_at);
  const watermark = str(json.watermark);
  if (!threadId || !/^\d+$/.test(threadId) || !isTime(generated) || !isTime(threadAt) || !isTime(watermark)) throw new SourceError('schema');
  const items: Item[] = [];
  for (const raw of json.items) {
    if (!isRecord(raw)) continue;
    const id = /^hn:(\d+)$/.exec(str(raw.id) ?? '')?.[1];
    const where = str(raw.where);
    const title = str(raw.title);
    const posted = str(raw.posted_at);
    if (!id || !where || !title || !isTime(posted)) continue;
    items.push({ id: `hn:${id}`, source: 'hn', where, title, posted_at: posted, url: itemUrl(id) });
  }
  return { generated, thread_id: threadId, thread_at: threadAt, watermark, items };
}

/** A thread this young is small enough to parse whole within the request CPU limit. */
const FULL_FETCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Re-read this far behind the watermark for Algolia's indexing lag; duplicates dedupe by id. */
const OVERLAP_S = 300;

async function fetchPostings({ fetch, userAgent, signal }: Deps, thread: Thread, since: number): Promise<{ posts: Candidate[]; truncated: boolean }> {
  const json = await fetchJson(fetch, commentsUrl(thread.id, since), userAgent, signal);
  return { posts: toCandidates(topLevelComments(json, thread.id), thread), truncated: isTruncated(json) };
}

/**
 * The baseline plus postings newer than its watermark. Without a usable baseline, only a thread
 * under a day old is fetched whole; parsing an older one can exceed the Free plan's CPU limit.
 */
async function loadHn(deps: Deps): Promise<Loaded> {
  const { fetch, userAgent, signal, now, kv } = deps;
  const thread = pickThreads(await fetchJson(fetch, THREADS_URL, userAgent, signal))[0];
  if (!thread) throw new SourceError('no thread');
  const raw = kv ? await kv.get(BASELINE_KEY, 'json') : null;
  const baseline = raw === null ? null : parseBaseline(raw);
  const t = now.getTime();
  const windowStart = Math.floor((t - WINDOW_MS) / 1000);

  if (baseline?.thread_id === thread.id && t - Date.parse(baseline.generated) <= DROP_AFTER_MS) {
    const delta = await fetchPostings(deps, thread, Math.max(Math.floor(Date.parse(baseline.watermark) / 1000) - OVERLAP_S, windowStart));
    // Delta first, so the live copy wins where the two overlap.
    const posts = [...delta.posts, ...baseline.items.map((item) => ({ ...item, body: '', pregated: true }))];
    const error = delta.truncated ? 'truncated' : t - Date.parse(baseline.generated) > STALE_AFTER_MS ? 'stale' : undefined;
    return { posts, thread_at: thread.created_at, ...(error && { error }) };
  }
  if (t - Date.parse(thread.created_at) < FULL_FETCH_MAX_AGE_MS) {
    const full = await fetchPostings(deps, thread, windowStart);
    return { posts: full.posts, thread_at: thread.created_at, ...(full.truncated && { error: 'truncated' }) };
  }
  return { posts: [], thread_at: thread.created_at, error: 'no baseline' };
}

export const hn: Adapter = { id: 'hn', load: loadHn };
