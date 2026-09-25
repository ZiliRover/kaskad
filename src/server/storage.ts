/**
 * File storage. Local disk for now; the interface is what an S3-compatible
 * implementation (Yandex Object Storage / Selectel) will provide later.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// runtime data dir, not part of the build: keep the bundler from tracing it
const DIR = process.env.STORAGE_DIR ?? "storage";
const ROOT = path.isAbsolute(DIR) ? DIR : path.join(/* turbopackIgnore: true */ process.cwd(), DIR);

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/svg+xml": "svg", "video/mp4": "mp4", "video/webm": "webm",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));

const KEY_RE = /^(uploads|outputs)\/[a-z0-9-]+(\/[a-z0-9-]+)?\.[a-z0-9]+$/;

export function isValidKey(key: string): boolean {
  return KEY_RE.test(key);
}

export function mimeForKey(key: string): string {
  return MIME_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream";
}

export function newKey(prefix: "uploads" | `outputs/${string}`, mime: string): string {
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
