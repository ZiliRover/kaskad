import { NextResponse } from "next/server";
import { z } from "zod";
import { graphDoc } from "@/lib/graph/types";
import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { canEdit, graphAccess } from "@/server/sharing";
import { createRun } from "@/server/runs";

const body = z.object({
  graphId: z.string().min(1).max(64),
  doc: graphDoc,
  targets: z.array(z.string()).min(1).max(500),
  mode: z.enum(["missing", "all"]),
  draft: z.boolean().optional(),
});

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  const { graphId, doc, targets, mode, draft } = parsed.data;
  const access = await graphAccess(graphId, user.id);
  if (!access) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  if (!canEdit(access.role)) return NextResponse.json({ error: "Только просмотр: запускать может владелец или редактор" }, { status: 403 });

  const r = await createRun(graphId, user.id, doc, targets, mode, isAdmin(user), !!draft);
  if (!r.ok) return NextResponse.json(r, { status: r.code === "funds" ? 402 : 422 });
  return NextResponse.json(r);
}
