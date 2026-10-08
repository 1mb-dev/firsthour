import { describe, expect, it } from 'vitest';
import type { Board } from '../src/boards/discover.ts';
import { buildSnapshot, SNAPSHOT_KEY } from '../src/boards/snapshot.ts';
import { refreshSnapshots, type RefreshDeps } from '../src/refresh.ts';
import { boards } from '../src/sources/boards.ts';
import { BASELINE_KEY, buildBaseline, hn, pickThreads, topLevelComments } from '../src/sources/hn.ts';
import { fixture, META, minutesAgo, NOW } from './helpers.ts';

const snapshot = (generated: string) => ({
  generated,
  boards_total: 2,
  boards_ok: 2,
  items: [
    { id: 'boards:ashby:acme:1', source: 'boards', where: 'Acme', title: 'Backend Engineer', posted_at: generated, url: 'https://jobs.ashbyhq.com/acme/1' },
    { id: 'boards:bad', source: 'boards', where: 'Evil', title: 'x', posted_at: generated, url: 'javascript:alert(1)' },
  ],
});
const baseline = (generated: string) => ({ generated, thread_id: '1', thread_at: minutesAgo(600), watermark: minutesAgo(30), items: [] });

/** A KV map, with each put recorded. */
function memoryKv(initial: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  const puts: string[] = [];
  const kv = {
    get: (async (key: string) => {
      const raw = store.get(key);
      return raw === undefined ? null : JSON.parse(raw);
    }) as never,
    put: async (key: string, value: string) => {
      puts.push(key);
      store.set(key, value);
    },
  } satisfies RefreshDeps['kv'];
  return { kv, store, puts };
}

/** Pages answering each file with `files[name]`, or 404. */
function pages(files: Record<string, () => Response>): { fetch: typeof fetch; urls: string[]; inits: RequestInit[] } {
  const urls: string[] = [];
  const inits: RequestInit[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    urls.push(String(input));
    inits.push(init);
    const name = Object.keys(files).find((f) => String(input).includes(`/${f}?`));
    return name ? files[name]!() : new Response('<html>404</html>', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, urls, inits };
}

const both = (boardsAt: string, hnAt: string) => ({
  'boards.json': () => Response.json(snapshot(boardsAt)),
  'hn.json': () => Response.json(baseline(hnAt)),
});

const run = (fetchFn: typeof fetch, kv: RefreshDeps['kv']) => refreshSnapshots({ fetch: fetchFn, kv, now: NOW, userAgent: 'test', base: 'https://pages.test/' });
const byKey = (results: Awaited<ReturnType<typeof run>>) => Object.fromEntries(results.map((r) => [r.key, r]));

describe('refreshSnapshots', () => {
  it('writes both files into an empty KV, validated', async () => {
    const { kv, store } = memoryKv();
    const results = byKey(await run(pages(both(minutesAgo(20), minutesAgo(20))).fetch, kv));
    expect(results[SNAPSHOT_KEY]!.outcome).toBe('wrote');
    expect(results[BASELINE_KEY]!.outcome).toBe('wrote');
    const stored = JSON.parse(store.get(SNAPSHOT_KEY)!);
    expect(stored.items.map((i: { id: string }) => i.id)).toEqual(['boards:ashby:acme:1']);
  });

  it('fetches past the CDN cache without following redirects', async () => {
    const { fetch, urls, inits } = pages(both(minutesAgo(20), minutesAgo(20)));
    await run(fetch, memoryKv().kv);
    expect(urls).toContain(`https://pages.test/boards.json?t=${NOW.getTime()}`);
    expect(inits.every((i) => i.redirect === 'manual')).toBe(true);
  });

  it('treats a redirect as a failure: the Pages host moved', async () => {
    const { kv, puts } = memoryKv();
    const moved = () => new Response(null, { status: 301, headers: { location: 'https://elsewhere.test/hn.json' } });
    const results = byKey(await run(pages({ 'boards.json': moved, 'hn.json': moved }).fetch, kv));
    expect(results[BASELINE_KEY]).toMatchObject({ outcome: 'failed', detail: '301' });
    expect(puts).toEqual([]);
  });

  it('replaces an older copy, and leaves an equal or newer one alone', async () => {
    const { kv, puts } = memoryKv({ [SNAPSHOT_KEY]: snapshot(minutesAgo(300)), [BASELINE_KEY]: baseline(minutesAgo(20)) });
    const results = byKey(await run(pages(both(minutesAgo(20), minutesAgo(20))).fetch, kv));
    expect(results[SNAPSHOT_KEY]!.outcome).toBe('wrote');
    expect(results[BASELINE_KEY]!.outcome).toBe('unchanged');
    expect(puts).toEqual([SNAPSHOT_KEY]);
  });

  it('keeps the stored copy when Pages fails, answers HTML, or serves a bad schema', async () => {
    const { kv, puts } = memoryKv({ [SNAPSHOT_KEY]: snapshot(minutesAgo(300)), [BASELINE_KEY]: baseline(minutesAgo(300)) });
    const results = byKey(
      await run(
        pages({
          'boards.json': () => new Response('<html>rate limited</html>', { status: 429 }),
          'hn.json': () => new Response('<html>not json</html>', { headers: { 'content-type': 'text/html' } }),
        }).fetch,
        kv,
      ),
    );
    expect(results[SNAPSHOT_KEY]).toMatchObject({ outcome: 'failed', detail: '429' });
    expect(results[BASELINE_KEY]).toMatchObject({ outcome: 'failed', detail: 'parse' });
    const schema = byKey(await run(pages({ 'hn.json': () => Response.json({ generated: 'yesterday', items: [] }) }).fetch, kv));
    expect(schema[BASELINE_KEY]).toMatchObject({ outcome: 'failed', detail: 'schema' });
    expect(puts).toEqual([]);
  });

  it('refuses a generated time in the future, which would block every later write', async () => {
    const { kv, puts } = memoryKv();
    const ahead = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const results = byKey(await run(pages(both(ahead, minutesAgo(20))).fetch, kv));
    expect(results[SNAPSHOT_KEY]!.detail).toContain('in the future');
    expect(puts).toEqual([BASELINE_KEY]);
  });

  it('replaces a stored copy that claims a future time, which would otherwise win forever', async () => {
    const ahead = new Date(NOW.getTime() + 60 * 60_000).toISOString();
    const { kv, puts } = memoryKv({ [SNAPSHOT_KEY]: snapshot(ahead), [BASELINE_KEY]: baseline(ahead) });
    await run(pages(both(minutesAgo(20), minutesAgo(20))).fetch, kv);
    expect(puts.sort()).toEqual([SNAPSHOT_KEY, BASELINE_KEY].sort());
  });

  it('replaces a stored copy that no longer validates', async () => {
    const { kv, puts } = memoryKv({ [SNAPSHOT_KEY]: 'not json', [BASELINE_KEY]: { generated: 'x', items: [] } });
    await run(pages(both(minutesAgo(20), minutesAgo(20))).fetch, kv);
    expect(puts.sort()).toEqual([SNAPSHOT_KEY, BASELINE_KEY].sort());
  });

  it('reports a network failure without throwing', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const results = await run(failing, memoryKv().kv);
    expect(results.every((r) => r.outcome === 'failed' && r.detail === 'network')).toBe(true);
  });

  it('stores what the job built, so the adapters read it back unchanged', async () => {
    const [thread] = pickThreads(fixture('hn-threads.json'));
    const baseline = buildBaseline(thread!, topLevelComments(fixture('hn-comments.json'), thread!.id), NOW);
    const boardJson: Record<string, unknown> = { ashby: fixture('ashby.json'), greenhouse: fixture('greenhouse.json'), lever: fixture('lever.json') };
    const { snapshot } = await buildSnapshot(META.boards as Board[], async (b) => boardJson[b.platform], NOW);
    expect(snapshot.items.length * baseline.items.length).toBeGreaterThan(0);
    const { kv, store } = memoryKv();
    await run(pages({ 'boards.json': () => Response.json(snapshot), 'hn.json': () => Response.json(baseline) }).fetch, kv);
    expect(JSON.parse(store.get(SNAPSHOT_KEY)!)).toEqual(snapshot);
    expect(JSON.parse(store.get(BASELINE_KEY)!)).toEqual(baseline);
    // Upstream failing: what the adapters serve comes from the stored copies alone.
    const down = (async () => new Response('down', { status: 503 })) as typeof fetch;
    const deps = { fetch: down, now: NOW, userAgent: 'test', signal: new AbortController().signal, kv };
    expect((await boards.load(deps)).posts.length).toBe(snapshot.items.length);
    expect((await hn.load(deps)).posts.map((p) => p.id)).toEqual(baseline.items.map((i) => i.id));
  });
});

