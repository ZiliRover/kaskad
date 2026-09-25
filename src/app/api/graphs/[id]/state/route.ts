import { NextResponse } from "next/server";
import { graphExists, graphState } from "@/server/graphs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await graphExists(id))) return NextResponse.json({ error: "Граф не найден" }, { status: 404 });
  return NextResponse.json(await graphState(id));
}
