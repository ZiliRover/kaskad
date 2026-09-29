import { NextResponse } from "next/server";
import { z } from "zod";
import { appField } from "@/lib/apps";
import { AppError, listApps, publishApp } from "@/server/apps";
import { requireUser } from "@/server/auth";

export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json(await listApps(user.id));
}

const body = z.object({
  graphId: z.string().min(1).max(64),
  name: z.string().max(80),
  description: z.string().max(600).default(""),
  fields: z.array(appField).max(20),
  outputs: z.array(z.string().min(1).max(64)).min(1).max(20),
  listed: z.boolean().default(false),
});

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверь поля и результаты приложения" }, { status: 400 });
  try {
    const app = await publishApp(user.id, parsed.data.graphId, parsed.data);
    return NextResponse.json({ id: app.id, url: `/app/${app.id}` });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
