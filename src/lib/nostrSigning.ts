import { finalizeEvent } from 'nostr-tools/pure';

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2) hex = '0' + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Create and sign a Nostr event using nostr-tools
 */
export function signNostrEvent(
  privateKeyHex: string,
  kind: number,
  content: string,
  tags: string[][] = []
): NostrEvent {
  const secretKey = hexToBytes(privateKeyHex);

  const eventTemplate = {
    kind,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };

  const signedEvent = finalizeEvent(eventTemplate, secretKey);
  return signedEvent as NostrEvent;
}
