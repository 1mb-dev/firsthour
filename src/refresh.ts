import { parseSnapshot, SNAPSHOT_KEY } from './boards/snapshot.ts';
import { fetchJson } from './http.ts';
import { BASELINE_KEY, parseBaseline } from './sources/hn.ts';
import { SourceError } from './types.ts';

/** Where `snapshots.yml` publishes. A redirect means the Pages host changed: fail rather than follow. */
export const PAGES_BASE = 'https://1mb-dev.github.io/firsthour/';
const FETCH_TIMEOUT_MS = 10_000;
/** A `generated` this far ahead of the clock is refused: newer-only writes would freeze on it. */
const MAX_SKEW_MS = 5 * 60 * 1000;

const FILES = [
  { file: 'boards.json', key: SNAPSHOT_KEY, parse: parseSnapshot },
  { file: 'hn.json', key: BASELINE_KEY, parse: parseBaseline },
] as const;

export interface RefreshDeps {
  fetch: typeof fetch;
  kv: Pick<KVNamespace, 'get' | 'put'>;
  now: Date;
  userAgent: string;
  base?: string;
}

export interface Refreshed {
  key: string;
  outcome: 'wrote' | 'unchanged' | 'failed';
  detail: string;
}

function reason(error: unknown): string {
  if (error instanceof SourceError) return error.code;
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** A stored copy that no longer validates, or claims a future time, counts as absent so a good one can replace it. */
async function storedGenerated(kv: RefreshDeps['kv'], key: string, parse: (json: unknown) => { generated: string }, now: Date): Promise<number | null> {
  const stored: unknown = await kv.get(key, 'json').catch(() => null);
  if (stored === null) return null;
  try {
    const generated = Date.parse(parse(stored).generated);
    return generated > now.getTime() + MAX_SKEW_MS ? null : generated;
  } catch {
    return null;
  }
}

/**
 * Copies the published snapshots into KV, validated, when newer than what KV holds. The KV copy is
 * what survives a GitHub Pages outage, so nothing that fails validation may replace it.
 */
export async function refreshSnapshots(deps: RefreshDeps): Promise<Refreshed[]> {
  const base = deps.base ?? PAGES_BASE;
  return Promise.all(
    FILES.map(async ({ file, key, parse }): Promise<Refreshed> => {
      try {
        // The query steps past the Pages CDN cache (max-age 600). workerd has no redirect: 'error',
        // so 'manual': a redirect arrives as a 3xx and fails.
        const url = `${base}${file}?t=${deps.now.getTime()}`;
        const incoming = parse(await fetchJson(deps.fetch, url, deps.userAgent, AbortSignal.timeout(FETCH_TIMEOUT_MS), 'manual'));
        const generated = Date.parse(incoming.generated);
        if (generated > deps.now.getTime() + MAX_SKEW_MS) return { key, outcome: 'failed', detail: `generated ${incoming.generated} is in the future` };
        const current = await storedGenerated(deps.kv, key, parse, deps.now);
        if (current !== null && current >= generated) return { key, outcome: 'unchanged', detail: incoming.generated };
        await deps.kv.put(key, JSON.stringify(incoming));
        return { key, outcome: 'wrote', detail: incoming.generated };
      } catch (error) {
        return { key, outcome: 'failed', detail: reason(error) };
      }
    }),
  );
}
