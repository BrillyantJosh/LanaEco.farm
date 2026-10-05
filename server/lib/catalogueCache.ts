/**
 * Generation counter for the in-memory catalogue built by
 * server/routes/listings.ts. Every write that can change what GET
 * /api/listings shows — a listing / unit / 30902 / 30903 / KIND 5 upsert in
 * liveSync, the startup re-parse, an admin block or feature — calls
 * invalidateCatalogue(); the next request rebuilds.
 *
 * Kept separate (no imports) so liveSync and the admin routes can call it
 * without pulling in the listings route.
 */

let generation = 0;

export function invalidateCatalogue(): void {
  generation++;
}

export function catalogueGeneration(): number {
  return generation;
}
