import { NextResponse } from "next/server";
import { graphExists, listOutputs } from "@/server/graphs";

/** Results newest first: one node's versions (?node=) or the whole graph's gallery. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const node = new URL(req.url).searchParams.get("node");
  if (node !== null && (!node || node.length > 64)) return NextResponse.json({ error: "Некорректная нода" }, { status: 400 });
  if (!(await graphExists(id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json(await listOutputs(id, node, node ? 100 : 200));
}
