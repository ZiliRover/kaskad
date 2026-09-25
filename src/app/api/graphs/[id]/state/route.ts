import { NextResponse } from "next/server";
import { graphState } from "@/server/graphs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await graphState(id));
}
