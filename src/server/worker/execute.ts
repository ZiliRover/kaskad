import { and, asc, desc, eq } from "drizzle-orm";
import type { InputRef } from "@/lib/jobs";
import { getModel, TOOL_PREFIX } from "@/lib/models/registry";
import { db, jobs, outputs, type JobRow } from "../db";
import { getProvider, providerMode, ProviderError } from "../providers";
import { asDataUrl, newKey, putFile, signedFileUrl, storagePath } from "../storage";
import { addAudio, caption, concatVideos, extractFrame, reframe, speedVideo, trimVideo, type CaptionStyle } from "../tools";
import { completeJob, failJob, heartbeat, isCanceled } from "./queue";

const VIDEO_POLL_MS = 5_000;
const VIDEO_DEADLINE_MS = 30 * 60_000;
const HEARTBEAT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class InputError extends ProviderError {}

/**
 * What the job is billed at: the provider's reported cost, or our estimate when it reports
 * none. Test mode bills the estimate too, so balances move exactly as they would live.
 */
function billable(job: JobRow, reported: number | null): number | null {
  const est = job.estimateUsd === null ? null : Number(job.estimateUsd);
  if (providerMode() === "mock") return est;
  return reported ?? est;
}

/** The result a node passes on: the one the user picked, otherwise the latest. */
async function nodeOutput(graphId: string, ref: Extract<InputRef, { type: "node" }>) {
  if (ref.outputId) {
    const [picked] = await db.select().from(outputs)
      .where(and(eq(outputs.id, ref.outputId), eq(outputs.graphId, graphId), eq(outputs.nodeId, ref.nodeId)));
    if (picked) return picked;
  }
  if (ref.item !== undefined) {
    // a batch: the result of that node's latest successful run of the same item
    const [o] = await db.select({ o: outputs }).from(outputs)
      .innerJoin(jobs, eq(jobs.id, outputs.jobId))
      .where(and(eq(jobs.graphId, graphId), eq(jobs.nodeId, ref.nodeId), eq(jobs.item, ref.item), eq(jobs.status, "succeeded")))
      .orderBy(desc(jobs.createdAt), asc(outputs.createdAt)).limit(1);
    if (!o) throw new InputError(`Входная нода ещё не дала результата для элемента ${ref.item + 1}`);
    return o.o;
  }
  const [o] = await db.select().from(outputs)
    .where(and(eq(outputs.graphId, graphId), eq(outputs.nodeId, ref.nodeId)))
    .orderBy(desc(outputs.createdAt)).limit(1);
  if (!o) throw new InputError("Входная нода ещё не дала результата");
  return o;
}

async function resolveText(job: JobRow, refs: InputRef[] = []): Promise<string> {
  const parts: string[] = [];
  for (const r of refs) {
    if (r.type === "text") parts.push(r.text);
    else if (r.type === "node") {
      const o = await nodeOutput(job.graphId, r);
      if (!o.text) throw new InputError("Входная нода вернула не текст");
      parts.push(o.text);
    }
  }
  return parts.join("\n\n").trim();
}

/** Storage keys of file inputs, from uploads or upstream results. */
async function resolveKeys(job: JobRow, refs: InputRef[] = []): Promise<string[]> {
  const keys: string[] = [];
  for (const r of refs) {
    if (r.type === "file") keys.push(r.key);
    else if (r.type === "node") {
      const o = await nodeOutput(job.graphId, r);
      if (!o.fileKey) throw new InputError("Входная нода вернула не файл");
      keys.push(o.fileKey);
    }
  }
  return keys;
}

/** Images travel inline as data URLs (providers accept that). */
async function resolveMedia(job: JobRow, refs: InputRef[] = []): Promise<string[]> {
  return Promise.all((await resolveKeys(job, refs)).map(asDataUrl));
}

/** Video and audio must be public https links the provider downloads itself. */
async function resolveLinks(job: JobRow, refs: InputRef[] = []): Promise<string[]> {
  const keys = await resolveKeys(job, refs);
  return keys.map((k) => {
    const url = signedFileUrl(k);
    // fail before submitting: nothing is billed
    if (!url) throw new InputError("Видео и аудио на вход провайдер скачивает по ссылке, а у сервера нет публичного https-адреса. Задай PUBLIC_BASE_URL или отключи эти входы.");
    return url;
  });
}

/** Local file paths of media inputs, for tools that work on disk. */
async function resolvePaths(job: JobRow, refs: InputRef[] = []): Promise<string[]> {
  const paths: string[] = [];
  for (const r of refs) {
    if (r.type === "file") paths.push(storagePath(r.key));
    else if (r.type === "node") {
      const o = await nodeOutput(job.graphId, r);
      if (!o.fileKey) throw new InputError("Входная нода вернула не файл");
      paths.push(storagePath(o.fileKey));
    }
  }
  return paths;
}

async function runTool(job: JobRow) {
  const { ports, params } = job.input;
  if (job.modelId === "kaskad/last-frame") {
    const [video] = await resolvePaths(job, ports.video);
    if (!video) throw new InputError("Подключи видео");
    const png = await extractFrame(video, params.which === "first" ? "first" : "last");
    await completeJob(job, [{ fileKey: await store(job, png, "image/png"), mime: "image/png" }], 0);
    return;
  }
  if (job.modelId === "kaskad/concat") {
    const mp4 = await concatVideos(await resolvePaths(job, ports.clips));
    await completeJob(job, [{ fileKey: await store(job, mp4, "video/mp4"), mime: "video/mp4" }], 0);
    return;
  }
  const one = async (key: string, what: string) => {
    const [file] = await resolvePaths(job, ports[key]);
    if (!file) throw new InputError(`Подключи ${what}`);
    return file;
  };
  const out = async (bytes: Uint8Array, mime: string) =>
    completeJob(job, [{ fileKey: await store(job, bytes, mime), mime }], 0);
  const p = (k: string) => String(params[k] ?? "");
  switch (job.modelId) {
    case "kaskad/trim":
      return out(await trimVideo(await one("video", "видео"), Number(p("start")) || 0, p("length") === "all" ? null : Number(p("length")) || null), "video/mp4");
    case "kaskad/speed":
      return out(await speedVideo(await one("video", "видео"), Number(p("factor")) || 1), "video/mp4");
    case "kaskad/add-audio":
      return out(await addAudio(await one("video", "видео"), await one("audio", "звук"), p("mode") === "mix" ? "mix" : "replace"), "video/mp4");
    case "kaskad/reframe-video":
      return out(await reframe(await one("video", "видео"), "video", p("aspect"), p("fill") === "blur" ? "blur" : "crop"), "video/mp4");
    case "kaskad/reframe-image":
      return out(await reframe(await one("image", "картинку"), "image", p("aspect"), p("fill") === "blur" ? "blur" : "crop"), "image/png");
    case "kaskad/caption-image":
    case "kaskad/caption-video": {
      const kind = job.modelId === "kaskad/caption-image" ? "image" : "video";
      const style = { position: p("position"), size: p("size"), look: p("look") } as CaptionStyle;
      const text = await resolveText(job, ports.prompt);
      const file = await one(kind, kind === "image" ? "картинку" : "видео");
      return out(await caption(file, kind, text, style), kind === "image" ? "image/png" : "video/mp4");
    }
  }
  throw new InputError("Неизвестный инструмент");
}

async function store(job: JobRow, bytes: Uint8Array, mime: string) {
  const key = newKey(`outputs/${job.graphId}`, mime);
  await putFile(key, bytes);
  return key;
}

async function run(job: JobRow) {
  if (job.modelId.startsWith(TOOL_PREFIX)) return runTool(job);
  const provider = getProvider();
  const { ports, params } = job.input;
  const prompt = await resolveText(job, ports.prompt);
  if (!prompt && !getModel(job.modelId)?.promptOptional) throw new InputError("Промт пустой");

  if (job.kind === "image") {
    const r = await provider.image({ model: job.modelId, prompt, params, references: await resolveMedia(job, ports.references) });
    const files = [];
    for (const img of r.images) files.push({ fileKey: await store(job, img.bytes, img.mime), mime: img.mime });
    await completeJob(job, files, billable(job, r.costUsd));
    return;
  }

  if (job.kind === "text") {
    const r = await provider.text({
      model: job.modelId, prompt, system: String(params.system ?? ""), images: await resolveMedia(job, ports.images),
    });
    await completeJob(job, [{ text: r.text }], billable(job, r.costUsd));
    return;
  }

  // video: submit once, persist the provider id immediately, then poll
  let externalId = job.externalId;
  if (!externalId) {
    const [first] = await resolveMedia(job, ports.first_frame);
    const [last] = await resolveMedia(job, ports.last_frame);
    const [source] = await resolveLinks(job, ports.source);
    ({ externalId } = await provider.submitVideo({
      model: job.modelId, prompt, params,
      firstFrame: first ?? null,
      lastFrame: last ?? null,
      sourceVideo: source ?? null,
      refImages: await resolveMedia(job, ports.references),
      refVideos: await resolveLinks(job, ports.ref_videos),
      refAudio: await resolveLinks(job, ports.ref_audio),
    }));
    await heartbeat(job.id, externalId);
  }
  const deadline = (job.startedAt?.getTime() ?? Date.now()) + VIDEO_DEADLINE_MS;
  while (Date.now() < deadline) {
    await sleep(VIDEO_POLL_MS);
    if (await isCanceled(job.id)) return; // user stopped waiting
    let poll;
    try {
      poll = await provider.pollVideo(externalId);
    } catch (e) {
      if (e instanceof ProviderError && e.retryable) continue; // transient: keep polling
      throw e;
    }
    if (poll.state === "failed") throw new ProviderError(poll.error);
    if (poll.state === "done") {
      const media = await provider.downloadVideo(externalId);
      const key = await store(job, media.bytes, media.mime);
      await completeJob(job, [{ fileKey: key, mime: media.mime }], billable(job, poll.costUsd));
      return;
    }
  }
  throw new ProviderError("Провайдер не ответил за 30 минут. Запустите ещё раз.");
}

export async function executeJob(job: JobRow) {
  const beat = setInterval(() => { heartbeat(job.id).catch(() => {}); }, HEARTBEAT_MS);
  try {
    await run(job);
  } catch (e) {
    const message = e instanceof ProviderError ? e.message : "Внутренняя ошибка сервиса";
    if (!(e instanceof ProviderError)) console.error(`[job ${job.id}]`, e);
    await failJob(job, message);
  } finally {
    clearInterval(beat);
  }
}
