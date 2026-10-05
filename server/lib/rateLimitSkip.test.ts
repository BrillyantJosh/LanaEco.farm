// @vitest-environment node
/**
 * The global limiter's skip (server/index.ts) on a loopback express app with
 * the real express-rate-limit: a query string that ends in ".jpg" must not
 * lift the limit (it did when the skip tested req.url), and only GET/HEAD of
 * a page file is left out.
 */
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { isStaticAssetRequest } from './rateLimitSkip.js';

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function limitedApp(max: number): Promise<string> {
  const app = express();
  app.use(rateLimit({ windowMs: 60_000, max, standardHeaders: true, legacyHeaders: false, skip: req => isStaticAssetRequest(req) }));
  app.post('/api/uploads', (_req, res) => { res.json({ ok: true }); });
  app.get('/api/listings', (_req, res) => { res.json([]); });
  app.get('/api/listings/:pubkey/:listingId', (_req, res) => { res.status(404).json({}); });
  app.get('/assets/app.js', (_req, res) => { res.type('js').send(''); });
  server = await new Promise<Server>(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function statuses(url: string, n: number, method = 'GET'): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await fetch(url, { method })).status);
  return out;
}

describe('global limiter skip', () => {
  it('a query string ending in .jpg / .js no longer lifts the limit', async () => {
    const base = await limitedApp(3);
    expect(await statuses(`${base}/api/uploads?x.jpg`, 5, 'POST')).toEqual([200, 200, 200, 429, 429]);
    expect(await statuses(`${base}/api/listings?x=.js`, 1)).toEqual([429]);
  });

  it('the page files are still left out, also once the limit is used up', async () => {
    const base = await limitedApp(1);
    expect(await statuses(`${base}/api/listings`, 2)).toEqual([200, 429]);
    expect(await statuses(`${base}/assets/app.js`, 3)).toEqual([200, 200, 200]);
  });

  it('decides by method and path', () => {
    expect(isStaticAssetRequest({ method: 'GET', path: '/assets/index-abc.js' })).toBe(true);
    expect(isStaticAssetRequest({ method: 'HEAD', path: '/favicon.png' })).toBe(true);
    expect(isStaticAssetRequest({ method: 'GET', path: '/api/uploads/5f.jpg' })).toBe(true);
    // a POST is never a page file, whatever its path
    expect(isStaticAssetRequest({ method: 'POST', path: '/api/uploads' })).toBe(false);
    expect(isStaticAssetRequest({ method: 'POST', path: '/assets/x.js' })).toBe(false);
    // an API route whose id ends like a file is still real work
    expect(isStaticAssetRequest({ method: 'GET', path: '/api/listings/ab/cd.js' })).toBe(false);
    expect(isStaticAssetRequest({ method: 'GET', path: '/api/orders/x.css' })).toBe(false);
    expect(isStaticAssetRequest({ method: 'GET', path: '/api/listings' })).toBe(false);
  });
});
