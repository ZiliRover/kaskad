import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { createProject, listProjects } from "@/server/graphs";

export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json(await listProjects(user.id));
}

const body = z.object({
  name: z.string().max(80).optional(),
  from: z.enum(["empty", "starter"]).optional(),
  copyOf: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  const g = await createProject(user.id, parsed.data);
  if (!g) return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  return NextResponse.json({ id: g.id, name: g.name });
}
