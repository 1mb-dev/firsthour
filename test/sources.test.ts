import { describe, expect, it, vi } from 'vitest';
import { select } from '../src/select.ts';
import {
  ALGOLIA_BUDGET_MS,
  BASELINE_KEY,
  buildBaseline,
  commentsUrl,
  hn,
  itemUrl,
  parseBaseline,
  pickThreads,
  threadLabel,
  titleOf,
  toCandidates,
  topLevelComments,
} from '../src/sources/hn.ts';
import { firstLine, htmlToText } from '../src/text.ts';
import { parseJobs, yc } from '../src/sources/yc.ts';
import { SourceError, type Deps } from '../src/types.ts';
import { fixture, META, NOW } from './helpers.ts';

function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    const body = routes[key];
    return body instanceof Response ? body : Response.json(body);
  }) as typeof fetch;
}

function deps(fetchFn: typeof fetch): Deps {
  return { fetch: fetchFn, now: NOW, userAgent: 'test', signal: new AbortController().signal };
}

const HOUR = 60 * 60 * 1000;
// The fixture thread is six days old at NOW; two hours in, it is young enough to fetch whole.
const YOUNG = new Date(Date.parse(META.thread.created_at) + 2 * HOUR);

const algolia = (comments: unknown = fixture('hn-comments.json')) => ({ author_whoishiring: fixture('hn-threads.json'), [`story_${META.thread.id}`]: comments });

function recording(routes: Record<string, unknown>): { urls: string[]; fetch: typeof fetch } {
  const urls: string[] = [];
  const inner = fakeFetch(routes);
  return { urls, fetch: ((input, init) => (urls.push(String(input)), inner(input, init))) as typeof fetch };
}

const filtersOf = (urls: string[]) => urls.flatMap((u) => new URL(u).searchParams.get('numericFilters') ?? []);

const kvWith = (value: unknown): Deps['kv'] => ({ get: (async (key: string) => (key === BASELINE_KEY ? value : null)) as never });

describe('hn adapter', () => {
  it('picks the newest Who is hiring thread and labels it by month', () => {
    const [thread] = pickThreads(fixture('hn-threads.json'));
    expect(thread?.id).toBe(META.thread.id);
    expect(thread && threadLabel(thread)).toBe('HN Who is hiring (Oct)');
  });

  it('ignores Who wants to be hired and malformed hits', () => {
    const threads = pickThreads({
      hits: [
        { objectID: '1', title: 'Ask HN: Who wants to be hired? (October 2026)', created_at: '2026-10-01T15:00:00Z' },
        { objectID: 'x', title: 'Ask HN: Who is hiring? (October 2026)', created_at: '2026-10-01T15:00:00Z' },
        { objectID: '3', title: 'Ask HN: Who is hiring? (October 2026)' },
        { objectID: '4', created_at: '2026-10-01T15:00:00Z' },
      ],
    });
    expect(threads).toEqual([]);
  });

  it('keeps only top-level comments with the fields it needs', () => {
    const comments = topLevelComments(fixture('hn-comments.json'), META.thread.id);
    expect(comments.length).toBeGreaterThan(30);
    expect(comments.every((c) => /^\d+$/.test(c.id))).toBe(true);
    const missing = topLevelComments(
      { hits: [{ objectID: '9', parent_id: Number(META.thread.id), created_at: '2026-10-07T00:00:00Z' }] },
      META.thread.id,
    );
    expect(missing).toEqual([]);
  });

  it('builds candidates whose title is the first line and url comes from the id', () => {
    const [thread] = pickThreads(fixture('hn-threads.json'));
    const candidates = toCandidates(topLevelComments(fixture('hn-comments.json'), META.thread.id), thread!);
    for (const c of candidates) {
      expect(c.url).toBe(`https://news.ycombinator.com/item?id=${c.id.slice(3)}`);
      expect(c.title).not.toContain('\n');
      expect(c.title).not.toMatch(/<[a-z]/i);
    }
  });

  it('selects remote postings from the fixture thread', () => {
    const [thread] = pickThreads(fixture('hn-threads.json'));
    const items = select(toCandidates(topLevelComments(fixture('hn-comments.json'), META.thread.id), thread!), NOW);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => /remote/i.test(i.title))).toBe(true);
  });

  it('asks for top-level comments at the full page size, after since when given', () => {
    const params = (url: string) => new URL(url).searchParams;
    expect(params(commentsUrl('42')).get('hitsPerPage')).toBe('1000');
    expect(params(commentsUrl('42')).get('numericFilters')).toBe('parent_id=42');
    expect(params(commentsUrl('42', 1759300000)).get('numericFilters')).toBe('parent_id=42,created_at_i>=1759300000');
  });

  it('reads the title from the first paragraph, else from the whole text', () => {
    expect(titleOf('Acme | REMOTE<p>Body &amp; more')).toBe('Acme | REMOTE');
    expect(titleOf('Acme<br>Second line<p>Body')).toBe('Acme');
    expect(titleOf(' <i></i> <p>Acme | REMOTE<p>Body')).toBe('Acme | REMOTE');
    expect(titleOf('<p>Acme | REMOTE')).toBe('Acme | REMOTE');
    expect(titleOf('Acme | REMOTE')).toBe('Acme | REMOTE');
  });

  it('converts bodies lazily without changing titles or selection', () => {
    const [thread] = pickThreads(fixture('hn-threads.json'));
    const comments = topLevelComments(fixture('hn-comments.json'), META.thread.id);
    const lazy = select(toCandidates(comments, thread!), NOW);
    const eager = comments.map((c) => {
      const body = htmlToText(c.html);
      return { id: `hn:${c.id}`, source: 'hn' as const, where: threadLabel(thread!), title: firstLine(body), posted_at: c.created_at, url: itemUrl(c.id), body };
    });
    expect(toCandidates(comments, thread!).map((c) => c.title)).toEqual(eager.map((c) => c.title));
    expect(lazy.length).toBeGreaterThan(0);
    expect(lazy).toEqual(select(eager, NOW));
  });

  it('fetches a thread under a day old whole, last seven days only, when there is no baseline', async () => {
    const { urls, fetch } = recording(algolia());
    const loaded = await hn.load({ ...deps(fetch), now: YOUNG });
    expect(loaded.thread_at).toBe(META.thread.created_at);
    expect(loaded.posts.length).toBeGreaterThan(30);
    expect(loaded.error).toBeUndefined();
    const since = Math.floor((YOUNG.getTime() - 7 * 24 * HOUR) / 1000);
    expect(filtersOf(urls)).toEqual([`parent_id=${META.thread.id},created_at_i>=${since}`]);
  });

  it("serves no postings past a thread's first day without a baseline, and fetches none", async () => {
    const { urls, fetch } = recording(algolia());
    expect(await hn.load(deps(fetch))).toEqual({ posts: [], thread_at: META.thread.created_at, error: 'no baseline' });
    expect(filtersOf(urls)).toEqual([]);
  });

  it('reports truncated when Algolia matched more than it returned, and keeps the postings', async () => {
    const comments = fixture('hn-comments.json') as { hits: unknown[] };
    const load = (nbHits?: number) => hn.load({ ...deps(fakeFetch(algolia({ ...comments, ...(nbHits !== undefined && { nbHits }) }))), now: YOUNG });
    const cut = await load(comments.hits.length + 1);
    expect(cut.error).toBe('truncated');
    expect(cut.posts.length).toBeGreaterThan(30);
    expect((await load(comments.hits.length)).error).toBeUndefined();
    expect((await load()).error).toBeUndefined();
  });

  it('fails with the HTTP status code', async () => {
    await expect(hn.load(deps(fakeFetch({ author_whoishiring: new Response('', { status: 429 }) })))).rejects.toMatchObject({ code: '429' });
  });

  it('fails with schema when Algolia drops the hits array', async () => {
    await expect(hn.load(deps(fakeFetch({ author_whoishiring: { results: [] } })))).rejects.toMatchObject({ code: 'schema' });
  });

  it('fails with no thread when none is listed', async () => {
    await expect(hn.load(deps(fakeFetch({ author_whoishiring: { hits: [] } })))).rejects.toMatchObject({ code: 'no thread' });
  });

  it('reports an aborted fetch as timeout, not network', async () => {
    const controller = new AbortController();
    controller.abort();
    const aborting = (async (_: unknown, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return Response.json({ hits: [] });
    }) as unknown as typeof fetch;
    await expect(hn.load({ ...deps(aborting), signal: controller.signal })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('reports a deadline that fires mid-body as timeout, not parse', async () => {
    const controller = new AbortController();
    const stalled = (async () => {
      const response = Response.json({ hits: [] });
      // fetch cancels the body read when its signal aborts; the read then rejects with AbortError.
      response.json = () => {
        controller.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      };
      return response;
    }) as unknown as typeof fetch;
    await expect(hn.load({ ...deps(stalled), signal: controller.signal })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('fails with parse on a non-JSON body', async () => {
    const err = await hn.load(deps(fakeFetch({ author_whoishiring: new Response('<html>', { status: 200 }) }))).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err.code).toBe('parse');
  });
});

describe('hn baseline + delta', () => {
  const [thread] = pickThreads(fixture('hn-threads.json'));
  const comments = topLevelComments(fixture('hn-comments.json'), META.thread.id);
  const T0 = NOW.getTime() - 6 * HOUR;
  const older = comments.filter((c) => Date.parse(c.created_at) <= T0);
  /** What the job wrote a minute after T0, as read back from KV. */
  const stored = (overrides: Record<string, unknown> = {}) => JSON.parse(JSON.stringify({ ...buildBaseline(thread!, older, new Date(T0 + 60_000)), ...overrides }));
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  /** Algolia honouring the created_at_i filter, as the live API does. */
  function sinceAware(extra: { created_at: string; [field: string]: unknown }[] = [], fail: Record<string, number> = {}): { urls: string[]; fetch: typeof fetch } {
    const urls: string[] = [];
    const all = { hits: [...(fixture('hn-comments.json') as { hits: { created_at: string }[] }).hits, ...extra] };
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const failing = Object.keys(fail).find((k) => url.includes(k));
      if (failing) return new Response('', { status: fail[failing] });
      if (url.includes('author_whoishiring')) return Response.json(fixture('hn-threads.json'));
      const since = Number(/created_at_i>=(\d+)/.exec(new URL(url).searchParams.get('numericFilters') ?? '')?.[1] ?? 0);
      return Response.json({ hits: all.hits.filter((h) => Date.parse(h.created_at) >= since * 1000) });
    }) as typeof fetch;
    return { urls, fetch: fetchFn };
  }

  it('selects exactly what a full fetch would, from the baseline plus postings since its watermark', async () => {
    expect(older.length).toBeGreaterThan(0);
    expect(older.length).toBeLessThan(comments.length);
    const loaded = await hn.load({ ...deps(sinceAware().fetch), kv: kvWith(stored()) });
    expect(loaded.error).toBeUndefined();
    expect(select(loaded.posts, NOW)).toEqual(select(toCandidates(comments, thread!), NOW));
  });

  it('asks only for postings since the watermark, less five minutes', async () => {
    const { urls, fetch } = sinceAware();
    await hn.load({ ...deps(fetch), kv: kvWith(stored()) });
    const watermark = Math.floor(Date.parse(stored().watermark) / 1000);
    expect(filtersOf(urls)).toEqual([`parent_id=${META.thread.id},created_at_i>=${watermark - 300}`]);
  });

  it('keeps a baseline posting whose remote marker sits past the stored title cut', async () => {
    const long = { id: '99', created_at: ago(7 * HOUR), html: `Acme | Backend Engineer | ${'Berlin, '.repeat(25)}| REMOTE<p>About us` };
    const base = JSON.parse(JSON.stringify(buildBaseline(thread!, [long], new Date(T0 + 60_000))));
    expect(base.items.map((i: { title: string }) => i.title.includes('REMOTE'))).toEqual([false]);
    const loaded = await hn.load({ ...deps(sinceAware().fetch), kv: kvWith(base) });
    expect(select(loaded.posts, NOW).map((i) => i.id)).toContain('hn:99');
  });

  it('marks a baseline older than 9h stale since it was built, and keeps its postings', async () => {
    const loaded = await hn.load({ ...deps(sinceAware().fetch), kv: kvWith(stored({ generated: ago(10 * HOUR) })) });
    expect(loaded).toMatchObject({ error: 'stale', fetched_at: ago(10 * HOUR) });
    expect(loaded.posts.filter((p) => p.pregated).length).toBeGreaterThan(0);
  });

  it('drops the postings of a baseline older than 24h but still reports it stale since it was built', async () => {
    const loaded = await hn.load({ ...deps(sinceAware().fetch), kv: kvWith(stored({ generated: ago(25 * HOUR) })) });
    expect(loaded).toEqual({ posts: [], thread_at: META.thread.created_at, fetched_at: ago(25 * HOUR), error: 'stale' });
  });

  it('serves the baseline with the error code when Algolia fails, before or after the thread lookup', async () => {
    for (const failing of ['author_whoishiring', 'tags=comment']) {
      const loaded = await hn.load({ ...deps(sinceAware([], { [failing]: 503 }).fetch), kv: kvWith(stored()) });
      expect(loaded).toMatchObject({ error: '503', fetched_at: stored().generated, thread_at: META.thread.created_at });
      expect(loaded.posts).toHaveLength(stored().items.length);
      expect(loaded.posts.every((p) => p.pregated)).toBe(true);
    }
    await expect(hn.load(deps(sinceAware([], { author_whoishiring: 503 }).fetch))).rejects.toMatchObject({ code: '503' });
  });

  it('serves the baseline when Algolia is slower than its budget, before the source deadline', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const hanging = ((_: unknown, init?: RequestInit) =>
        new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
      const pending = hn.load({ ...deps(hanging), kv: kvWith(stored()) });
      await vi.advanceTimersByTimeAsync(ALGOLIA_BUDGET_MS);
      await expect(pending).resolves.toMatchObject({ error: 'timeout', fetched_at: stored().generated });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets the live copy of a posting win even when it now fails a gate', async () => {
    const posting = { objectID: '77', parent_id: Number(META.thread.id), created_at: new Date(T0 - 60_000).toISOString() };
    const before = topLevelComments({ hits: [{ ...posting, comment_text: 'Acme | Engineer | REMOTE' }] }, META.thread.id);
    const base = JSON.parse(JSON.stringify(buildBaseline(thread!, [...older, ...before], new Date(T0 + 60_000))));
    expect(base.items.map((i: { id: string }) => i.id)).toContain('hn:77');
    const edited = sinceAware([{ ...posting, comment_text: 'Acme | Engineer | Onsite only' }]);
    const loaded = await hn.load({ ...deps(edited.fetch), kv: kvWith(base) });
    expect(select(loaded.posts, NOW).map((i) => i.id)).not.toContain('hn:77');
  });

  it('reads the baseline while the thread lookup is in flight', async () => {
    const order: string[] = [];
    const threads = (async () => {
      await null;
      order.push('threads');
      return Response.json(fixture('hn-threads.json'));
    }) as unknown as typeof fetch;
    const kv = { get: (async () => (order.push('kv'), null)) as never };
    await hn.load({ ...deps(threads), kv });
    expect(order.slice(0, 2)).toEqual(['kv', 'threads']);
  });

  it('ignores a baseline for another thread', async () => {
    expect(await hn.load({ ...deps(sinceAware().fetch), kv: kvWith(stored({ thread_id: '1' })) })).toMatchObject({ posts: [], error: 'no baseline' });
  });

  it('reports a malformed baseline as schema and falls back as if there were none', async () => {
    expect(await hn.load({ ...deps(sinceAware().fetch), kv: kvWith({ items: 'x' }) })).toMatchObject({ posts: [], error: 'schema' });
    const young = await hn.load({ ...deps(sinceAware().fetch), now: YOUNG, kv: kvWith({ items: 'x' }) });
    expect(young.error).toBe('schema');
    expect(young.posts.length).toBeGreaterThan(0);
    expect(() => parseBaseline(stored({ watermark: 'soon' }))).toThrow(SourceError);
  });

  it('rebuilds item urls from validated ids and drops items that fail validation', () => {
    const item = { where: 'HN Who is hiring (Oct)', title: 'Acme | REMOTE', posted_at: ago(HOUR) };
    const parsed = parseBaseline(
      stored({
        items: [
          { ...item, id: 'hn:12', url: 'https://evil.example/' },
          { ...item, id: 'hn:x', url: itemUrl('1') },
          { ...item, id: 'yc:13', url: itemUrl('13') },
          { ...item, id: 'hn:14', posted_at: 'yesterday' },
        ],
      }),
    );
    expect(parsed.items).toEqual([{ ...item, id: 'hn:12', source: 'hn', url: itemUrl('12') }]);
  });
});

describe('yc adapter', () => {
  it('parses job stories with ids, titles and HN urls', () => {
    const posts = parseJobs(fixture('yc-jobs.json'));
    expect(posts.length).toBeGreaterThan(10);
    for (const p of posts) {
      expect(p.id).toMatch(/^yc:\d+$/);
      expect(p.where).toBe('HN jobs');
      expect(p.url).toBe(`https://news.ycombinator.com/item?id=${p.id.slice(3)}`);
    }
  });

  it('skips hits missing a title or time, and tolerates a missing story_text', () => {
    const posts = parseJobs({
      hits: [
        { objectID: '1', created_at: '2026-10-07T00:00:00Z' },
        { objectID: '2', title: 'Acme Is Hiring' },
        { objectID: '3', title: 'Acme Is Hiring (Remote)', created_at: '2026-10-07T00:00:00Z' },
      ],
    });
    expect(posts.map((p) => p.id)).toEqual(['yc:3']);
    expect(posts[0]?.body).toBe('');
  });

  it('loads through fetch', async () => {
    const loaded = await yc.load(deps(fakeFetch({ 'tags=job': fixture('yc-jobs.json') })));
    expect(loaded.posts.length).toBeGreaterThan(10);
  });
});
