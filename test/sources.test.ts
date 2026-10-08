import { describe, expect, it } from 'vitest';
import { select } from '../src/select.ts';
import { commentsUrl, hn, pickThreads, threadLabel, toCandidates, topLevelComments } from '../src/sources/hn.ts';
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

  it('loads only the last seven days of the thread', async () => {
    const urls: string[] = [];
    const routes = fakeFetch({ author_whoishiring: fixture('hn-threads.json'), [`story_${META.thread.id}`]: fixture('hn-comments.json') });
    await hn.load(deps(((input, init) => (urls.push(String(input)), routes(input, init))) as typeof fetch));
    const since = Math.floor((NOW.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000);
    expect(urls.map((u) => new URL(u).searchParams.get('numericFilters'))).toContain(`parent_id=${META.thread.id},created_at_i>=${since}`);
  });

  it('reports truncated when Algolia matched more than it returned, and keeps the postings', async () => {
    const comments = fixture('hn-comments.json') as { hits: unknown[] };
    const load = (nbHits?: number) =>
      hn.load(deps(fakeFetch({ author_whoishiring: fixture('hn-threads.json'), [`story_${META.thread.id}`]: { ...comments, ...(nbHits !== undefined && { nbHits }) } })));
    const cut = await load(comments.hits.length + 1);
    expect(cut.error).toBe('truncated');
    expect(cut.posts.length).toBeGreaterThan(30);
    expect((await load(comments.hits.length)).error).toBeUndefined();
    expect((await load()).error).toBeUndefined();
  });

  it('loads end to end through fetch', async () => {
    const loaded = await hn.load(deps(fakeFetch({ author_whoishiring: fixture('hn-threads.json'), [`story_${META.thread.id}`]: fixture('hn-comments.json') })));
    expect(loaded.thread_at).toBe(META.thread.created_at);
    expect(loaded.posts.length).toBeGreaterThan(30);
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
