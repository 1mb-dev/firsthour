import pkg from '../package.json' with { type: 'json' };
import type { PostsBody } from './posts.ts';

export const USER_AGENT = `firsthour/${pkg.version} (+https://github.com/1mb-dev/firsthour)`;

// Cloudflare's edge injects two scripts into HTML. The Web Analytics beacon is served from a versioned path under
// beacon.min.js/, and a CSP path without a trailing slash matches only itself, so both forms are listed. The
// JavaScript detections script is inline; the edge copies the nonce it parses from this header onto it.
const BEACON = 'https://static.cloudflareinsights.com/beacon.min.js https://static.cloudflareinsights.com/beacon.min.js/';

function csp(scripts: string): string {
  return `default-src 'none'; script-src ${scripts}; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': csp("'self'"),
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

/** HTML gets a fresh nonce per response. JSD strips ETags from the HTML it injects into, so no cached body outlives its nonce. */
export function withSecurityHeaders(response: Response): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) secured.headers.set(name, value);
  if (secured.headers.get('content-type')?.startsWith('text/html')) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    secured.headers.set('content-security-policy', csp(`'self' 'nonce-${nonce}' ${BEACON}`));
  }
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
