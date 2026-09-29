import { NextResponse } from "next/server";
import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { listFeed } from "@/server/posts";

export async function GET(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const q = new URL(req.url).searchParams;
  const kind = q.get("kind");
  return NextResponse.json(await listFeed(
    user.id, q.get("sort") === "new" ? "new" : "top", Number(q.get("offset")) || 0,
    kind === "image" || kind === "video" ? kind : undefined, isAdmin(user),
  ));
}
