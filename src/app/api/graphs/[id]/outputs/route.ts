import { NextResponse } from "next/server";
import { graphExists, listOutputs } from "@/server/graphs";

/** All results of one node, newest first: the node's version history. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const node = new URL(req.url).searchParams.get("node") ?? "";
  if (!node || node.length > 64) return NextResponse.json({ error: "Не указана нода" }, { status: 400 });
  if (!(await graphExists(id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json(await listOutputs(id, node));
}
