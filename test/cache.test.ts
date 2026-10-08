import { describe, expect, it } from 'vitest';
import { cachedPosts, type PostsCache } from '../src/cache.ts';
import type { PostsBody, SourceStatus } from '../src/posts.ts';
import { NOW } from './helpers.ts';

const ORIGIN = 'https://firsthour.1mb.dev';

function status(id: SourceStatus['id'], error: string | null): SourceStatus {
  return { id, ok: error === null, fetched_at: NOW.toISOString(), error, count: 0 };
}

function body(errors: [string | null, string | null, string | null], title = 'Acme | Backend | REMOTE'): PostsBody {
  return {
    generated: NOW.toISOString(),
    stale: false,
    sources: [status('hn', errors[0]), status('yc', errors[1]), status('boards', errors[2])],
    next_thread: '2026-11-02T16:00:00.000Z',
    items: [{ id: 'boards:1', source: 'boards', where: 'Acme careers', title, posted_at: NOW.toISOString(), url: 'https://jobs.lever.co/acme/1' }],
  };
}

/** A Map-backed Cache; expiry is the platform's job and is not simulated. */
function memoryCache(): { cache: PostsCache; store: Map<string, Response> } {
  const store = new Map<string, Response>();
  const cache = {
    match: async (key: RequestInfo | URL) => store.get(String(key))?.clone(),
    put: async (key: RequestInfo | URL, response: Response) => void store.set(String(key), response),
  } as PostsCache;
  return { cache, store };
}

async function serve(cache: PostsCache, built: PostsBody, origin = ORIGIN): Promise<{ body: PostsBody; builds: number }> {
  let builds = 0;
  const pending: Promise<unknown>[] = [];
  const served = await cachedPosts(cache, origin, async () => (builds++, built), (p) => void pending.push(p));
  await Promise.all(pending);
  return { body: served, builds };
}

describe('cachedPosts', () => {
  it('builds on a miss and writes fresh for 5 minutes and last-good for 24 hours', async () => {
    const { cache, store } = memoryCache();
    const first = await serve(cache, body([null, null, null]));
    expect(first.builds).toBe(1);
    expect(store.get(`${ORIGIN}/__cache/posts/fresh`)?.headers.get('cache-control')).toBe('max-age=300');
    expect(store.get(`${ORIGIN}/__cache/posts/last-good`)?.headers.get('cache-control')).toBe('max-age=86400');
  });

  it('serves a fresh hit without building', async () => {
    const { cache } = memoryCache();
    await serve(cache, body([null, null, null], 'first'));
    const second = await serve(cache, body([null, null, null], 'second'));
    expect(second.builds).toBe(0);
    expect(second.body.items[0]?.title).toBe('first');
  });

  it('caches a partial failure as fresh, with its error status', async () => {
    const { cache, store } = memoryCache();
    const served = await serve(cache, body([null, '429', null]));
    expect(served.body.sources[1]).toMatchObject({ ok: false, error: '429' });
    expect(store.has(`${ORIGIN}/__cache/posts/fresh`)).toBe(true);
  });

  it('serves last-good marked stale, with current statuses, when every source failed', async () => {
    const { cache, store } = memoryCache();
    await serve(cache, body([null, null, null], 'good'));
    store.delete(`${ORIGIN}/__cache/posts/fresh`);
    const failed = body(['503', 'timeout', 'stale'], 'from the failed build');
    const served = await serve(cache, failed);
    expect(served.body.stale).toBe(true);
    expect(served.body.items[0]?.title).toBe('good');
    expect(served.body.sources).toEqual(failed.sources);
    expect(store.has(`${ORIGIN}/__cache/posts/fresh`)).toBe(false);
  });

  it('serves the failed build itself, never a 503, when there is no last-good', async () => {
    const { cache, store } = memoryCache();
    const failed = body(['503', 'timeout', 'stale'], 'stale boards item');
    const served = await serve(cache, failed);
    expect(served.body).toEqual(failed);
    expect(store.size).toBe(0);
  });

  it('keys entries on the request origin', async () => {
    const { cache, store } = memoryCache();
    await serve(cache, body([null, null, null]), 'https://jobs.example.org');
    expect(store.size).toBe(2);
    expect([...store.keys()].every((k) => k.startsWith('https://jobs.example.org/'))).toBe(true);
  });
});
