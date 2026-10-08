import { nextThread } from './next-thread.ts';
import { select } from './select.ts';
import { SourceError, type Adapter, type Candidate, type Deps, type Item, type Loaded, type SourceId } from './types.ts';

export const SOURCE_TIMEOUT_MS = 5000;

export interface SourceStatus {
  id: SourceId;
  ok: boolean;
  fetched_at: string;
  error: string | null;
  count: number;
}

export interface PostsBody {
  generated: string;
  stale: boolean;
  sources: SourceStatus[];
  next_thread: string;
  items: Item[];
}

/** Rejects when the deadline fires, for work that does not take the signal itself (a KV read). */
function withDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SourceError('timeout'));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function errorCode(error: unknown): string {
  // A non-SourceError is an adapter bug, not an outage; label it so.
  return error instanceof SourceError ? error.code : 'internal';
}

/**
 * Loads every source in parallel under one deadline. One source failing never blocks the others,
 * and a source that misses the deadline has its fetches aborted, not left running.
 */
export async function buildPosts(
  adapters: readonly Adapter[],
  base: Omit<Deps, 'signal'>,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<PostsBody> {
  const now = base.now;
  const signal = AbortSignal.timeout(timeoutMs);
  const deps: Deps = { ...base, signal };
  const settled = await Promise.allSettled(adapters.map((a) => withDeadline(a.load(deps), signal)));

  const candidates: Candidate[] = [];
  const results: { id: SourceId; loaded?: Loaded; error: string | null }[] = adapters.map((adapter, i) => {
    const outcome = settled[i];
    if (outcome?.status === 'fulfilled') {
      candidates.push(...outcome.value.posts);
      return { id: adapter.id, loaded: outcome.value, error: outcome.value.error ?? null };
    }
    if (outcome?.status === 'rejected' && !(outcome.reason instanceof SourceError)) console.error(adapter.id, outcome.reason);
    return { id: adapter.id, error: errorCode(outcome?.status === 'rejected' ? outcome.reason : undefined) };
  });

  const items = select(candidates, now);
  const threadAt = results.find((r) => r.loaded?.thread_at)?.loaded?.thread_at;

  return {
    generated: now.toISOString(),
    stale: false,
    sources: results.map((r) => ({
      id: r.id,
      ok: r.error === null,
      fetched_at: r.loaded?.fetched_at ?? now.toISOString(),
      error: r.error,
      count: items.filter((item) => item.source === r.id).length,
    })),
    next_thread: nextThread(now, threadAt).toISOString(),
    items,
  };
}

/** No source answered and none carried posts: a stale source with items still counts as data. */
export function allFailed(body: PostsBody): boolean {
  return body.sources.every((s) => !s.ok && s.count === 0);
}
