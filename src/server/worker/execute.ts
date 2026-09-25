import { and, desc, eq } from "drizzle-orm";
import type { InputRef } from "@/lib/jobs";
import { getModel } from "@/lib/models/registry";
import { db, outputs, type JobRow } from "../db";
import { getProvider, ProviderError } from "../providers";
import { asDataUrl, newKey, putFile } from "../storage";
import { completeJob, failJob, heartbeat, isCanceled } from "./queue";

const VIDEO_POLL_MS = 5_000;
const VIDEO_DEADLINE_MS = 30 * 60_000;
const HEARTBEAT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class InputError extends ProviderError {}

/** The result a node passes on: the one the user picked, otherwise the latest. */
async function nodeOutput(graphId: string, ref: Extract<InputRef, { type: "node" }>) {
  if (ref.outputId) {
    const [picked] = await db.select().from(outputs)
      .where(and(eq(outputs.id, ref.outputId), eq(outputs.graphId, graphId), eq(outputs.nodeId, ref.nodeId)));
    if (picked) return picked;
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

/** Files (images, video, audio) as data URLs, from uploads or upstream results. */
async function resolveMedia(job: JobRow, refs: InputRef[] = []): Promise<string[]> {
  const urls: string[] = [];
  for (const r of refs) {
    if (r.type === "file") urls.push(await asDataUrl(r.key));
    else if (r.type === "node") {
      const o = await nodeOutput(job.graphId, r);
      if (!o.fileKey) throw new InputError("Входная нода вернула не файл");
      urls.push(await asDataUrl(o.fileKey));
    }
  }
  return urls;
}

async function store(job: JobRow, bytes: Uint8Array, mime: string) {
  const key = newKey(`outputs/${job.graphId}`, mime);
  await putFile(key, bytes);
  return key;
}

async function run(job: JobRow) {
  const provider = getProvider();
  const { ports, params } = job.input;
  const prompt = await resolveText(job, ports.prompt);
  if (!prompt && !getModel(job.modelId)?.promptOptional) throw new InputError("Промт пустой");

  if (job.kind === "image") {
    const r = await provider.image({ model: job.modelId, prompt, params, references: await resolveMedia(job, ports.references) });
    const files = [];
    for (const img of r.images) files.push({ fileKey: await store(job, img.bytes, img.mime), mime: img.mime });
    await completeJob(job, files, r.costUsd);
    return;
  }

  if (job.kind === "text") {
    const r = await provider.text({
      model: job.modelId, prompt, system: String(params.system ?? ""), images: await resolveMedia(job, ports.images),
    });
    await completeJob(job, [{ text: r.text }], r.costUsd);
    return;
  }

  // video: submit once, persist the provider id immediately, then poll
  let externalId = job.externalId;
  if (!externalId) {
    const [first] = await resolveMedia(job, ports.first_frame);
    const [last] = await resolveMedia(job, ports.last_frame);
    const [source] = await resolveMedia(job, ports.source);
    ({ externalId } = await provider.submitVideo({
      model: job.modelId, prompt, params,
      firstFrame: first ?? null,
      lastFrame: last ?? null,
      sourceVideo: source ?? null,
      refImages: await resolveMedia(job, ports.references),
      refVideos: await resolveMedia(job, ports.ref_videos),
      refAudio: await resolveMedia(job, ports.ref_audio),
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
      await completeJob(job, [{ fileKey: key, mime: media.mime }], poll.costUsd);
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
