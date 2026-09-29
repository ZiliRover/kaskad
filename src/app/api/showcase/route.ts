import { NextResponse } from "next/server";
import { listShowcase } from "@/server/apps";
import { requireUser } from "@/server/auth";

export async function GET(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const q = new URL(req.url).searchParams;
  return NextResponse.json(await listShowcase(user.id, q.get("sort") === "new" ? "new" : "top", (q.get("q") ?? "").trim().slice(0, 80)));
}
