import { route, USER_AGENT, type PostsLoader } from './app.ts';
import { cachedPosts } from './cache.ts';
import { buildPosts } from './posts.ts';
import { refreshSnapshots } from './refresh.ts';
import { ADAPTERS } from './sources/index.ts';

// workerd treats every named export of the entry module as an entrypoint, so this file exports
// only the handler. Shared routing lives in app.ts.

const livePosts: PostsLoader = (request, env, ctx) =>
  cachedPosts(
    caches.default,
    new URL(request.url).origin,
    () => buildPosts(ADAPTERS, { fetch: (input, init) => fetch(input, init), now: new Date(), userAgent: USER_AGENT, kv: env.SNAPSHOTS }),
    (promise) => ctx.waitUntil(promise),
  );

/** Throws when any key failed, so the cron run itself shows as failed, not only its log lines. */
async function refresh(env: Env): Promise<void> {
  const results = await refreshSnapshots({ fetch: (input, init) => fetch(input, init), kv: env.SNAPSHOTS, now: new Date(), userAgent: USER_AGENT });
  for (const { key, outcome, detail } of results) (outcome === 'failed' ? console.error : console.log)(`refresh ${key} ${outcome}: ${detail}`);
  const failed = results.filter((r) => r.outcome === 'failed').map((r) => r.key);
  if (failed.length) throw new Error(`snapshot refresh failed: ${failed.join(', ')}`);
}

export default {
  fetch: (request, env, ctx) => route(request, env, ctx, livePosts),
  scheduled: (_controller, env, ctx) => ctx.waitUntil(refresh(env)),
} satisfies ExportedHandler<Env>;
