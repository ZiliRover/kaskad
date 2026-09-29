/**
 * The media library: everything a user made or uploaded, across all projects,
 * newest first, with search over the prompts that made each result.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import type { MediaItem } from "@/lib/media";
import { getModel } from "@/lib/models/registry";
import { db, uploads } from "./db";
import { fileUrl, mimeForKey, storagePath } from "./storage";

const PAGE = 60;
const kindOf = (mime: string) => (mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "image");

export async function recordUpload(ownerId: string, fileKey: string, name: string, kind: string) {
  await db.insert(uploads).values({ ownerId, fileKey, name: name.slice(0, 200), kind }).onConflictDoNothing();
}

/** Uploads made before the table existed: picked up from storage once. */
async function backfill(ownerId: string) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(uploads).where(eq(uploads.ownerId, ownerId));
  if (n > 0) return;
  const dir = path.dirname(storagePath(`uploads/${ownerId}/x.png`));
  let names: string[] = [];
  try { names = await readdir(dir); } catch { return; }
  for (const f of names) {
    const key = `uploads/${ownerId}/${f}`;
    const st = await stat(path.join(dir, f)).catch(() => null);
    if (!st?.isFile()) continue;
    await db.insert(uploads).values({ ownerId, fileKey: key, name: "", kind: kindOf(mimeForKey(key)), createdAt: st.mtime }).onConflictDoNothing();
  }
}

export async function listMedia(ownerId: string, opts: {
  source: "results" | "uploads"; kind?: string; q?: string; before?: string;
}): Promise<MediaItem[]> {
  // an ISO string with an explicit cast: the driver does not take Date objects in raw SQL
  const before = opts.before ? new Date(opts.before).toISOString() : null;
  const kind = opts.kind && ["image", "video", "audio", "text"].includes(opts.kind) ? opts.kind : null;

  if (opts.source === "uploads") {
    await backfill(ownerId);
    const rows = await db.select().from(uploads).where(and(
      eq(uploads.ownerId, ownerId),
      kind ? eq(uploads.kind, kind) : undefined,
      before ? sql`${uploads.createdAt} < ${before}::timestamptz` : undefined,
      opts.q ? sql`${uploads.name} ilike ${`%${opts.q}%`}` : undefined,
    )).orderBy(desc(uploads.createdAt)).limit(PAGE);
    return rows.map((r) => ({
      id: r.id, kind: r.kind as MediaItem["kind"], fileKey: r.fileKey, url: fileUrl(r.fileKey), text: null,
      createdAt: r.createdAt.toISOString(), projectId: null, projectName: null, title: r.name || "Загрузка", prompt: null,
    }));
  }

  const rows = await db.execute<{
    id: string; kind: MediaItem["kind"]; file_key: string | null; text: string | null; created_at: Date;
    graph_id: string; graph_name: string; app_id: string | null; model_id: string; prompt: string | null;
  }>(sql`
    select o.id, o.kind, o.file_key, o.text, o.created_at, g.id as graph_id, g.name as graph_name, g.app_id, j.model_id,
           (select string_agg(p->>'text', ' ') from jsonb_array_elements(coalesce(j.input->'ports'->'prompt', '[]'::jsonb)) p
             where p->>'type' = 'text') as prompt
    from outputs o
    join jobs j on j.id = o.job_id
    join graphs g on g.id = o.graph_id
    where g.owner_id = ${ownerId}
      ${kind ? sql`and o.kind = ${kind}` : sql``}
      ${before ? sql`and o.created_at < ${before}::timestamptz` : sql``}
      ${opts.q ? sql`and (j.input::text ilike ${`%${opts.q}%`} or o.text ilike ${`%${opts.q}%`} or g.name ilike ${`%${opts.q}%`})` : sql``}
    order by o.created_at desc
    limit ${PAGE}
  `);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, fileKey: r.file_key, url: r.file_key ? fileUrl(r.file_key) : null, text: r.text,
    createdAt: new Date(r.created_at).toISOString(),
    projectId: r.app_id ? null : r.graph_id, projectName: r.app_id ? `Приложение: ${r.graph_name}` : r.graph_name,
    title: getModel(r.model_id)?.name ?? r.model_id, prompt: r.prompt ? r.prompt.slice(0, 300) : null,
  }));
}
