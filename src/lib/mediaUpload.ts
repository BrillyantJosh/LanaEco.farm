/**
 * Direct browser → media.lanaloves.us upload, signed with the user's
 * own secp256k1 private key. Each user attributes their own uploads.
 *
 * Two files are produced per logical image:
 *   • main  — original (or down-scaled) JPEG up to 1200 px
 *   • thumb — 400 px cover-crop JPEG q=0.6 for card previews
 *
 * Both URLs land in KIND events as parallel tags:
 *   ['image', mainUrl]
 *   ['thumb', thumbUrl]
 *
 * Backward compatibility: legacy `/api/uploads/...` URLs stay valid.
 *
 * Signing scheme (verified against media.lanaloves.us /docs):
 *   message  = "lana-media-upload:" + unixTimestampSec
 *   hash     = SHA-256(utf8(message))
 *   sig      = ECDSA secp256k1 (DER-hex)
 *   pubkey   = 64-char x-coordinate (Nostr style)
 */

import elliptic from 'elliptic';

const ec = new elliptic.ec('secp256k1');

export const MEDIA_BASE = 'https://media.lanaloves.us';

export interface MediaUploadResponse {
  filename: string;
  url: string;
  width?: number;
  height?: number;
  size: number;
  mime_type?: string;
  category?: string;
}

export interface UploadWithThumbResult {
  /** Main image URL (≤1200 px JPEG on media server). */
  url: string;
  /** Thumbnail URL (≤400 px square JPEG q=0.6 on media server). */
  thumbUrl: string;
  /** Main image bytes. */
  size: number;
  width?: number;
  height?: number;
  /** Set true when we returned the legacy `/api/uploads/...` fallback. */
  legacy?: boolean;
}

// ── Signing ─────────────────────────────────────────────────────────────────

async function sha256Hex(text: string): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return new Uint8Array(buf);
}

function buildAuthHeaders(
  privateKeyHex: string,
  hashBytes: Uint8Array,
  timestamp: number
): Record<string, string> {
  const keyPair = ec.keyFromPrivate(privateKeyHex, 'hex');
  const pubHex = keyPair.getPublic().getX().toString('hex').padStart(64, '0');
  const sigHex = keyPair.sign(hashBytes).toDER('hex');
  return {
    'X-Upload-Pubkey': pubHex,
    'X-Upload-Timestamp': String(timestamp),
    'X-Upload-Sig': sigHex,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Single-file upload. Signs with the given private key.
 * Throws on any non-2xx response with the server's error message.
 */
export async function uploadToMedia(
  file: File | Blob,
  privateKeyHex: string,
  filename = 'upload.jpg'
): Promise<MediaUploadResponse> {
  if (!privateKeyHex || !/^[0-9a-f]{64}$/i.test(privateKeyHex)) {
    throw new Error('uploadToMedia: invalid private key hex (need 64 chars)');
  }
  const ts = Math.floor(Date.now() / 1000);
  const hash = await sha256Hex(`lana-media-upload:${ts}`);
  const headers = buildAuthHeaders(privateKeyHex, hash, ts);

  const form = new FormData();
  form.append('file', file, filename);

  const res = await fetch(`${MEDIA_BASE}/api/upload`, {
    method: 'POST',
    headers,
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error || ''; } catch {}
    throw new Error(`Media upload failed (${res.status}): ${detail || res.statusText}`);
  }
  return res.json();
}

/**
 * Main + thumbnail in parallel. Returns both URLs.
 * If the media upload fails entirely, falls back to the legacy local
 * `/api/uploads` endpoint so the user's flow doesn't get stuck.
 */
export async function uploadImageWithThumb(
  file: File,
  privateKeyHex: string
): Promise<UploadWithThumbResult> {
  // Resize main to 1200 px max (media server caps at 1200 anyway)
  const mainBlob = await resizeForUpload(file, 1200, 0.85);
  const thumbBlob = await generateThumbnail(file, 400, 0.6);

  const baseName = stripExt(file.name) || 'image';

  try {
    const [main, thumb] = await Promise.all([
      uploadToMedia(mainBlob, privateKeyHex, `${baseName}.jpg`),
      uploadToMedia(thumbBlob, privateKeyHex, `${baseName}_thumb.jpg`),
    ]);
    return {
      url: main.url,
      thumbUrl: thumb.url,
      width: main.width,
      height: main.height,
      size: main.size,
    };
  } catch (e) {
    console.warn('[mediaUpload] media.lanaloves.us upload failed, falling back to local /api/uploads:', e);
    // Legacy fallback so the user can still publish.
    const fd = new FormData();
    fd.append('file', mainBlob, `${baseName}.jpg`);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    if (!res.ok) throw new Error('Both media server and local fallback failed');
    const d = await res.json();
    const abs = (u: string) => u?.startsWith('http') ? u : `${window.location.origin}${u}`;
    return {
      url: abs(d.url),
      thumbUrl: abs(d.thumbUrl || d.url),
      width: d.width,
      height: d.height,
      size: d.size,
      legacy: true,
    };
  }
}

/** Ephemeral key for anonymous uploads (e.g. /apply form). */
export function generateEphemeralPrivateKey(): string {
  const keyPair = ec.genKeyPair();
  return keyPair.getPrivate('hex').padStart(64, '0');
}

// ── Helpers (canvas resize) ──────────────────────────────────────────────────

function stripExt(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

async function resizeForUpload(file: File, maxDim: number, quality: number): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    // Unknown format — let media server handle it
    return file;
  }
  try {
    const img = await loadImage(URL.createObjectURL(file));
    const { width, height } = fitInside(img.naturalWidth, img.naturalHeight, maxDim);
    if (width === img.naturalWidth && height === img.naturalHeight && file.size < 1024 * 1024) {
      return file; // already small + correct dim
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/jpeg', quality);
    });
  } catch (e) {
    console.warn('[mediaUpload] resize failed, uploading original:', e);
    return file;
  }
}

export async function generateThumbnail(
  file: File,
  maxDim = 400,
  quality = 0.6
): Promise<Blob> {
  const img = await loadImage(URL.createObjectURL(file));
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  const target = Math.min(maxDim, side);

  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, target, target);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/jpeg', quality);
  });
}

function fitInside(w: number, h: number, max: number): { width: number; height: number } {
  if (w <= max && h <= max) return { width: w, height: h };
  const ratio = w / h;
  return ratio >= 1
    ? { width: max, height: Math.round(max / ratio) }
    : { width: Math.round(max * ratio), height: max };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to decode image'));
    img.src = src;
  });
}
