import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cfGet, deploymentMismatch, listDeployments, workerName, type CfContext } from '../src/cloudflare.ts';

/** Records each request and answers with `respond`. */
function fake(respond: () => Response): { ctx: CfContext; requests: { url: string; init: RequestInit }[] } {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return { ctx: { fetch: fetchFn, token: 'tok', account: 'acct', base: 'https://cf.test' }, requests };
}

describe('cfGet', () => {
  it('returns the body of a successful call, sending the token', async () => {
    const { ctx, requests } = fake(() => Response.json({ success: true, result: { a: 1 } }));
    expect(await cfGet(ctx, '/x')).toMatchObject({ result: { a: 1 } });
    expect(requests[0]!.url).toBe('https://cf.test/accounts/acct/x');
    expect((requests[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('fails on a non-2xx status, with the API error', async () => {
    const { ctx } = fake(() => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 }));
    await expect(cfGet(ctx, '/x')).rejects.toThrow('HTTP 403, 10000 Authentication error');
  });

  it('fails on a 200 that reports success: false', async () => {
    const { ctx } = fake(() => Response.json({ success: false, errors: [] }));
    await expect(cfGet(ctx, '/x')).rejects.toThrow('HTTP 200');
  });

  it('fails on a body that is not JSON', async () => {
    const { ctx } = fake(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(cfGet(ctx, '/x')).rejects.toThrow('HTTP 502');
  });
});

describe('workerName', () => {
  it('reads the name from the real wrangler.jsonc', () => {
    expect(workerName(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))).toBe('firsthour');
  });
});

describe('deploymentMismatch', () => {
  const SHA = 'f23c7ff0000000000000000000000000000000aa';
  const deployment = (message: string | undefined, versions = [{ version_id: 'v1', percentage: 100 }]) => ({
    id: 'd1',
    versions,
    ...(message !== undefined && { annotations: { 'workers/message': message } }),
  });
  const body = (...deployments: unknown[]) => ({ success: true, result: { deployments } });

  it('passes when the first deployment is this sha at 100%', () => {
    expect(deploymentMismatch(body(deployment(SHA), deployment('older')), SHA)).toBeNull();
  });

  it('fails when the active deployment is another commit', () => {
    expect(deploymentMismatch(body(deployment('older'), deployment(SHA)), SHA)).toContain('"older", not');
  });

  it('fails when the active deployment has no message', () => {
    expect(deploymentMismatch(body(deployment(undefined)), SHA)).toContain('null, not');
  });

  it('fails when traffic is split, even if this sha is one of them', () => {
    const split = [{ version_id: 'v1', percentage: 90 }, { version_id: 'v2', percentage: 10 }];
    expect(deploymentMismatch(body(deployment(SHA, split)), SHA)).toContain('serves 2 versions');
  });

  it('fails on an empty or malformed list', () => {
    expect(deploymentMismatch(body(), SHA)).toBe('no deployments listed');
    expect(deploymentMismatch({ success: true, result: null }, SHA)).toBe('no deployments listed');
  });
});

describe('listDeployments', () => {
  it('asks for the named script and fails on an API error', async () => {
    const ok = fake(() => Response.json({ success: true, result: { deployments: [] } }));
    await listDeployments(ok.ctx, 'firsthour');
    expect(ok.requests[0]!.url).toBe('https://cf.test/accounts/acct/workers/scripts/firsthour/deployments');
    const denied = fake(() => Response.json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, { status: 403 }));
    await expect(listDeployments(denied.ctx, 'firsthour')).rejects.toThrow('HTTP 403');
  });
});
