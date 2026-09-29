import { NextResponse } from "next/server";
import { canReadFile } from "@/server/access";
import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { ProviderError } from "@/server/providers";
import { planSlides, sellerRequest, slidePriceUsd } from "@/server/seller";

const recent = new Map<string, number[]>();
const PER_HOUR = 20;

/** Plans the slides (free): the seller reads and edits them before paying for images. */
export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = sellerRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Загрузи фото товара и опиши его" }, { status: 400 });
  if (!(await canReadFile(parsed.data.photoKey, user.id))) return NextResponse.json({ error: "Фото недоступно, загрузи его заново" }, { status: 400 });
  if (!isAdmin(user)) {
    const now = Date.now();
    const hits = (recent.get(user.id) ?? []).filter((t) => now - t < 3_600_000);
    if (hits.length >= PER_HOUR) return NextResponse.json({ error: "Слишком часто: попробуй через час" }, { status: 429 });
    recent.set(user.id, [...hits, now]);
  }
  try {
    const { title, slides } = await planSlides(parsed.data);
    return NextResponse.json({ title, slides, slide: slidePriceUsd() });
  } catch (e) {
    if (!(e instanceof ProviderError)) console.error("[cards]", e);
    return NextResponse.json({ error: e instanceof ProviderError ? e.message : "Не удалось придумать слайды, попробуй ещё раз" }, { status: 502 });
  }
}
