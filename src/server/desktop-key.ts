/**
 * The desktop app's OpenRouter key: the person enters it on /setup, it lives in a settings
 * file in their profile (KASKAD_DESKTOP_CONFIG), and both the web server and the worker read
 * it from there, so changing it needs no restart. No database import: the provider client uses it.
 */
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

interface DesktopConfig { openrouterKey?: string }

const configPath = () => process.env.KASKAD_DESKTOP_CONFIG?.trim() || "";

let cached: { mtimeMs: number; key: string | null } | null = null;

export function desktopKey(): string | null {
  const file = configPath();
  if (!file) return null;
  try {
    const { mtimeMs } = statSync(/*turbopackIgnore: true*/ file);
    if (cached?.mtimeMs === mtimeMs) return cached.key;
    const cfg = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as DesktopConfig;
    const key = typeof cfg.openrouterKey === "string" && cfg.openrouterKey.trim() ? cfg.openrouterKey.trim() : null;
    cached = { mtimeMs, key };
    return key;
  } catch {
    return null; // no settings yet
  }
}

export function saveDesktopKey(key: string) {
  const file = configPath();
  if (!file) throw new Error("KASKAD_DESKTOP_CONFIG is not set");
  mkdirSync(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  let cfg: DesktopConfig = {};
  try { cfg = JSON.parse(readFileSync(/*turbopackIgnore: true*/ file, "utf8")); } catch { /* first save */ }
  // write-then-rename: the worker never reads a half-written file
  const tmp = `${file}.tmp`;
  writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify({ ...cfg, openrouterKey: key }, null, 2), { mode: 0o600 });
  renameSync(/*turbopackIgnore: true*/ tmp, file);
  cached = null;
}

/** Ask OpenRouter whether a key works before keeping it. */
export async function checkOpenRouterKey(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000), cache: "no-store",
    });
    if (r.status === 401 || r.status === 403) return { ok: false, error: "OpenRouter не принял этот ключ. Проверьте, что скопировали его целиком." };
    if (!r.ok) return { ok: false, error: `OpenRouter ответил ошибкой ${r.status}. Попробуйте ещё раз.` };
    return { ok: true };
  } catch {
    return { ok: false, error: "Не удалось связаться с OpenRouter. Проверьте интернет." };
  }
}
