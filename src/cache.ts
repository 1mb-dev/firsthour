import { allFailed, type PostsBody } from './posts.ts';

export const FRESH_TTL_S = 300;
export const LAST_GOOD_TTL_S = 24 * 60 * 60;

/** The slice of the Cache API used here. */
export type PostsCache = Pick<Cache, 'match' | 'put'>;

function entry(body: PostsBody, ttlSeconds: number): Response {
  return Response.json(body, { headers: { 'cache-control': `max-age=${ttlSeconds}` } });
}

/**
 * Fresh for five minutes, then rebuilt. A rebuild where every source failed is never cached: it
 * serves the last good body marked stale, or itself when there is none.
 */
export async function cachedPosts(
  cache: PostsCache,
  origin: string,
  build: () => Promise<PostsBody>,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<PostsBody> {
  // Keyed on the request's origin: self-hosted copies run on their own domains.
  const freshKey = `${origin}/__cache/posts/fresh`;
  const lastGoodKey = `${origin}/__cache/posts/last-good`;
  const hit = await cache.match(freshKey);
  if (hit) return (await hit.json()) as PostsBody;

  const body = await build();
  if (!allFailed(body)) {
    waitUntil(Promise.all([cache.put(freshKey, entry(body, FRESH_TTL_S)), cache.put(lastGoodKey, entry(body, LAST_GOOD_TTL_S))]));
    return body;
  }
  const lastGood = await cache.match(lastGoodKey);
  return lastGood ? { ...((await lastGood.json()) as PostsBody), stale: true, sources: body.sources } : body;
}
