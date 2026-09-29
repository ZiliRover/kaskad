import { and, asc, desc, eq } from "drizzle-orm";
import type { InputRef } from "@/lib/jobs";
import { getModel, MUSIC_MODELS, TOOL_PREFIX } from "@/lib/models/registry";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clipKey } from "@/lib/graph/types";
import { db, jobs, outputs, type JobRow } from "../db";
import { getProvider, providerMode, ProviderError } from "../providers";
import { DEFAULT_CRITERIA, judge } from "../judge";
import { asDataUrl, mimeForKey, newKey, putFile, readStored, signedFileUrl, storagePath } from "../storage";
import {
  addAudio, burnSubtitles, caption, forMarketplace, montage, concatVideos, extractFrame, extractSpeech, reframe, speedVideo, trimVideo, wordsFromText,
  type CaptionStyle, type SubtitleStyle, type Word,
} from "../tools";
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

/** All results of a node's latest successful run: its variants, or its batch items in order. */
async function latestRunOutputs(graphId: string, nodeId: string) {
  const [last] = await db.select({ runId: jobs.runId }).from(jobs)
    .where(and(eq(jobs.graphId, graphId), eq(jobs.nodeId, nodeId), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.createdAt)).limit(1);
  if (!last) throw new InputError("Входная нода ещё не дала результата");
  const rows = await db.select({ o: outputs }).from(outputs).innerJoin(jobs, eq(jobs.id, outputs.jobId))
    .where(and(eq(jobs.runId, last.runId), eq(jobs.nodeId, nodeId), eq(jobs.status, "succeeded")))
    .orderBy(asc(jobs.item), asc(outputs.createdAt));
  return rows.map((r) => r.o);
}

/** Run an upstream image node's latest job again, without saving: fresh candidates to judge. */
async function regenerate(job: JobRow, nodeId: string) {
  const [src] = await db.select().from(jobs)
    .where(and(eq(jobs.graphId, job.graphId), eq(jobs.nodeId, nodeId), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.createdAt)).limit(1);
  if (!src || src.kind !== "image" || src.modelId.startsWith(TOOL_PREFIX)) return null;
  const as = { ...job, input: src.input } as JobRow;
  const prompt = await resolveText(as, src.input.ports.prompt);
  const r = await getProvider().image({
    model: src.modelId, prompt, params: src.input.params, references: await resolveMedia(as, src.input.ports.references),
  });
  const est = src.estimateUsd === null ? 0 : Number(src.estimateUsd);
  return {
    images: r.images.map((m) => ({ data: `data:${m.mime};base64,${Buffer.from(m.bytes).toString("base64")}`, mime: m.mime, bytes: m.bytes })),
    costUsd: providerMode() === "mock" ? est : r.costUsd ?? est,
  };
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
    case "kaskad/marketplace": {
      const r = await forMarketplace(await one("image", "картинку"), p("market") === "ozon" ? "ozon" : "wb", p("fill") === "crop" ? "crop" : "blur");
      return completeJob(job, [{ fileKey: await store(job, r.bytes, "image/jpeg"), mime: "image/jpeg", text: r.report }], 0);
    }
    case "kaskad/best-of": {
      const criteria = (await resolveText(job, ports.prompt)) || DEFAULT_CRITERIA;
      // every candidate of every source: all variants of its latest run, or a batch item
      const keys: string[] = [];
      const sources = new Set<string>();
      for (const r of ports.candidates ?? []) {
        if (r.type === "file") keys.push(r.key);
        else if (r.type === "node" && r.item === undefined && !r.outputId) {
          sources.add(r.nodeId);
          for (const o of await latestRunOutputs(job.graphId, r.nodeId)) if (o.fileKey) keys.push(o.fileKey);
        } else if (r.type === "node") {
          const o = await nodeOutput(job.graphId, r);
          if (o.fileKey) keys.push(o.fileKey);
        }
      }
      if (!keys.length) throw new InputError("Нет картинок для выбора");
      let pool: { data: string; mime: string; key?: string; bytes?: Uint8Array }[] = await Promise.all(
        keys.slice(0, 16).map(async (k) => ({ data: await asDataUrl(k), mime: mimeForKey(k), key: k })));
      let cost = 0;
      let v = await judge(pool.map((x) => x.data), criteria, "");
      cost += v.costUsd ?? 0;
      let tries = 0;
      const threshold = p("threshold") === "off" ? 0 : Number(p("threshold"));
      const maxTries = Number(p("attempts")) || 1;
      // below the bar: run the source image model again, judge the new batch, keep the best overall
      while (threshold && v.score < threshold && tries < maxTries && sources.size) {
        tries++;
        const fresh = await regenerate(job, [...sources][0]);
        if (!fresh) break;
        cost += fresh.costUsd;
        const next = await judge(fresh.images.map((x) => x.data), criteria, "");
        cost += next.costUsd ?? 0;
        if (next.score > v.score) { pool = fresh.images; v = next; }
      }
      const pick = pool[v.best];
      const bytes = pick.bytes ?? new Uint8Array(await readStored(pick.key!));
      const note = `Выбран вариант ${v.best + 1} из ${pool.length}: ${v.score}/10${tries ? `, перегенераций: ${tries}` : ""}. ${v.why}`.trim();
      return completeJob(job, [{ fileKey: await store(job, bytes, pick.mime), mime: pick.mime, text: note }], billable(job, cost));
    }
    case "kaskad/timeline": {
      const refs = ports.clips ?? [];
      const paths = await resolvePaths(job, refs);
      const tl = job.input.timeline;
      const keyed = refs.map((r, i) => ({ key: r.type === "text" ? "" : clipKey(r), path: paths[i] }));
      const rank = (k: string) => { const i = tl?.order.indexOf(k) ?? -1; return i < 0 ? 1e6 : i; };
      const clips = keyed
        .map((c, i) => ({ ...c, i }))
        .filter((c) => !tl?.off.includes(c.key))
        .sort((a, b) => rank(a.key) - rank(b.key) || a.i - b.i)
        .map((c) => ({ path: c.path, start: tl?.trims[c.key]?.start ?? 0, end: tl?.trims[c.key]?.end ?? null }));
      if (!clips.length) throw new InputError("Все ролики на таймлайне выключены");
      let bytes = await montage(clips, p("transition") === "fade");
      const [sound] = await resolvePaths(job, ports.audio);
      if (sound) {
        const tmp = path.join(os.tmpdir(), `kaskad-${job.id}.mp4`);
        await writeFile(tmp, bytes);
        try { bytes = await addAudio(tmp, sound, p("mode") === "mix" ? "mix" : "replace"); } finally { await rm(tmp, { force: true }); }
      }
      return out(bytes, "video/mp4");
    }
    case "kaskad/subtitles": {
      const file = await one("video", "видео");
      const text = await resolveText(job, ports.prompt);
      let words: Word[];
      let cost: number | null = 0;
      if (text) words = await wordsFromText(file, text); // the text is known: no recognition, free
      else {
        const speech = await extractSpeech(file);
        if (!speech) throw new InputError("В ролике нет звука. Подключи текст, и субтитры встанут по времени");
        const r = await getProvider().transcribe(speech);
        words = r.words;
        cost = billable(job, r.costUsd);
      }
      const style = { look: p("look"), position: p("position"), size: p("size") } as SubtitleStyle;
      const bytes = await burnSubtitles(file, words, style);
      return completeJob(job, [{ fileKey: await store(job, bytes, "video/mp4"), mime: "video/mp4" }], cost);
    }
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

  if (job.kind === "audio") {
    // a voice sample goes inline: speech models accept it without a public link
    if (MUSIC_MODELS.has(job.modelId)) {
      const m = await provider.music({ model: job.modelId, prompt });
      const key = await store(job, m.audio.bytes, m.audio.mime);
      await completeJob(job, [{ fileKey: key, mime: m.audio.mime }], billable(job, m.costUsd));
      return;
    }
    const [sample] = await resolveMedia(job, ports.voice_sample);
    const r = await provider.speech({
      model: job.modelId, text: prompt, voice: params.voice ? String(params.voice) : null, sample: sample ?? null,
    });
    const key = await store(job, r.audio.bytes, r.audio.mime);
    await completeJob(job, [{ fileKey: key, mime: r.audio.mime }], billable(job, r.costUsd));
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
