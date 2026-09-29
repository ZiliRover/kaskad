import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { REPORT_REASONS, reportPost } from "@/server/posts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({ reason: z.enum(REPORT_REASONS) });

/** Complain about a post; enough complaints take it off the wall. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!UUID.test(id) || !parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  if (!(await reportPost(id, user.id, parsed.data.reason))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
