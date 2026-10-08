// Cloudflare REST API reads made from CI scripts. The Worker never imports this.
import { isRecord } from './http.ts';

export const CF_API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 30_000;

export interface CfContext {
  fetch: typeof fetch;
  token: string;
  account: string;
  /** Overridable so tests run against a fake. */
  base?: string;
}

/** Cloudflare reports some failures as a 200 with `success: false`; both count as failure. */
export async function cfGet(ctx: CfContext, path: string): Promise<Record<string, unknown>> {
  const response = await ctx.fetch(`${ctx.base ?? CF_API}/accounts/${ctx.account}${path}`, {
    headers: { authorization: `Bearer ${ctx.token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => null);
  if (response.ok && isRecord(body) && body.success === true) return body;
  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors.filter(isRecord).map((e) => `${e.code} ${e.message}`) : [];
  throw new Error(`Cloudflare GET ${path}: HTTP ${response.status}${errors.length ? `, ${errors.join('; ')}` : ''}`);
}

/** Only whole-line `//` comments are stripped, so a comment after a value on the same line breaks the parse. */
export function workerName(wranglerJsonc: string): string {
  const config: unknown = JSON.parse(wranglerJsonc.replace(/^\s*\/\/.*$/gm, ''));
  if (!isRecord(config) || typeof config.name !== 'string') throw new Error('wrangler.jsonc has no name');
  return config.name;
}

/**
 * Why the deployment serving traffic is not `sha`, or null when it is. Cloudflare lists the active
 * deployment first; `wrangler deploy --message <sha>` puts the sha in its annotations.
 */
export function deploymentMismatch(body: Record<string, unknown>, sha: string): string | null {
  const deployments = isRecord(body.result) && Array.isArray(body.result.deployments) ? body.result.deployments : [];
  const active: unknown = deployments[0];
  if (!isRecord(active)) return 'no deployments listed';
  const versions = Array.isArray(active.versions) ? active.versions.filter(isRecord) : [];
  if (versions.length !== 1 || versions[0]!.percentage !== 100) return `active deployment ${String(active.id)} serves ${versions.length} versions, not one at 100%`;
  const message = isRecord(active.annotations) ? active.annotations['workers/message'] : undefined;
  if (message !== sha) return `active deployment ${String(active.id)} is ${JSON.stringify(message ?? null)}, not ${sha}`;
  return null;
}

export async function listDeployments(ctx: CfContext, script: string): Promise<Record<string, unknown>> {
  return cfGet(ctx, `/workers/scripts/${encodeURIComponent(script)}/deployments`);
}
