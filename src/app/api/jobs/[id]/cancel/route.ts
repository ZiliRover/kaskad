import { NextResponse } from "next/server";
import { cancelJob } from "@/server/worker/queue";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
  const r = await cancelJob(id);
  if (r === "not-active") return NextResponse.json({ error: "Задача уже завершена" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
