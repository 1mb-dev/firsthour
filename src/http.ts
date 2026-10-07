import { SourceError } from './types.ts';

export async function fetchJson(
  fetchFn: typeof fetch,
  url: string,
  userAgent: string,
  timeoutMs: number,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { 'user-agent': userAgent, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new SourceError(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!response.ok) throw new SourceError(String(response.status));
  try {
    return await response.json();
  } catch {
    throw new SourceError('parse');
  }
}

/** Narrowing helpers for untrusted JSON. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function hitsOf(json: unknown): unknown[] {
  if (!isRecord(json) || !Array.isArray(json.hits)) throw new SourceError('schema');
  return json.hits;
}
