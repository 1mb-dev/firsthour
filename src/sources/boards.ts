import { parseSnapshot, SNAPSHOT_KEY } from '../boards/snapshot.ts';
import { SourceError, type Adapter } from '../types.ts';

const HOUR = 60 * 60 * 1000;
/** One missed 4-hourly run plus scheduler delay. */
export const STALE_AFTER_MS = 9 * HOUR;
export const DROP_AFTER_MS = 24 * HOUR;

export const boards: Adapter = {
  id: 'boards',
  async load({ kv, now }) {
    if (!kv) throw new SourceError('no kv');
    const raw = await kv.get(SNAPSHOT_KEY, 'json');
    if (raw === null) throw new SourceError('no snapshot');
    const snapshot = parseSnapshot(raw);
    const age = now.getTime() - Date.parse(snapshot.generated);
    // The snapshot was selected when built; items re-enter selection so the age window stays current.
    const posts = snapshot.items.map((item) => ({ ...item, body: '', remote: true }));
    if (age > DROP_AFTER_MS) return { posts: [], fetched_at: snapshot.generated, error: 'stale' };
    if (age > STALE_AFTER_MS) return { posts, fetched_at: snapshot.generated, error: 'stale' };
    return { posts, fetched_at: snapshot.generated };
  },
};
