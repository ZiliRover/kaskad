/**
 * File storage. Local disk for now; the interface is what an S3-compatible
 * implementation (Yandex Object Storage / Selectel) will provide later.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// runtime data dir, not part of the build: keep the bundler from tracing it
const DIR = process.env.STORAGE_DIR ?? "storage";
const ROOT = path.isAbsolute(DIR) ? DIR : path.join(/* turbopackIgnore: true */ process.cwd(), DIR);

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/svg+xml": "svg", "video/mp4": "mp4", "video/webm": "webm",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a",
  "audio/x-m4a": "m4a", "audio/ogg": "ogg",
};
// first mime listed for an extension is canonical
const MIME_BY_EXT: Record<string, string> = {};
for (const [m, e] of Object.entries(EXT_BY_MIME)) MIME_BY_EXT[e] ??= m;

const KEY_RE = /^(uploads|outputs)\/[a-z0-9-]+(\/[a-z0-9-]+)?\.[a-z0-9]+$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function mimeForKey(key: string): string {
  return MIME_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream";
}

export function newKey(prefix: `uploads/${string}` | `outputs/${string}`, mime: string): string {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error(`unsupported mime ${mime}`);
  return `${prefix}/${randomUUID()}.${ext}`;
}

function abs(key: string): string {
  if (!isValidKey(key)) throw new Error(`invalid storage key ${key}`);
  return path.join(ROOT, key);
}

export async function putFile(key: string, data: Uint8Array): Promise<void> {
  const p = abs(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function readStored(key: string): Promise<Buffer> {
  return readFile(abs(key));
}

export async function statStored(key: string): Promise<{ size: number } | null> {
  try {
    const s = await stat(abs(key));
    return { size: s.size };
  } catch {
    return null;
  }
}

export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}

export async function asDataUrl(key: string): Promise<string> {
  const buf = await readStored(key);
  return `data:${mimeForKey(key)};base64,${buf.toString("base64")}`;
}

export function storagePath(key: string): string {
  return abs(key);
}

// ---------------------------------------------------------------- links for providers


/**
 * Providers fetch video and audio inputs themselves and accept only public https links,
 * so the server hands out short-lived signed URLs to its own files. Needs PUBLIC_BASE_URL
 * (the https address the internet reaches this server at).
 */
function signingSecret(): string {
  return process.env.FILE_URL_SECRET?.trim()
    // same value in the web and worker processes without extra setup
    || createHash("sha256").update(`kaskad-files:${process.env.DATABASE_URL ?? ""}`).digest("hex");
}

function signature(key: string, exp: number): string {
  return createHmac("sha256", signingSecret()).update(`${key}:${exp}`).digest("base64url");
}

export function publicBaseUrl(): string | null {
  const base = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  return base && base.startsWith("https://") ? base : null;
}

export function signedFileUrl(key: string, ttlSec = 3 * 60 * 60): string | null {
  const base = publicBaseUrl();
  if (!base) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  return `${base}${fileUrl(key)}?exp=${exp}&sig=${signature(key, exp)}`;
}

/** true = valid, false = present but invalid/expired */
export function checkSignature(key: string, exp: string | null, sig: string | null): boolean {
  if (!exp || !sig) return false;
  const e = Number(exp);
  if (!Number.isFinite(e) || e < Date.now() / 1000) return false;
  const want = Buffer.from(signature(key, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
