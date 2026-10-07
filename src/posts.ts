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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SourceError('timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function errorCode(error: unknown): string {
  // Anything that is not a SourceError is a bug in an adapter; the code says so instead of hiding it.
  return error instanceof SourceError ? error.code : 'internal';
}

/** Loads every source in parallel. One source failing never blocks the others. */
export async function buildPosts(adapters: readonly Adapter[], deps: Deps, timeoutMs = SOURCE_TIMEOUT_MS): Promise<PostsBody> {
  const now = deps.now;
  const settled = await Promise.allSettled(adapters.map((a) => withTimeout(a.load(deps), timeoutMs)));

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

export function allFailed(body: PostsBody): boolean {
  return body.sources.every((s) => !s.ok);
}
