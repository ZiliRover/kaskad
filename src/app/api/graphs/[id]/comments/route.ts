import { and, asc, eq, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { Comment } from "@/lib/comments";
import { requireUser } from "@/server/auth";
import { db, graphComments, users } from "@/server/db";
import { publish } from "@/server/live";
import { graphAccess } from "@/server/sharing";

type Ctx = { params: Promise<{ id: string }> };
const UUID = z.string().uuid();

async function list(graphId: string): Promise<Comment[]> {
  const rows = await db.select({ c: graphComments, email: users.email }).from(graphComments)
    .innerJoin(users, eq(users.id, graphComments.userId))
    .where(eq(graphComments.graphId, graphId)).orderBy(asc(graphComments.createdAt));
  return rows.map(({ c, email }) => ({
    id: c.id, parentId: c.parentId, x: c.x, y: c.y, text: c.text, resolved: c.resolved,
    createdAt: c.createdAt.toISOString(), author: { id: c.userId, email },
  }));
}

/** Everyone with access comments, viewers included: reviewing is what they are there for. */
export async function GET(_req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!(await graphAccess(id, user.id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json(await list(id));
}

const create = z.union([
  z.object({ text: z.string().trim().min(1).max(2000), x: z.number().finite(), y: z.number().finite() }),
  z.object({ text: z.string().trim().min(1).max(2000), parentId: UUID }),
]);

export async function POST(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!(await graphAccess(id, user.id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const parsed = create.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Пустой комментарий" }, { status: 400 });
  const d = parsed.data;
  if ("parentId" in d) {
    const [root] = await db.select({ id: graphComments.id }).from(graphComments)
      .where(and(eq(graphComments.id, d.parentId), eq(graphComments.graphId, id)));
    if (!root) return NextResponse.json({ error: "Обсуждение не найдено" }, { status: 404 });
    await db.insert(graphComments).values({ graphId: id, userId: user.id, parentId: d.parentId, text: d.text });
    await db.update(graphComments).set({ resolved: false }).where(eq(graphComments.id, d.parentId)); // a reply reopens
  } else {
    await db.insert(graphComments).values({ graphId: id, userId: user.id, x: d.x, y: d.y, text: d.text });
  }
  await publish(id, { t: "comments" });
  return NextResponse.json(await list(id));
}

const patch = z.object({ id: UUID, resolved: z.boolean() });

export async function PATCH(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await graphAccess(id, user.id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  await db.update(graphComments).set({ resolved: parsed.data.resolved })
    .where(and(eq(graphComments.id, parsed.data.id), eq(graphComments.graphId, id)));
  await publish(id, { t: "comments" });
  return NextResponse.json(await list(id));
}

/** Authors delete their own messages; the owner can delete any (a thread goes with its root). */
export async function DELETE(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const body = z.object({ id: UUID }).safeParse(await req.json().catch(() => null));
  const a = await graphAccess(id, user.id);
  if (!body.success || !a) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const mine = a.role === "owner" ? sql`true` : eq(graphComments.userId, user.id);
  const r = await db.delete(graphComments)
    .where(and(eq(graphComments.graphId, id), or(eq(graphComments.id, body.data.id), eq(graphComments.parentId, body.data.id)), mine))
    .returning({ id: graphComments.id });
  if (!r.length) return NextResponse.json({ error: "Удалять можно свои комментарии" }, { status: 403 });
  await publish(id, { t: "comments" });
  return NextResponse.json(await list(id));
}
