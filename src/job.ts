import { apiUrl } from './boards/ats.ts';
import { discover } from './boards/discover.ts';
import { buildSnapshot, type SnapshotRun } from './boards/snapshot.ts';
import { fetchJson } from './http.ts';
import { buildBaseline, commentsUrl, isTruncated, pickThreads, THREADS_URL, topLevelComments, type Baseline, type Thread } from './sources/hn.ts';
import { SourceError } from './types.ts';

const FETCH_TIMEOUT_MS = 15_000;
const ATTEMPTS = 3;
/** Threads whose postings feed board discovery. */
const DISCOVERY_THREADS = 3;

function retryable(code: string): boolean {
  return code === 'network' || code === 'timeout' || /^5\d\d$/.test(code);
}

/** Two retries on network errors, timeouts and 5xx; none on 4xx. */
export async function fetchJsonRetry(fetchFn: typeof fetch, url: string, userAgent: string, retryDelayMs: number): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchJson(fetchFn, url, userAgent, AbortSignal.timeout(FETCH_TIMEOUT_MS));
    } catch (error) {
      if (attempt >= ATTEMPTS || !(error instanceof SourceError) || !retryable(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
}

export interface JobRun {
  thread: Thread;
  postings: number;
  boards: SnapshotRun;
  /** Null when Algolia cut the current thread short: a partial baseline would hide postings. */
  baseline: Baseline | null;
}

/** The scheduled job: the boards snapshot and the hn baseline, from one read of the recent threads. */
export async function runJob(options: { fetch: typeof fetch; now: Date; userAgent: string; retryDelayMs?: number }): Promise<JobRun> {
  const { fetch: fetchFn, now, userAgent, retryDelayMs = 1000 } = options;
  const get = (url: string) => fetchJsonRetry(fetchFn, url, userAgent, retryDelayMs);
  const threads = pickThreads(await get(THREADS_URL)).slice(0, DISCOVERY_THREADS);
  const thread = threads[0];
  if (!thread) throw new SourceError('no thread');
  const pages = await Promise.all(threads.map((t) => get(commentsUrl(t.id))));
  // Newest thread first: discovery names each board after the newest posting that links it.
  const comments = threads.map((t, i) => topLevelComments(pages[i], t.id));
  const current = comments[0] ?? [];
  const boards = await buildSnapshot(discover(comments.flat()), (board) => get(apiUrl(board)), now);
  return { thread, postings: current.length, boards, baseline: isTruncated(pages[0]) ? null : buildBaseline(thread, current, now) };
}
