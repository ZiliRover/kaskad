import { NextResponse } from "next/server";
import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { direct, directorRequest } from "@/server/director";
import { blockedVendors, ProviderError } from "@/server/providers";

// writing a script costs a couple of rubles at most: free, but not unlimited
const recent = new Map<string, number[]>();
const PER_HOUR = 20;

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = directorRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Опиши идею ролика" }, { status: 400 });
  if (!isAdmin(user)) {
    const now = Date.now();
    const hits = (recent.get(user.id) ?? []).filter((t) => now - t < 3_600_000);
    if (hits.length >= PER_HOUR) return NextResponse.json({ error: "Режиссёр устал: попробуй через час" }, { status: 429 });
    recent.set(user.id, [...hits, now]);
  }
  try {
    return NextResponse.json(await direct(parsed.data, blockedVendors()));
  } catch (e) {
    if (!(e instanceof ProviderError)) console.error("[director]", e);
    return NextResponse.json({ error: e instanceof ProviderError ? e.message : "Не удалось собрать ролик" }, { status: 502 });
  }
}
