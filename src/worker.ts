import { route, USER_AGENT, type PostsLoader } from './app.ts';
import { buildPosts } from './posts.ts';
import { ADAPTERS } from './sources/index.ts';

// workerd treats every named export of the entry module as an entrypoint, so this file exports
// only the handler. Shared routing lives in app.ts.

// Phase 3 wraps this in the fresh/last-good cache.
const livePosts: PostsLoader = (env) =>
  buildPosts(ADAPTERS, { fetch: (input, init) => fetch(input, init), now: new Date(), userAgent: USER_AGENT, kv: env.SNAPSHOTS });

export default {
  fetch: (request, env, ctx) => route(request, env, ctx, livePosts),
} satisfies ExportedHandler<Env>;
