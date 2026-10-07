import { describe, expect, it } from 'vitest';
import worker, { SECURITY_HEADERS } from '../src/worker.ts';

const env = {
  ASSETS: { fetch: async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) },
  BOARDS: {},
} as unknown as Env;

describe('worker', () => {
  it('answers /health with ok and security headers', async () => {
    const res = await worker.fetch(new Request('https://firsthour.1mb.dev/health') as never, env);
    expect(await res.text()).toBe('ok');
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers.get(name)).toBe(value);
  });

  it('adds security headers to static assets', async () => {
    const res = await worker.fetch(new Request('https://firsthour.1mb.dev/') as never, env);
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});
