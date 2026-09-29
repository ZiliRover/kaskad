import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { listMedia } from "@/server/media";

export async function GET(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const q = new URL(req.url).searchParams;
  const before = q.get("before");
  return NextResponse.json(await listMedia(user.id, {
    source: q.get("source") === "uploads" ? "uploads" : "results",
    kind: q.get("kind") ?? undefined,
    q: (q.get("q") ?? "").trim().slice(0, 100) || undefined,
    before: before && !Number.isNaN(Date.parse(before)) ? before : undefined,
  }));
}
