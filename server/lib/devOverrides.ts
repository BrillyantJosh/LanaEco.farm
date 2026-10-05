/**
 * Dev-only escape hatches (SPEC §12) — hardened so they cannot be armed in
 * production even by accident.
 *
 * The first version gated only on `NODE_ENV !== 'production'`, but our
 * docker-compose does not set NODE_ENV at all, so in production that gate is
 * OPEN. Two further conditions close it for real:
 *
 *   1. an override relay must be LOOPBACK. A leaked or injected env var can
 *      then only point this process at a relay that does not exist on the VPS,
 *      which fails loudly, instead of silently mirroring a stranger's relay.
 *   2. the trusted-signer override is honoured ONLY together with (1). That
 *      list is the money-truth trust anchor (which KIND 30933 authors we
 *      believe), so it must never be repointable while the process is still
 *      reading production relays.
 */
const LOOPBACK = /^wss?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/.*)?$/i;
const HEX64 = /^[0-9a-f]{64}$/;

const rawRelays = String(process.env.LANA_RELAYS_OVERRIDE || '').trim();

/** Loopback relays to use instead of KIND 38888's; empty = use KIND 38888. */
export const devRelays: string[] =
  process.env.NODE_ENV === 'production'
    ? []
    : rawRelays.split(',').map(s => s.trim()).filter(s => LOOPBACK.test(s));

/** KIND 30933 authors to trust instead of KIND 38888's; empty = use KIND 38888. */
export const devTrustedSigners: string[] = devRelays.length
  ? String(process.env.LANA_TRUSTED_SIGNERS_OVERRIDE || '')
      .split(',').map(s => s.trim().toLowerCase()).filter(s => HEX64.test(s))
  : [];

/**
 * KIND 38888 author to trust instead of the production system-params key
 * (KIND_38888_PUBKEY, the name the broker and the merchant app read); '' =
 * the production key. Honoured only together with a loopback relay override,
 * like the signer override: the 38888 decides the relays and the trusted
 * 30933 signers.
 */
const rawAuthor = String(process.env.KIND_38888_PUBKEY || '').trim().toLowerCase();
export const dev38888Author: string = devRelays.length && HEX64.test(rawAuthor) ? rawAuthor : '';

if (rawRelays && !devRelays.length) {
  console.warn(
    `[dev-override] LANA_RELAYS_OVERRIDE=${JSON.stringify(rawRelays)} IGNORED ` +
    '(production build, or not a loopback ws:// URL) — using the KIND 38888 relays.',
  );
}
