import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { myPosts, PostError, publishPost } from "@/server/posts";

/** Which of my results are in the showcase (result id → post id). */
export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json(await myPosts(user.id));
}

const body = z.object({ outputId: z.string().uuid(), showPrompt: z.boolean().default(true) });

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const p = await publishPost(user.id, parsed.data.outputId, parsed.data.showPrompt);
    return NextResponse.json({ id: p.id });
  } catch (e) {
    if (e instanceof PostError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
