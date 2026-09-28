import { NextResponse } from "next/server";
import { z } from "zod";
import { appValues } from "@/lib/apps";
import { isAdmin } from "@/server/admin";
import { AppError, getApp, runApp } from "@/server/apps";
import { requireUser } from "@/server/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const body = z.object({ values: appValues });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const app = UUID.test(id) ? await getApp(id) : null;
  if (!app) return NextResponse.json({ error: "Приложение не найдено" }, { status: 404 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const r = await runApp(app, user.id, parsed.data.values, isAdmin(user));
    if (!r.ok) return NextResponse.json(r, { status: r.code === "funds" ? 402 : 422 });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
