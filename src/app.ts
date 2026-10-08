import pkg from '../package.json' with { type: 'json' };
import type { PostsBody } from './posts.ts';

export const USER_AGENT = `firsthour/${pkg.version} (+https://github.com/1mb-dev/firsthour)`;

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  return secured;
}

export type PostsLoader = (request: Request, env: Env, ctx: ExecutionContext) => Promise<PostsBody>;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** Routing shared by the production Worker and the fixture-backed mock (`make mock`). */
export async function route(request: Request, env: Env, ctx: ExecutionContext, loadPosts: PostsLoader): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/health') return withSecurityHeaders(new Response('ok'));
  if (pathname === '/api/posts') {
    if (request.method !== 'GET') return withSecurityHeaders(new Response('method not allowed', { status: 405, headers: { allow: 'GET' } }));
    return withSecurityHeaders(json(await loadPosts(request, env, ctx)));
  }
  return withSecurityHeaders(await env.ASSETS.fetch(request));
}
