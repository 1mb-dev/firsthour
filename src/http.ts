import { SourceError } from './types.ts';

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'));
}

/** With `redirect: 'manual'` a redirect is not followed: its 3xx fails like any other status. */
export async function fetchJson(fetchFn: typeof fetch, url: string, userAgent: string, signal: AbortSignal, redirect: RequestInit['redirect'] = 'follow'): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { 'user-agent': userAgent, accept: 'application/json' }, signal, redirect });
  } catch (error) {
    throw new SourceError(isAbort(error, signal) ? 'timeout' : 'network');
  }
  if (!response.ok) throw new SourceError(String(response.status));
  try {
    return await response.json();
  } catch (error) {
    // The deadline can fire mid-body; that is a slow upstream, not a schema problem.
    throw new SourceError(isAbort(error, signal) ? 'timeout' : 'parse');
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
