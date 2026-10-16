import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { isDesktop } from "@/server/desktop";
import { checkOpenRouterKey, saveDesktopKey } from "@/server/desktop-key";

/** Desktop app: keep the person's OpenRouter key once OpenRouter confirms it works. */
export async function POST(req: Request) {
  if (!isDesktop()) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const { deny } = await requireUser();
  if (deny) return deny;
  const body = await req.json().catch(() => null);
  const key = typeof body?.key === "string" ? body.key.trim() : "";
  if (key.length < 20 || key.length > 300 || /\s/.test(key)) {
    return NextResponse.json({ error: "Это не похоже на ключ OpenRouter" }, { status: 400 });
  }
  const check = await checkOpenRouterKey(key);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
  saveDesktopKey(key);
  return NextResponse.json({ ok: true });
}
