/**
 * The quality judge: a vision model scores candidate images against criteria and
 * names the best one. Used by the "Лучший вариант" node.
 */
import { getProvider, providerMode, ProviderError } from "./providers";

const JUDGE_MODEL = "anthropic/claude-sonnet-5";

export const DEFAULT_CRITERIA =
  "Главный объект чёткий и целиком в кадре, нет артефактов и искажений (лишние пальцы, поплывший текст, мусор), композиция аккуратная, картинка соответствует задумке.";

export interface Verdict { best: number; score: number; why: string; scores: number[]; costUsd: number | null }

/** Scores images 1..N (data URLs) from 1 to 10; returns the index of the best one. */
export async function judge(images: string[], criteria: string, intent: string): Promise<Verdict> {
  if (!images.length) throw new ProviderError("Нечего сравнивать: подключи картинки");
  if (providerMode() === "mock") {
    // test mode: a stable pseudo-score per image
    const scores = images.map((img, i) => 5 + ((img.length + i * 7) % 5));
    const best = scores.indexOf(Math.max(...scores));
    return { best, score: scores[best], why: "Тестовый режим: оценка условная", scores, costUsd: 0 };
  }
  const system = `You are a strict art director. You get ${images.length} candidate images, numbered 1..${images.length} in order.
Score each from 1 to 10 against the criteria, then pick the best. Reply with ONE JSON object only:
{"scores": [numbers in image order], "best": <number 1..${images.length}>, "why": "<one short sentence in Russian about why the best one wins>"}`;
  const prompt = `Критерии: ${criteria}${intent ? `\nЗадумка автора: ${intent}` : ""}`;
  const r = await getProvider().text({ model: JUDGE_MODEL, system, prompt, images });
  let d: { scores?: unknown; best?: unknown; why?: unknown } = {};
  try { d = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1)); } catch { /* below */ }
  const scores = Array.isArray(d.scores) ? d.scores.map((x) => Math.max(0, Math.min(10, Number(x) || 0))) : [];
  let best = Number(d.best) - 1;
  if (!Number.isInteger(best) || best < 0 || best >= images.length) best = scores.length ? scores.indexOf(Math.max(...scores)) : 0;
  return { best, score: scores[best] ?? 0, why: typeof d.why === "string" ? d.why.slice(0, 300) : "", scores, costUsd: r.costUsd };
}
