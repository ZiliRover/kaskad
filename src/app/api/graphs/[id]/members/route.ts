import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeEmail, requireUser } from "@/server/auth";
import { graphAccess, invite, listMembers, removeMember } from "@/server/sharing";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!(await graphAccess(id, user.id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json(await listMembers(id));
}

const inviteBody = z.object({ email: z.string().max(254), role: z.enum(["editor", "viewer"]) });

/** Only the owner invites. */
export async function POST(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const a = await graphAccess(id, user.id);
  if (!a) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  if (a.role !== "owner") return NextResponse.json({ error: "Приглашать может только владелец проекта" }, { status: 403 });
  const parsed = inviteBody.safeParse(await req.json().catch(() => null));
  const email = parsed.success ? normalizeEmail(parsed.data.email) : null;
  if (!parsed.success || !email) return NextResponse.json({ error: "Проверь адрес почты" }, { status: 400 });
  const r = await invite(id, email, parsed.data.role);
  if (r === "owner") return NextResponse.json({ error: "Это твой адрес: ты уже владелец" }, { status: 400 });
  return NextResponse.json({ ok: true, status: r, members: await listMembers(id) });
}

const removeBody = z.object({ userId: z.string().uuid().optional(), email: z.string().max(254).optional() });

/** The owner removes anyone; a member may leave. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const a = await graphAccess(id, user.id);
  const parsed = removeBody.safeParse(await req.json().catch(() => null));
  if (!a || !parsed.success) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const leaving = parsed.data.userId === user.id && !parsed.data.email;
  if (a.role !== "owner" && !leaving) return NextResponse.json({ error: "Удалять участников может только владелец" }, { status: 403 });
  await removeMember(id, parsed.data);
  return NextResponse.json({ ok: true, members: await listMembers(id) });
}
