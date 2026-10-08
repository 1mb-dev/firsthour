import { route, USER_AGENT, type PostsLoader } from './app.ts';
import { cachedPosts } from './cache.ts';
import { buildPosts } from './posts.ts';
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

export default {
  fetch: (request, env, ctx) => route(request, env, ctx, livePosts),
} satisfies ExportedHandler<Env>;
