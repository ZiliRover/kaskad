/**
 * Local media tools (ffmpeg). Free for the user: nothing goes to a provider.
 * Requires ffmpeg + ffprobe on PATH, or FFMPEG_PATH / FFPROBE_PATH.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProviderError } from "./providers/types";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

function exec(bin: string, args: string[], timeoutMs = 5 * 60_000, cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, cwd });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; if (err.length > 20_000) err = err.slice(-10_000); });
    const t = setTimeout(() => { p.kill(); reject(new ProviderError("Обработка видео заняла слишком долго")); }, timeoutMs);
    p.on("error", () => { clearTimeout(t); reject(new ProviderError("На сервере не найден ffmpeg: инструменты для видео недоступны")); });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve(out);
      else reject(new ProviderError(`Не удалось обработать файл (${err.trim().split("\n").pop()?.slice(0, 160) ?? code})`));
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

/** A quiet sine tone as MP3: the test-mode stand-in for speech. */
export async function tone(seconds: number): Promise<Uint8Array> {
  return withTmp(async (dir) => {
    const out = path.join(dir, "tone.mp3");
    await exec(FFMPEG, ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds.toFixed(1)}`,
      "-af", "volume=0.15,afade=t=in:d=0.2", "-c:a", "libmp3lame", "-b:a", "96k", "-y", out]);
    return readFile(out);
  });
}

function hsl(h: number, sPct: number, lPct: number): string {
  const S = sPct / 100, L = lPct / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "0x" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** Test-mode stand-in for a generated image: a gradient PNG labelled with its prompt. */
export async function placeholderPng(prompt: string, aspect: string, hue: number): Promise<Uint8Array> {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  const r = m ? Number(m[1]) / Number(m[2]) : 16 / 9;
  const W = 1024, H = even(W / r);
  return withTmp(async (dir) => {
    const base = path.join(dir, "base.png");
    await exec(FFMPEG, ["-v", "error", "-f", "lavfi", "-i",
      `gradients=s=${W}x${H}:c0=${hsl(hue, 45, 22)}:c1=${hsl((hue + 70) % 360, 55, 38)}:x0=0:y0=0:x1=${W}:y1=${H}:duration=1`,
      "-frames:v", "1", "-update", "1", "-y", base]);
    return caption(base, "image", `Тестовая генерация. ${prompt}`.slice(0, 200), { position: "bottom", size: "s", look: "shadow" });
  });
}

// ---------------------------------------------------------------- editing tools

const H264 = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

async function duration(file: string): Promise<number> {
  const d = Number((await exec(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])).trim());
  if (!Number.isFinite(d) || d <= 0) throw new ProviderError("Не удалось определить длину файла");
  return d;
}

async function imageSize(file: string): Promise<{ width: number; height: number }> {
  const v = await exec(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
  const [width, height] = v.trim().split(",").map(Number);
  if (!width || !height) throw new ProviderError("Не удалось прочитать картинку");
  return { width, height };
}

/** A piece of a clip: from `start` seconds, `length` seconds long (null = to the end). */
export async function trimVideo(file: string, start: number, length: number | null): Promise<Uint8Array> {
  const total = await duration(file);
  if (start >= total - 0.05) throw new ProviderError(`Ролик короче ${start} с: начало обрезки за его концом`);
  return withTmp(async (dir) => {
    const out = path.join(dir, "trim.mp4");
    // re-encode: cutting on a keyframe boundary would shift the start
    await exec(FFMPEG, ["-v", "error", "-ss", String(start), "-i", file, ...(length ? ["-t", String(length)] : []),
      ...H264, "-c:a", "aac", "-b:a", "192k", "-y", out]);
    return readFile(out);
  });
}

/** Faster or slower playback; the sound keeps its pitch. */
export async function speedVideo(file: string, factor: number): Promise<Uint8Array> {
  const { audio } = await probe(file);
  return withTmp(async (dir) => {
    const out = path.join(dir, "speed.mp4");
    const filter = `[0:v]setpts=PTS/${factor}[v]` + (audio ? `;[0:a]atempo=${factor}[a]` : "");
    await exec(FFMPEG, ["-v", "error", "-i", file, "-filter_complex", filter, "-map", "[v]",
      ...(audio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : []), ...H264, "-y", out]);
    return readFile(out);
  });
}

/**
 * Puts a sound track on a video, cut or padded with silence to the video's length.
 * mix keeps the clip's own sound under the new one.
 */
export async function addAudio(video: string, sound: string, mode: "replace" | "mix"): Promise<Uint8Array> {
  const { audio: has } = await probe(video);
  return withTmp(async (dir) => {
    const out = path.join(dir, "sound.mp4");
    const filter = mode === "mix" && has
      ? "[0:a][1:a]amix=inputs=2:duration=first:normalize=0[a]"
      : "[1:a]apad[a]";
    await exec(FFMPEG, ["-v", "error", "-i", video, "-i", sound, "-filter_complex", filter,
      "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", "-y", out]);
    return readFile(out);
  });
}

const RATIO: Record<string, number> = { "9:16": 9 / 16, "3:4": 3 / 4, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 };

/** Output frame for a new aspect ratio: crop keeps the frame inside the source, blur grows around it. */
function frameFor(w: number, h: number, aspect: string, fill: "crop" | "blur") {
  const r = RATIO[aspect];
  if (!r) throw new ProviderError("Неизвестный формат кадра");
  let W = fill === "crop" ? Math.min(w, h * r) : Math.max(w, h * r);
  let H = W / r;
  const cap = 1920 / Math.max(W, H); // keep outputs a sane size
  if (cap < 1) { W *= cap; H *= cap; }
  return { W: even(W), H: even(H) };
}

function reframeFilter(W: number, H: number, fill: "crop" | "blur") {
  return fill === "crop"
    ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`
    : `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=28,eq=brightness=-0.08[bg];`
      + `[b]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`;
}

/** Same picture in another aspect ratio (9:16 for Reels, 3:4 for marketplace cards). */
export async function reframe(file: string, kind: "image" | "video", aspect: string, fill: "crop" | "blur"): Promise<Uint8Array> {
  const { width, height } = await imageSize(file);
  const { W, H } = frameFor(width, height, aspect, fill);
  return withTmp(async (dir) => {
    const out = path.join(dir, kind === "image" ? "frame.png" : "frame.mp4");
    const vf = reframeFilter(W, H, fill);
    await exec(FFMPEG, kind === "image"
      ? ["-v", "error", "-i", file, "-filter_complex", vf, "-frames:v", "1", "-update", "1", "-y", out]
      : ["-v", "error", "-i", file, "-filter_complex", `[0:v]${vf}[v]`, "-map", "[v]", "-map", "0:a?", "-c:a", "copy", ...H264, "-y", out]);
    return readFile(out);
  });
}

/** A bold font with Cyrillic: OVERLAY_FONT, or a common system one. */
function overlayFont(): string {
  const candidates = [
    process.env.OVERLAY_FONT,
    "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf",
  ];
  const font = candidates.find((f) => f && existsSync(f));
  if (!font) throw new ProviderError("На сервере нет шрифта для надписей: задай OVERLAY_FONT");
  return font;
}

/** Greedy word wrap to a line length in characters. */
function wrap(text: string, perLine: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + word).length > perLine) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 8);
}

export interface CaptionStyle { position: "top" | "center" | "bottom"; size: "s" | "m" | "l"; look: "shadow" | "plate" }

/** Text over an image or a video: centred lines, wrapped to the frame. */
export async function caption(file: string, kind: "image" | "video", text: string, style: CaptionStyle): Promise<Uint8Array> {
  const clean = text.trim();
  if (!clean) throw new ProviderError("Нет текста для надписи");
  file = path.resolve(file); // ffmpeg runs inside the temp dir below
  const { width: W, height: H } = await imageSize(file);
  const fontSize = Math.round(Math.min(W, H) * { s: 0.05, m: 0.068, l: 0.09 }[style.size]);
  const lines = wrap(clean, Math.max(8, Math.floor((W * 0.86) / (fontSize * 0.56))));
  const lineH = Math.round(fontSize * 1.28);
  const block = lines.length * lineH;
  const top = style.position === "top" ? Math.round(H * 0.07)
    : style.position === "bottom" ? Math.round(H * 0.93 - block) : Math.round((H - block) / 2);
  const look = style.look === "plate"
    ? `box=1:boxcolor=black@0.55:boxborderw=${Math.round(fontSize * 0.28)}`
    : `borderw=${Math.max(2, Math.round(fontSize * 0.07))}:bordercolor=black@0.7:shadowx=0:shadowy=${Math.round(fontSize * 0.06)}:shadowcolor=black@0.5`;

  return withTmp(async (dir) => {
    // font and text go through files in the working dir: no path or quote escaping in the filter
    await copyFile(overlayFont(), path.join(dir, "font.ttf"));
    await Promise.all(lines.map((l, i) => writeFile(path.join(dir, `l${i}.txt`), l, "utf8")));
    const draw = lines.map((_, i) =>
      `drawtext=fontfile=font.ttf:textfile=l${i}.txt:expansion=none:fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=${top + i * lineH}:${look}`,
    ).join(",");
    const out = kind === "image" ? "out.png" : "out.mp4";
    await exec(FFMPEG, kind === "image"
      ? ["-v", "error", "-i", file, "-vf", draw, "-frames:v", "1", "-update", "1", "-y", out]
      : ["-v", "error", "-i", file, "-vf", draw, "-map", "0:v", "-map", "0:a?", "-c:a", "copy", ...H264, "-y", out], 10 * 60_000, dir);
    return readFile(path.join(dir, out));
  });
}
