import { NextResponse } from "next/server";
import { z } from "zod";
import { graphDoc } from "@/lib/graph/types";
import { requireUser } from "@/server/auth";
import { ownedGraph } from "@/server/graphs";
import { createRun } from "@/server/runs";

const body = z.object({
  graphId: z.string().min(1).max(64),
  doc: graphDoc,
  targets: z.array(z.string()).min(1).max(500),
  mode: z.enum(["missing", "all"]),
});

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  const { graphId, doc, targets, mode } = parsed.data;
  if (!(await ownedGraph(graphId, user.id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });

  const r = await createRun(graphId, user.id, doc, targets, mode);
  if (!r.ok) return NextResponse.json(r, { status: r.code === "funds" ? 402 : 422 });
  return NextResponse.json(r);
}
