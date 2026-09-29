/**
 * The showcase feed: results people chose to show everyone. Posting copies the file
 * under uploads/feed-<id>/, so a post outlives its project and reveals nothing else of
 * it; the prompt goes along only if the author allows.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { FeedPost } from "@/lib/feed";
import type { InputRef } from "@/lib/jobs";
import { getModel } from "@/lib/models/registry";
import { db, graphs, jobs, outputs, postLikes, posts } from "./db";
import { fileUrl, mimeForKey, newKey, putFile, readStored, storagePath } from "./storage";
import { imageSize } from "./tools";

export class PostError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export async function publishPost(userId: string, outputId: string, showPrompt: boolean) {
  const [row] = await db.select({ o: outputs, j: jobs, ownerId: graphs.ownerId }).from(outputs)
    .innerJoin(jobs, eq(jobs.id, outputs.jobId)).innerJoin(graphs, eq(graphs.id, outputs.graphId))
    .where(eq(outputs.id, outputId));
  // only what you made yourself, or what was made on your own project
  if (!row || (row.j.userId !== userId && row.ownerId !== userId)) throw new PostError("Результат не найден", 404);
  if ((row.o.kind !== "image" && row.o.kind !== "video") || !row.o.fileKey) throw new PostError("В ленту можно выложить картинку или видео");
  const [existing] = await db.select().from(posts).where(eq(posts.outputId, outputId));
  if (existing) return existing;

  const size = await mediaSize(row.o.fileKey);
  if (!size) throw new PostError("Не удалось прочитать файл");
  const { width, height } = size;
  const id = randomUUID();
  const key = newKey(`uploads/feed-${id}`, mimeForKey(row.o.fileKey));
  await putFile(key, new Uint8Array(await readStored(row.o.fileKey)));
  const texts = ((row.j.input.ports.prompt ?? []) as InputRef[]).filter((r) => r.type === "text").map((r) => (r as { text: string }).text);
  const [post] = await db.insert(posts).values({
    id, userId, outputId, kind: row.o.kind, fileKey: key, width, height,
    prompt: showPrompt && texts.length ? texts.join("\n\n").slice(0, 4000) : null,
    model: getModel(row.j.modelId)?.name ?? row.j.modelId,
  }).returning();
  return post;
}

/** Width and height for the wall's layout; SVG (older placeholder results) from its attributes. */
async function mediaSize(key: string): Promise<{ width: number; height: number } | null> {
  if (mimeForKey(key) === "image/svg+xml") {
    const head = (await readStored(key)).subarray(0, 2000).toString("utf8");
    const w = Number(/\bwidth="(\d+(?:\.\d+)?)"/.exec(head)?.[1]);
    const h = Number(/\bheight="(\d+(?:\.\d+)?)"/.exec(head)?.[1]);
    const vb = /viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/.exec(head);
    const width = w || Number(vb?.[1]), height = h || Number(vb?.[2]);
    return width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
  }
  return imageSize(storagePath(key)).catch(() => null);
}

export async function removePost(postId: string, userId: string): Promise<boolean> {
  const r = await db.delete(posts).where(and(eq(posts.id, postId), eq(posts.userId, userId))).returning({ id: posts.id });
  return r.length > 0;
}

/** Your posts, by the result they came from: lets the studio mark what is already shown. */
export async function myPosts(userId: string): Promise<Record<string, string>> {
  const rows = await db.select({ id: posts.id, outputId: posts.outputId }).from(posts).where(eq(posts.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.outputId, r.id]));
}

export async function listFeed(userId: string, sort: "top" | "new", offset: number, kind?: "image" | "video"): Promise<FeedPost[]> {
  const rows = await db.execute<{
    id: string; kind: "image" | "video"; file_key: string; width: number; height: number; prompt: string | null;
    model: string; created_at: Date; user_id: string; likes: number; liked: boolean;
  }>(sql`
    select p.id, p.kind, p.file_key, p.width, p.height, p.prompt, p.model, p.created_at, p.user_id,
           (select count(*)::int from post_likes l where l.post_id = p.id) as likes,
           exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = ${userId}) as liked
    from posts p
    ${kind ? sql`where p.kind = ${kind}` : sql``}
    order by ${sort === "top" ? sql`likes desc, p.created_at desc` : sql`p.created_at desc`}
    limit 40 offset ${Math.max(0, Math.min(offset, 10_000))}
  `);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, url: fileUrl(r.file_key), width: r.width, height: r.height, prompt: r.prompt,
    model: r.model, createdAt: new Date(r.created_at).toISOString(), likes: r.likes, liked: r.liked, mine: r.user_id === userId,
  }));
}

export async function toggleLike(postId: string, userId: string): Promise<{ liked: boolean; likes: number } | null> {
  const [p] = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId));
  if (!p) return null;
  const removed = await db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId))).returning();
  if (!removed.length) await db.insert(postLikes).values({ postId, userId }).onConflictDoNothing();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(postLikes).where(eq(postLikes.postId, postId));
  return { liked: !removed.length, likes: n };
}
