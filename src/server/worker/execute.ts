import { and, desc, eq } from "drizzle-orm";
import type { InputRef } from "@/lib/jobs";
import { db, outputs, type JobRow } from "../db";
import { getProvider, ProviderError } from "../providers";
import { asDataUrl, newKey, putFile } from "../storage";
import { completeJob, failJob, heartbeat, isCanceled } from "./queue";

const VIDEO_POLL_MS = 5_000;
const VIDEO_DEADLINE_MS = 30 * 60_000;
const HEARTBEAT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class InputError extends ProviderError {}

async function latestOutput(graphId: string, nodeId: string) {
  const [o] = await db.select().from(outputs)
    .where(and(eq(outputs.graphId, graphId), eq(outputs.nodeId, nodeId)))
    .orderBy(desc(outputs.createdAt)).limit(1);
  if (!o) throw new InputError("Входная нода ещё не дала результата");
  return o;
}

async function resolveText(job: JobRow, refs: InputRef[] = []): Promise<string> {
  const parts: string[] = [];
  for (const r of refs) {
    if (r.type === "text") parts.push(r.text);
    else if (r.type === "node") {
      const o = await latestOutput(job.graphId, r.nodeId);
      if (!o.text) throw new InputError("Входная нода вернула не текст");
      parts.push(o.text);
    }
  }
  return parts.join("\n\n").trim();
}

async function resolveImages(job: JobRow, refs: InputRef[] = []): Promise<string[]> {
  const urls: string[] = [];
  for (const r of refs) {
    if (r.type === "file") urls.push(await asDataUrl(r.key));
    else if (r.type === "node") {
      const o = await latestOutput(job.graphId, r.nodeId);
      if (!o.fileKey) throw new InputError("Входная нода вернула не картинку");
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
  if (!prompt) throw new InputError("Промт пустой");

  if (job.kind === "image") {
    const r = await provider.image({ model: job.modelId, prompt, params, references: await resolveImages(job, ports.references) });
    const key = await store(job, r.bytes, r.mime);
    await completeJob(job, { fileKey: key, mime: r.mime, costUsd: r.costUsd });
    return;
  }

  if (job.kind === "text") {
    const r = await provider.text({
      model: job.modelId, prompt, system: String(params.system ?? ""), images: await resolveImages(job, ports.images),
    });
    await completeJob(job, { text: r.text, costUsd: r.costUsd });
    return;
  }

  // video: submit once, persist the provider id immediately, then poll
  let externalId = job.externalId;
  if (!externalId) {
    const [first] = await resolveImages(job, ports.first_frame);
    const [last] = await resolveImages(job, ports.last_frame);
    ({ externalId } = await provider.submitVideo({
      model: job.modelId, prompt, params, firstFrame: first ?? null, lastFrame: last ?? null,
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
      await completeJob(job, { fileKey: key, mime: media.mime, costUsd: poll.costUsd });
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
