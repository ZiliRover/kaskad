import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { getProvider, ProviderError } from "@/server/providers";

/** Cheap, fast model: rewriting a prompt costs a fraction of a kopeck. */
const MODEL = "deepseek/deepseek-v4.1-flash";

const body = z.object({
  text: z.string().trim().min(1).max(8000),
  target: z.enum(["image", "video", "text"]).nullable(),
  mode: z.enum(["improve", "translate"]),
});

const TARGET_HINT = {
  image: "for an image generation model: subject, composition, lighting, lens, style, colour",
  video: "for a video generation model: what happens over time, camera movement, pacing, lighting, sound",
  text: "for a text model: clear task, context and expected output format",
} as const;

function system(mode: "improve" | "translate", target: keyof typeof TARGET_HINT | null): string {
  if (mode === "translate") {
    return "Translate the user's prompt into natural English for a generative AI model. Keep every detail and proper names. Output only the translation.";
  }
  return [
    `Rewrite the user's idea into one strong prompt ${TARGET_HINT[target ?? "image"]}.`,
    "Keep the user's intent and every concrete detail; add specifics only where the idea is vague.",
    "Answer in the same language as the user. Output only the prompt, no preamble, no quotes, under 120 words.",
  ].join(" ");
}

// rewriting a prompt costs a fraction of a kopeck, so it is free, but not unlimited
const recent = new Map<string, number[]>();
const PER_MINUTE = 20;

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const now = Date.now();
  const hits = (recent.get(user.id) ?? []).filter((t) => now - t < 60_000);
  if (hits.length >= PER_MINUTE) return NextResponse.json({ error: "Слишком часто. Подождите минуту." }, { status: 429 });
  recent.set(user.id, [...hits, now]);
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Нечего улучшать" }, { status: 400 });
  const { text, target, mode } = parsed.data;
  try {
    const r = await getProvider().text({ model: MODEL, prompt: text, system: system(mode, target), images: [] });
    return NextResponse.json({ text: r.text.replace(/^["«]|["»]$/g, "").trim() });
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "Не удалось улучшить промт";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
