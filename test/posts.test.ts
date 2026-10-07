import { describe, expect, it } from 'vitest';
import { allFailed, buildPosts } from '../src/posts.ts';
import { SourceError, type Adapter, type Deps, type SourceId } from '../src/types.ts';
import { candidate, minutesAgo, NOW } from './helpers.ts';

const deps: Deps = { fetch: fetch, now: NOW, userAgent: 'test' };

function ok(id: SourceId, n: number, extra: Partial<Awaited<ReturnType<Adapter['load']>>> = {}): Adapter {
  return {
    id,
    load: async () => ({
      posts: Array.from({ length: n }, (_, i) =>
        candidate({ id: `${id}:${i}`, source: id, title: `Acme | Engineer ${i} | REMOTE`, remote: true, posted_at: minutesAgo(i + 1) }),
      ),
      ...extra,
    }),
  };
}

function failing(id: SourceId, error: unknown): Adapter {
  return { id, load: () => Promise.reject(error) };
}

describe('buildPosts', () => {
  it('returns every source status and the merged items', async () => {
    const body = await buildPosts([ok('hn', 2, { thread_at: '2026-10-01T15:02:07Z' }), ok('yc', 1), ok('boards', 3, { fetched_at: minutesAgo(60) })], deps);
    expect(body.sources).toEqual([
      { id: 'hn', ok: true, fetched_at: NOW.toISOString(), error: null, count: 2 },
      { id: 'yc', ok: true, fetched_at: NOW.toISOString(), error: null, count: 1 },
      { id: 'boards', ok: true, fetched_at: minutesAgo(60), error: null, count: 3 },
    ]);
    expect(body.items).toHaveLength(6);
    expect(body.stale).toBe(false);
    expect(body.generated).toBe(NOW.toISOString());
  });

  it('one source failing returns the others plus its error status', async () => {
    const body = await buildPosts([ok('hn', 2), failing('yc', new SourceError('429')), ok('boards', 1)], deps);
    expect(body.sources.find((s) => s.id === 'yc')).toMatchObject({ ok: false, error: '429', count: 0 });
    expect(body.items.map((i) => i.source).sort()).toEqual(['boards', 'hn', 'hn']);
    expect(allFailed(body)).toBe(false);
  });

  it('a degraded source keeps its items and reports the error', async () => {
    const body = await buildPosts([ok('boards', 2, { error: 'stale' })], deps);
    expect(body.sources[0]).toMatchObject({ ok: false, error: 'stale', count: 2 });
    expect(body.items).toHaveLength(2);
  });

  it('times out a hung source without blocking the rest', async () => {
    const hung: Adapter = { id: 'yc', load: () => new Promise(() => {}) };
    const body = await buildPosts([ok('hn', 1), hung], deps, 20);
    expect(body.sources[1]).toMatchObject({ ok: false, error: 'timeout' });
    expect(body.items).toHaveLength(1);
  });

  it('reports a non-SourceError as internal, not as a source outage code', async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const body = await buildPosts([failing('hn', new TypeError('bug'))], deps);
      expect(body.sources[0]?.error).toBe('internal');
      expect(errors).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });

  it('flags every source failing', async () => {
    const body = await buildPosts([failing('hn', new SourceError('503')), failing('yc', new SourceError('timeout'))], deps);
    expect(allFailed(body)).toBe(true);
    expect(body.items).toEqual([]);
  });

  it('estimates the next thread, skipping the month whose thread is out', async () => {
    const body = await buildPosts([ok('hn', 0, { thread_at: '2026-10-01T15:02:07Z' })], deps);
    expect(body.next_thread).toBe('2026-11-02T16:00:00.000Z');
  });
});
