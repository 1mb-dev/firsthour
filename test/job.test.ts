import { describe, expect, it } from 'vitest';
import { fetchJsonRetry, runJob } from '../src/job.ts';
import { buildBaseline, pickThreads, topLevelComments } from '../src/sources/hn.ts';
import { fixture, META, NOW } from './helpers.ts';

const ATS: Record<string, string> = {
  'api.ashbyhq.com': 'ashby.json',
  'boards-api.greenhouse.io': 'greenhouse.json',
  'api.lever.co': 'lever.json',
};

/** Fixture-backed Algolia and ATS; older threads answer with no postings. */
function sources(overrides: Record<string, () => Response> = {}): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const override = Object.keys(overrides).find((k) => url.includes(k));
    if (override) return overrides[override]!();
    if (url.includes('author_whoishiring')) return Response.json(fixture('hn-threads.json'));
    if (url.includes(`story_${META.thread.id}`)) return Response.json(fixture('hn-comments.json'));
    if (url.includes('story_')) return Response.json({ hits: [] });
    const host = Object.keys(ATS).find((h) => url.includes(h));
    return host ? Response.json(fixture(ATS[host]!)) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, urls };
}

const run = (fetchFn: typeof fetch) => runJob({ fetch: fetchFn, now: NOW, userAgent: 'test', retryDelayMs: 0 });

describe('runJob', () => {
  it('builds the boards snapshot and the hn baseline from one read of the threads', async () => {
    const { fetch, urls } = sources();
    const result = await run(fetch);
    expect(result.thread.id).toBe(META.thread.id);
    expect(result.boards.writable).toBe(true);
    expect(result.boards.snapshot.items.length).toBeGreaterThan(0);
    expect(result.baseline?.thread_id).toBe(META.thread.id);
    expect(result.baseline?.items.length).toBeGreaterThan(0);
    expect(result.baseline?.items.every((i) => i.source === 'hn')).toBe(true);
    expect(urls.filter((u) => u.includes(`story_${META.thread.id}`))).toHaveLength(1);
    expect(urls.filter((u) => u.includes('tags=comment'))).toHaveLength(3);
  });

  it('keeps bodies out of what it writes', async () => {
    const result = await run(sources().fetch);
    expect(JSON.stringify(result.baseline)).not.toMatch(/"body"/);
    expect(JSON.stringify(result.boards.snapshot)).not.toMatch(/"body"/);
  });

  it('withholds the baseline when Algolia truncates the current thread, and still builds boards', async () => {
    const comments = fixture('hn-comments.json') as { hits: unknown[] };
    const result = await run(sources({ [`story_${META.thread.id}`]: () => Response.json({ ...comments, nbHits: comments.hits.length + 1 }) }).fetch);
    expect(result.baseline).toBeNull();
    expect(result.boards.writable).toBe(true);
  });

  it('fails when no thread is listed', async () => {
    await expect(run(sources({ author_whoishiring: () => Response.json({ hits: [] }) }).fetch)).rejects.toMatchObject({ code: 'no thread' });
  });
});

describe('buildBaseline', () => {
  const [thread] = pickThreads(fixture('hn-threads.json'));
  const comments = topLevelComments(fixture('hn-comments.json'), META.thread.id);

  it('sets the watermark to the newest posting seen, not the build time', () => {
    const newest = Math.max(...comments.map((c) => Date.parse(c.created_at)));
    const baseline = buildBaseline(thread!, comments, NOW);
    expect(baseline.watermark).toBe(new Date(newest).toISOString());
    expect(baseline.generated).toBe(NOW.toISOString());
  });

  it('falls back to the thread time when the thread has no postings yet', () => {
    expect(buildBaseline(thread!, [], NOW).watermark).toBe(new Date(thread!.created_at).toISOString());
  });
});

describe('fetchJsonRetry', () => {
  function flaky(statuses: (number | 'network')[]): { fetch: typeof fetch; calls: () => number } {
    let calls = 0;
    const fetchFn = (async () => {
      const status = statuses[Math.min(calls++, statuses.length - 1)];
      if (status === 'network') throw new TypeError('fetch failed');
      return status === 200 ? Response.json({ ok: true }) : new Response('', { status });
    }) as unknown as typeof fetch;
    return { fetch: fetchFn, calls: () => calls };
  }

  it('retries network errors and 5xx, then succeeds', async () => {
    const f = flaky(['network', 503, 200]);
    await expect(fetchJsonRetry(f.fetch, 'https://x.test', 'test', 0)).resolves.toEqual({ ok: true });
    expect(f.calls()).toBe(3);
  });

  it('gives up after three attempts', async () => {
    const f = flaky([502]);
    await expect(fetchJsonRetry(f.fetch, 'https://x.test', 'test', 0)).rejects.toMatchObject({ code: '502' });
    expect(f.calls()).toBe(3);
  });

  it('does not retry a 4xx', async () => {
    const f = flaky([404]);
    await expect(fetchJsonRetry(f.fetch, 'https://x.test', 'test', 0)).rejects.toMatchObject({ code: '404' });
    expect(f.calls()).toBe(1);
  });
});
