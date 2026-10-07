// Fixture-backed Worker for `make mock`: the real routing and sources, fed recorded responses.
// Never deployed. Visit /__mock/<state> to switch state (a cookie), then /.

import ashby from '../fixtures/ashby.json' with { type: 'json' };
import greenhouse from '../fixtures/greenhouse.json' with { type: 'json' };
import comments from '../fixtures/hn-comments.json' with { type: 'json' };
import threads from '../fixtures/hn-threads.json' with { type: 'json' };
import lever from '../fixtures/lever.json' with { type: 'json' };
import meta from '../fixtures/meta.json' with { type: 'json' };
import yc from '../fixtures/yc-jobs.json' with { type: 'json' };
import type { Board } from '../../src/boards/discover.ts';
import { buildSnapshot, SNAPSHOT_KEY } from '../../src/boards/snapshot.ts';
import { buildPosts, type PostsBody } from '../../src/posts.ts';
import { ADAPTERS } from '../../src/sources/index.ts';
import { route, USER_AGENT, withSecurityHeaders } from '../../src/worker.ts';

const STATES = ['success', 'empty', 'partial', 'stale', 'down', 'error'] as const;
type State = (typeof STATES)[number];

const RECORDED = new Date(meta.recorded_at);
const BOARD_JSON: Record<string, unknown> = { ashby, greenhouse, lever };

function fixtureFetch(failing: readonly string[]): typeof fetch {
  const routes: [string, unknown][] = [
    ['author_whoishiring', threads],
    ['story_', comments],
    ['tags=job', yc],
  ];
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (failing.some((f) => url.includes(f))) return new Response('', { status: 429 });
    const hit = routes.find(([key]) => url.includes(key));
    return hit ? Response.json(hit[1]) : new Response('not found', { status: 404 });
  }) as typeof fetch;
}

async function fixtureKv(now: Date, missing: boolean): Promise<Pick<KVNamespace, 'get'>> {
  const run = await buildSnapshot(meta.boards as Board[], async (b) => BOARD_JSON[b.platform], now);
  return { get: (async (key: string) => (key === SNAPSHOT_KEY && !missing ? run.snapshot : null)) as never };
}

/**
 * Moves item times so the newest post is `newestAgo` ms old against the real clock. Status times
 * read as just fetched, and the boards snapshot as two hours old.
 */
function shift(body: PostsBody, newestAgo = 12 * 60_000): PostsBody {
  const now = Date.now();
  const newest = Math.max(...body.items.map((i) => Date.parse(i.posted_at)), 0);
  const offset = newest ? now - newestAgo - newest : 0;
  const fetched = new Date(now - 60_000).toISOString();
  return {
    ...body,
    generated: fetched,
    sources: body.sources.map((s) => ({ ...s, fetched_at: s.id === 'boards' ? new Date(now - 2 * 3_600_000).toISOString() : fetched })),
    items: body.items.map((i) => ({ ...i, posted_at: new Date(Date.parse(i.posted_at) + offset).toISOString() })),
  };
}

async function load(state: State): Promise<PostsBody> {
  const now = state === 'empty' ? new Date(RECORDED.getTime() + 30 * 86_400_000) : RECORDED;
  const failing = state === 'partial' ? ['tags=job'] : state === 'down' ? ['algolia'] : [];
  const kv = await fixtureKv(now, state === 'down');
  const body = await buildPosts(ADAPTERS, { fetch: fixtureFetch(failing), now, userAgent: USER_AGENT, kv });
  if (state !== 'stale') return shift(body);
  // Every source failed; the Worker serves the last good copy from three hours ago.
  const stale = shift(body, 3 * 3_600_000);
  const lastGood = new Date(Date.now() - 3 * 3_600_000).toISOString();
  return {
    ...stale,
    generated: lastGood,
    stale: true,
    sources: stale.sources.map((s, i) => ({ ...s, ok: false, error: ['503', 'timeout', 'no snapshot'][i] ?? 'timeout', fetched_at: new Date().toISOString() })),
  };
}

function stateOf(request: Request): State {
  const match = /(?:^|;\s*)fh_state=([a-z]+)/.exec(request.headers.get('cookie') ?? '');
  return STATES.find((s) => s === match?.[1]) ?? 'success';
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const pick = /^\/__mock\/([a-z]+)$/.exec(pathname)?.[1];
    if (pick && STATES.includes(pick as State)) {
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': `fh_state=${pick}; Path=/; SameSite=Strict` } });
    }
    const state = stateOf(request);
    if (pathname === '/api/posts' && state === 'error') return withSecurityHeaders(new Response('Bad gateway', { status: 502 }));
    return route(request, env, ctx, () => load(state));
  },
} satisfies ExportedHandler<Env>;
