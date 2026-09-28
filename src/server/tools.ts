/**
 * Local media tools (ffmpeg). Free for the user: nothing goes to a provider.
 * Requires ffmpeg + ffprobe on PATH, or FFMPEG_PATH / FFPROBE_PATH.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProviderError } from "./providers";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

function exec(bin: string, args: string[], timeoutMs = 5 * 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; if (err.length > 20_000) err = err.slice(-10_000); });
    const t = setTimeout(() => { p.kill(); reject(new ProviderError("Обработка видео заняла слишком долго")); }, timeoutMs);
    p.on("error", () => { clearTimeout(t); reject(new ProviderError("На сервере не найден ffmpeg: инструменты для видео недоступны")); });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new ProviderError(`Не удалось обработать видео (${err.trim().split("\n").pop()?.slice(0, 160) ?? code})`));
    });
  });
}

async function probe(file: string): Promise<{ width: number; height: number; audio: boolean }> {
  const v = await exec(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = v.trim().split(",").map(Number);
  if (!width || !height) throw new ProviderError("Во входном файле нет видео");
  const a = await exec(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return { width, height, audio: a.trim().length > 0 };
}

async function withTmp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "kaskad-"));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** First or last frame of a video as PNG. */
export async function extractFrame(videoPath: string, which: "first" | "last"): Promise<Uint8Array> {
  return withTmp(async (dir) => {
    const out = path.join(dir, "frame.png");
    // -sseof seeks from the end; the last decodable frame wins with -update
    const seek = which === "last" ? ["-sseof", "-0.5"] : [];
    await exec(FFMPEG, ["-v", "error", ...seek, "-i", videoPath, "-frames:v", "1", "-update", "1", "-y", out]);
    return readFile(out);
  });
}

/**
 * Joins clips in order. Clips from different models differ in size, fps and audio,
 * so everything is normalised to the first clip's frame (letterboxed), 24 fps;
 * sound is kept only if every clip has it.
 */
export async function concatVideos(paths: string[]): Promise<Uint8Array> {
  if (paths.length < 2) throw new ProviderError("Для склейки нужно минимум два ролика");
  const info = await Promise.all(paths.map(probe));
  const W = info[0].width - (info[0].width % 2), H = info[0].height - (info[0].height % 2);
  const audio = info.every((i) => i.audio);
  const parts = paths.map((_, i) =>
    `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24,format=yuv420p[v${i}]`
    + (audio ? `;[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]` : ""));
  const inputs = paths.map((_, i) => (audio ? `[v${i}][a${i}]` : `[v${i}]`)).join("");
  const filter = `${parts.join(";")};${inputs}concat=n=${paths.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? "[a]" : ""}`;
  return withTmp(async (dir) => {
    const out = path.join(dir, "joined.mp4");
    await exec(FFMPEG, [
      "-v", "error", ...paths.flatMap((p) => ["-i", p]),
      "-filter_complex", filter, "-map", "[v]", ...(audio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-movflags", "+faststart", "-y", out,
    ], 15 * 60_000);
    return readFile(out);
  });
}
