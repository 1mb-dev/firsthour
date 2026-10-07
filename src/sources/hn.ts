import { fetchJson, hitsOf, isRecord, str } from '../http.ts';
import { firstLine, htmlToText } from '../text.ts';
import { SourceError, type Adapter, type Candidate } from '../types.ts';

const ALGOLIA = 'https://hn.algolia.com/api/v1/search_by_date';
const THREAD_PREFIX = 'Ask HN: Who is hiring?';

export const THREADS_URL = `${ALGOLIA}?tags=story,author_whoishiring&hitsPerPage=5`;

// Replies count toward hitsPerPage, so anything under Algolia's 1000 max drops the oldest postings,
// which are the day-one burst.
export function commentsUrl(threadId: string, hitsPerPage = 1000): string {
  return `${ALGOLIA}?tags=comment,story_${threadId}&hitsPerPage=${hitsPerPage}&attributesToRetrieve=comment_text,created_at,parent_id&attributesToHighlight=none`;
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

export function toCandidates(comments: Comment[], thread: Thread): Candidate[] {
  const where = threadLabel(thread);
  return comments.map((c) => {
    const body = htmlToText(c.html);
    return {
      id: `hn:${c.id}`,
      source: 'hn',
      where,
      title: firstLine(body),
      posted_at: c.created_at,
      url: itemUrl(c.id),
      body,
    };
  });
}

export const hn: Adapter = {
  id: 'hn',
  async load({ fetch, userAgent, signal }) {
    const thread = pickThreads(await fetchJson(fetch, THREADS_URL, userAgent, signal))[0];
    if (!thread) throw new SourceError('no thread');
    const comments = topLevelComments(await fetchJson(fetch, commentsUrl(thread.id), userAgent, signal), thread.id);
    return { posts: toCandidates(comments, thread), thread_at: thread.created_at };
  },
};
