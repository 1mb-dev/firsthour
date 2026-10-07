import { isRecord, str } from '../http.ts';
import { select } from '../select.ts';
import { SourceError, type Candidate, type Item } from '../types.ts';
import { parseBoard } from './ats.ts';
import type { Board } from './discover.ts';

export const SNAPSHOT_KEY = 'boards:latest';

export interface Snapshot {
  generated: string;
  boards_total: number;
  boards_ok: number;
  items: Item[];
}

export interface BoardFailure {
  board: Board;
  error: string;
}

export interface SnapshotRun {
  snapshot: Snapshot;
  failures: BoardFailure[];
  /** False when under half the boards answered: keep the previous snapshot instead. */
  writable: boolean;
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function buildSnapshot(
  boards: readonly Board[],
  fetchBoard: (board: Board) => Promise<unknown>,
  now: Date,
  concurrency = 6,
): Promise<SnapshotRun> {
  const failures: BoardFailure[] = [];
  const perBoard = await mapLimit(boards, concurrency, async (board): Promise<Candidate[]> => {
    try {
      return parseBoard(board, await fetchBoard(board));
    } catch (error) {
      failures.push({ board, error: error instanceof SourceError ? error.code : String(error) });
      return [];
    }
  });
  const boardsOk = boards.length - failures.length;
  return {
    snapshot: {
      generated: now.toISOString(),
      boards_total: boards.length,
      boards_ok: boardsOk,
      items: select(perBoard.flat(), now),
    },
    failures,
    writable: boards.length > 0 && boardsOk >= boards.length / 2,
  };
}

const URL_PREFIXES = ['https://jobs.ashbyhq.com/', 'https://job-boards.greenhouse.io/', 'https://jobs.lever.co/'];

/** Validates a snapshot read back from KV. Items that fail validation are dropped, not trusted. */
export function parseSnapshot(json: unknown): Snapshot {
  if (!isRecord(json) || !Array.isArray(json.items)) throw new SourceError('schema');
  const generated = str(json.generated);
  if (!generated || !Number.isFinite(Date.parse(generated))) throw new SourceError('schema');
  const items: Item[] = [];
  for (const raw of json.items) {
    if (!isRecord(raw)) continue;
    const id = str(raw.id);
    const where = str(raw.where);
    const title = str(raw.title);
    const posted = str(raw.posted_at);
    const url = str(raw.url);
    if (!id?.startsWith('boards:') || !where || !title || !posted || !url) continue;
    if (!URL_PREFIXES.some((p) => url.startsWith(p))) continue;
    items.push({ id, source: 'boards', where, title, posted_at: posted, url });
  }
  return {
    generated,
    boards_total: typeof json.boards_total === 'number' ? json.boards_total : 0,
    boards_ok: typeof json.boards_ok === 'number' ? json.boards_ok : 0,
    items,
  };
}
