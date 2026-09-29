import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { listOutputs } from "@/server/graphs";
import { graphAccess } from "@/server/sharing";

/** Results newest first: one node's versions (?node=) or the whole graph's gallery. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const node = new URL(req.url).searchParams.get("node");
  if (node !== null && (!node || node.length > 64)) return NextResponse.json({ error: "Некорректная нода" }, { status: 400 });
  if (!(await graphAccess(id, user.id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json(await listOutputs(id, node, node ? 100 : 200));
}
