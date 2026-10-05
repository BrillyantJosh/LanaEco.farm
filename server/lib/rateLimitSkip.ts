/**
 * Which requests the global rate limiter (server/index.ts) leaves out: the
 * page's own static files, so a shopper whose order status page polls the
 * API is never starved by the JS/CSS/images of that same page.
 *
 * Judged by `req.path`, never `req.url`: `url` carries the query string, so
 * `POST /api/uploads?x.jpg` or `GET /api/listings?x=.js` used to skip the
 * limiter and lift the global limit from every route without a limiter of
 * its own. Only GET / HEAD can be a static file; under /api/ only the served
 * uploads (GET /api/uploads/<file>) are files — every other /api/ path is
 * real work (GET /api/listings/<pubkey>/<id>.js still scans the catalogue).
 */
const STATIC_EXT_RE = /\.(?:js|css|png|ico|jpe?g|svg|woff2?|webp|gif)$/i;

export function isStaticAssetRequest(req: { method: string; path: string }): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = String(req.path || '');
  if (p.startsWith('/assets/')) return true;
  if (!STATIC_EXT_RE.test(p)) return false;
  if (p.startsWith('/api/')) return p.startsWith('/api/uploads/');
  return true;
}
