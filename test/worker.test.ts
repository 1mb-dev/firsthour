import { describe, expect, it } from 'vitest';
import { route, SECURITY_HEADERS } from '../src/app.ts';
import * as entry from '../src/worker.ts';
import type { PostsBody } from '../src/posts.ts';

const worker = entry.default;

const env = {
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  SNAPSHOTS: {},
} as unknown as Env;
const ctx = {} as ExecutionContext;

describe('worker', () => {
  it('exports only the default handler: workerd rejects other named exports as entrypoints', () => {
    expect(Object.keys(entry)).toEqual(['default']);
  });

  it('answers /health with ok and security headers', async () => {
    const res = await worker.fetch(new Request('https://firsthour.1mb.dev/health') as never, env, ctx);
    expect(await res.text()).toBe('ok');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
  });

  it('adds security headers to static assets', async () => {
    const res = await worker.fetch(new Request('https://firsthour.1mb.dev/') as never, env, ctx);
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  const body: PostsBody = { generated: '2026-10-07T16:00:00Z', stale: false, sources: [], next_thread: '2026-11-02T16:00:00Z', items: [] };

  it('serves /api/posts as uncached JSON with security headers', async () => {
    const res = await route(new Request('https://firsthour.1mb.dev/api/posts'), env, ctx, async () => body);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.json()).toEqual(body);
  });

  it('rejects non-GET on /api/posts', async () => {
    const res = await route(new Request('https://firsthour.1mb.dev/api/posts', { method: 'POST' }), env, ctx, async () => body);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
  });
});
