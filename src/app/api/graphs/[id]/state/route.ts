import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { graphState, ownedGraph } from "@/server/graphs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!(await ownedGraph(id, user.id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json(await graphState(id));
}
