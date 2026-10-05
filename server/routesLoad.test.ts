// @vitest-environment node
/**
 * SMOKE TEST: every server module must at least LOAD.
 *
 * The server runs through tsx and is never compiled, `npm run build` is the
 * client only, and a module no test imports can carry a syntax error, a bad
 * import or a backtick inside a SQL comment (which ends the template literal
 * it lives in — direct.lana.fund was down ~75 min from one) straight into
 * production. Ported from lana-direct-fund server/tests/routesLoad.test.ts.
 *
 * Left out on purpose: index.ts (starts the HTTP listener and liveSync, which
 * talks to the production relays) and scripts/ (settle-review.ts runs on
 * import and opens the real database). Loading IS the assertion.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const serverDir = dirname(fileURLToPath(import.meta.url));

/** Every .ts under server/, minus tests, test helpers, scripts and iCloud "X 2.ts" copies. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (['test', 'tests', 'scripts', 'node_modules'].includes(e.name) || e.name.startsWith('.')) continue;
      sourceFiles(full, out);
    } else if (e.name.endsWith('.ts') && !e.name.includes('.test.') && !/ \d+\.ts$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(serverDir).filter(f => relative(serverDir, f) !== 'index.ts');

describe('server modules', () => {
  it('every one parses and imports cleanly', async () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
    const broken: string[] = [];
    for (const f of files) {
      try {
        await import(pathToFileURL(f).href);
      } catch (err) {
        broken.push(`${relative(serverDir, f)}: ${(err as Error).message}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('no backtick inside a -- SQL comment of a template literal', () => {
    const hits: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        // a SQL comment line inside a template literal: leading "--"
        if (/^\s*--.*`/.test(line)) hits.push(`${relative(serverDir, f)}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
