import { NextResponse } from "next/server";
import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { cardsStart, startCards } from "@/server/cards";

/** Makes the planned slides: a new project, run to the end. */
export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = cardsStart.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверь слайды: в каждом нужен текст" }, { status: 400 });
  const r = await startCards(user.id, parsed.data, isAdmin(user));
  if (!r.ok) return NextResponse.json(r, { status: r.code === "funds" ? 402 : 422 });
  return NextResponse.json(r);
}
