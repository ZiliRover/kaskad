/** The user's library of reusable characters, products, brands and styles. */
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { ASSET_KINDS } from "@/lib/graph/types";
import { canReadFile } from "./access";
import { db, libraryItems } from "./db";
import { fileUrl } from "./storage";
import type { LibraryItem } from "@/lib/library";

export type { LibraryItem };

export const libraryInput = z.object({
  kind: z.enum(ASSET_KINDS),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(4000).default(""),
  files: z.array(z.string().min(1).max(300)).max(9).default([]),
});
export type LibraryInput = z.infer<typeof libraryInput>;


const view = (r: typeof libraryItems.$inferSelect): LibraryItem => ({
  id: r.id, kind: r.kind as LibraryItem["kind"], name: r.name, description: r.description, files: r.files,
  thumbs: r.files.slice(0, 4).map(fileUrl), updatedAt: r.updatedAt.toISOString(),
});

export class LibraryError extends Error {}

async function checkFiles(files: string[], userId: string) {
  for (const f of files) if (!(await canReadFile(f, userId))) throw new LibraryError("Один из файлов недоступен. Загрузи его заново.");
}

export async function listLibrary(userId: string): Promise<LibraryItem[]> {
  const rows = await db.select().from(libraryItems).where(eq(libraryItems.ownerId, userId)).orderBy(desc(libraryItems.updatedAt));
  return rows.map(view);
}

export async function createItem(userId: string, input: LibraryInput): Promise<LibraryItem> {
  await checkFiles(input.files, userId);
  const [row] = await db.insert(libraryItems).values({ ownerId: userId, ...input }).returning();
  return view(row);
}

export async function updateItem(id: string, userId: string, input: LibraryInput): Promise<LibraryItem | null> {
  await checkFiles(input.files, userId);
  const [row] = await db.update(libraryItems).set({ ...input, updatedAt: sql`now()` })
    .where(and(eq(libraryItems.id, id), eq(libraryItems.ownerId, userId))).returning();
  return row ? view(row) : null;
}

export async function deleteItem(id: string, userId: string): Promise<boolean> {
  const r = await db.delete(libraryItems).where(and(eq(libraryItems.id, id), eq(libraryItems.ownerId, userId))).returning({ id: libraryItems.id });
  return r.length > 0;
}
