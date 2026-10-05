/**
 * The portal's public + admin routers on a loopback port, for tests.
 */
import express from 'express';
import type Database from 'better-sqlite3';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { createListingsRouter } from '../routes/listings.js';
import { createAdminRouter } from '../routes/admin.js';
import { createUnitsRouter, UNITS_PATH } from './portal.js';

export interface TestApi {
  get(path: string, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  close(): Promise<void>;
}

export async function startApi(db: Database.Database): Promise<TestApi> {
  const app = express();
  app.use(express.json());
  app.use('/api/listings', createListingsRouter(db));
  app.use(UNITS_PATH, createUnitsRouter(db));
  app.use('/api/admin', createAdminRouter(db));
  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    async get(path, headers = {}) {
      const r = await fetch(base + path, { headers });
      const text = await r.text();
      let body: any = text;
      try { body = JSON.parse(text); } catch {}
      return { status: r.status, body };
    },
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
