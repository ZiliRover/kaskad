/**
 * Free stand-in for OpenRouter (PROVIDER_MODE=mock). Behaves like the real thing
 * (latency, async video jobs, failures on request) so the whole pipeline can be
 * exercised without spending money. The UI labels this mode clearly.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ProviderError, type Provider } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const VIDEO_MS = 12_000;
const SAMPLE_VIDEO = process.env.MOCK_VIDEO_PATH
  ?? path.join(/* turbopackIgnore: true */ process.cwd(), "prototype/web/outputs/seedance-1790096361.mp4");

const escapeXml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function hue(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function placeholderSvg(prompt: string, aspect: string): string {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  const r = m ? Number(m[1]) / Number(m[2]) : 16 / 9;
  const w = 1024, h = Math.round(w / r);
  const a = hue(prompt), b = (a + 70) % 360;
  const words = prompt.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    if ((cur + " " + wd).trim().length > 38) { lines.push(cur.trim()); cur = wd; } else cur += " " + wd;
    if (lines.length === 4) break;
  }
  if (lines.length < 4 && cur.trim()) lines.push(cur.trim());
  const text = lines.map((l, i) =>
    `<text x="56" y="${h - 56 - (lines.length - 1 - i) * 34}" font-family="sans-serif" font-size="26" fill="rgba(255,255,255,.88)">${escapeXml(l)}</text>`,
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 45% 22%)"/><stop offset="1" stop-color="hsl(${b} 55% 38%)"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="56" y="80" font-family="monospace" font-size="20" fill="rgba(255,255,255,.55)">Тестовая генерация</text>
${text}</svg>`;
}

function maybeFail(prompt: string) {
  // lets us exercise error paths from the UI: put "[fail]" in a prompt
  if (prompt.includes("[fail]")) throw new ProviderError("Тестовая ошибка: модель отклонила запрос");
}

export const mockProvider: Provider = {
  mode: "mock",

  async image(req) {
    await sleep(1800);
    maybeFail(req.prompt);
    const svg = placeholderSvg(req.prompt, String(req.params.aspect_ratio ?? "16:9"));
    return { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml", costUsd: 0 };
  },

  async submitVideo(req) {
    await sleep(600);
    maybeFail(req.prompt);
    return { externalId: `mock-${Date.now()}` };
  },

  async pollVideo(externalId) {
    const started = Number(externalId.replace("mock-", ""));
    return Date.now() - started < VIDEO_MS ? { state: "pending" } : { state: "done", costUsd: 0 };
  },

  async downloadVideo() {
    try {
      return { bytes: await readFile(SAMPLE_VIDEO), mime: "video/mp4" };
    } catch {
      throw new ProviderError("Тестовый режим: нет образца видео (MOCK_VIDEO_PATH)");
    }
  },

  async text(req) {
    await sleep(900);
    maybeFail(req.prompt);
    const imgs = req.images.length ? ` (картинок на входе: ${req.images.length})` : "";
    return { text: `Тестовый ответ${imgs}. Улучшенный промт: ${req.prompt}`, costUsd: 0 };
  },
};
