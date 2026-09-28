import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/server/admin";
import { buildGraph } from "@/server/agent";
import { requireUser } from "@/server/auth";
import { blockedVendors, ProviderError } from "@/server/providers";

const body = z.object({ request: z.string().trim().min(3).max(2000) });

// planning a graph costs a couple of rubles at most: free, but not unlimited
const recent = new Map<string, number[]>();
const PER_HOUR = 20;

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Опиши задачу хотя бы парой слов" }, { status: 400 });

  if (!isAdmin(user)) {
    const now = Date.now();
    const hits = (recent.get(user.id) ?? []).filter((t) => now - t < 3_600_000);
    if (hits.length >= PER_HOUR) return NextResponse.json({ error: "Агент устал: попробуй через час" }, { status: 429 });
    recent.set(user.id, [...hits, now]);
  }

  try {
    const r = await buildGraph(parsed.data.request, blockedVendors());
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "Не удалось собрать граф";
    if (!(e instanceof ProviderError)) console.error("[agent]", e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
