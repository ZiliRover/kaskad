"use client";

import { ArrowLeftIcon, DownloadSimpleIcon, ImageSquareIcon, PencilSimpleIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { BRAND } from "@/config/brand";
import { formatKop, formatRub, toKop, type Fx } from "@/lib/money";
import type { CardsProgress } from "@/lib/cards";
import { mediaFiles, uploadFile } from "../studio/upload";

type Market = "wb" | "ozon";
interface Form { photoKey: string | null; photoUrl: string | null; product: string; marketplace: Market; slides: 5 | 7 | 10; style: string }
interface Plan { title: string; slides: string[]; slide: { usd: number; approx: boolean } }

const MARKETS: [Market, string][] = [["wb", "Wildberries"], ["ozon", "Ozon"]];
const COUNTS = [5, 7, 10] as const;

async function post<T>(url: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; funds: boolean }> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return { ok: false, error: "Нет связи с сервером", funds: false };
  if (r.status === 401) { window.location.assign("/login?next=/make/cards"); return { ok: false, error: "", funds: false }; }
  const d = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, data: d as T } : { ok: false, error: d.error ?? "Не получилось", funds: r.status === 402 };
}

function Photo({ form, onChange }: { form: Form; onChange: (key: string | null, url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (files: File[]) => {
    const f = files.find((x) => x.type.startsWith("image/"));
    if (!f) { if (files.length) setError("Нужна картинка: PNG, JPEG или WebP"); return; }
    setBusy(true); setError(null);
    try { const r = await uploadFile(f); onChange(r.key, r.url); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="cards-photo-wrap">
      <div
        className={`cards-photo${over ? " is-over" : ""}${form.photoUrl ? " has-photo" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void add(mediaFiles(e.dataTransfer.files)); }}
      >
        {form.photoUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={form.photoUrl} alt="Фото товара" />
            <button type="button" className="icon-btn cards-photo-x" aria-label="Убрать фото" onClick={() => onChange(null, null)}><XIcon size={14} aria-hidden /></button>
          </>
        ) : (
          <button type="button" className="cards-photo-add" disabled={busy} onClick={() => input.current?.click()}>
            <ImageSquareIcon size={28} aria-hidden />
            <span>{busy ? "Загружаю…" : "Загрузить фото товара"}</span>
            <span className="cards-photo-sub">или перетащи сюда</span>
          </button>
        )}
      </div>
      {error && <p className="auth-error">{error}</p>}
      <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp"
        onChange={(e) => { void add(mediaFiles(e.target.files)); e.target.value = ""; }} />
    </div>
  );
}

/** Product photo and a description in, a full marketplace slide set out. No canvas. */
export function CardsMaker({ fx, balanceKop, slideUsd, initial }: {
  fx: Fx;
  /** estimated price of one slide */
  slideUsd: number;
  /** null for operators: they run without a limit */
  balanceKop: number | null;
  initial: { graphId: string; progress: CardsProgress } | null;
}) {
  const [step, setStep] = useState<"form" | "plan" | "make">(initial ? "make" : "form");
  // a new account's bonus may not cover 7 slides: start from a set it can pay for
  const [form, setForm] = useState<Form>(() => ({
    photoKey: null, photoUrl: null, product: "", marketplace: "wb", style: "",
    slides: balanceKop !== null && balanceKop < toKop(slideUsd * 7, fx) ? 5 : 7,
  }));
  const [plan, setPlan] = useState<Plan | null>(null);
  const [graphId, setGraphId] = useState(initial?.graphId ?? null);
  const [progress, setProgress] = useState<CardsProgress | null>(initial?.progress ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; funds?: boolean } | null>(null);

  const pending = !!progress?.slides.some((s) => s.status === "waiting" || s.status === "working");
  useEffect(() => {
    if (step !== "make" || !graphId || (progress && !pending)) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/make/cards/${graphId}`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) setProgress(await r.json());
    }, 2500);
    return () => clearInterval(t);
  }, [step, graphId, pending, progress]);

  const makePlan = async () => {
    if (!form.photoKey) { setError({ text: "Загрузи фото товара" }); return; }
    if (form.product.trim().length < 3) { setError({ text: "Опиши товар: что это, из чего, размеры, чем хорош" }); return; }
    setBusy(true); setError(null);
    const r = await post<Plan>("/api/make/cards/plan", {
      product: form.product, photoKey: form.photoKey, marketplace: form.marketplace, slides: form.slides, style: form.style,
    });
    setBusy(false);
    if (!r.ok) { if (r.error) setError({ text: r.error }); return; }
    setPlan(r.data);
    setStep("plan");
    window.scrollTo({ top: 0 });
  };

  const make = async () => {
    if (!plan || !form.photoKey) return;
    const slides = plan.slides.map((s) => s.trim()).filter(Boolean);
    if (!slides.length) { setError({ text: "Нужен хотя бы один слайд" }); return; }
    setBusy(true); setError(null);
    const r = await post<{ graphId: string }>("/api/make/cards/run", { title: plan.title, photoKey: form.photoKey, marketplace: form.marketplace, slides });
    setBusy(false);
    if (!r.ok) { if (r.error) setError({ text: r.error, funds: r.funds }); return; }
    setGraphId(r.data.graphId);
    setProgress({
      name: plan.title, marketplace: form.marketplace, chargedKop: null,
      slides: slides.map(() => ({ status: "waiting" as const, url: null, error: null })),
    });
    setStep("make");
    window.history.replaceState(null, "", `/make/cards?project=${r.data.graphId}`);
    window.scrollTo({ top: 0 });
  };

  const restart = () => {
    setStep("form"); setPlan(null); setGraphId(null); setProgress(null); setError(null);
    window.history.replaceState(null, "", "/make/cards");
  };

  const slideKop = plan ? toKop(plan.slide.usd, fx) : 0;
  const count = plan?.slides.filter((s) => s.trim()).length ?? 0;
  const total = plan ? `${plan.slide.approx ? "≈ " : ""}${formatRub(plan.slide.usd * count, fx)}` : "";
  const done = progress?.slides.filter((s) => s.status === "done").length ?? 0;
  const failed = progress?.slides.filter((s) => s.status === "failed").length ?? 0;

  return (
    <div className="app-page">
      <header className="app-top">
        <a className="auth-brand" href="/studio"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></a>
        <span className="app-top-right">
          <a className="link-btn" href="/studio">Все задачи</a>
          {balanceKop !== null && <a className="btn btn-ghost btn-sm" href="/studio?topup=1" title="Пополнить">Баланс {formatKop(Math.max(0, balanceKop))}</a>}
        </span>
      </header>

      <main className="cards">
        {step === "form" && (
          <form className="cards-form" onSubmit={(e) => { e.preventDefault(); if (!busy) void makePlan(); }}>
            <div>
              <h1 className="app-title">Карточки для маркетплейса</h1>
              <p className="app-desc cards-lead">Фото товара и пара фраз о нём. Придумаем тексты слайдов, покажем их до оплаты, потом нарисуем комплект в одном стиле, сразу в размере площадки.</p>
            </div>
            <div className="cards-grid">
              <div className="app-field">
                <span className="auth-label">Фото товара</span>
                <Photo form={form} onChange={(photoKey, photoUrl) => setForm((f) => ({ ...f, photoKey, photoUrl }))} />
                <span className="app-hint">Товар крупно, детали хорошо видно. Подойдёт снимок с телефона.</span>
              </div>
              <div className="cards-fields">
                <div className="app-field">
                  <label className="auth-label" htmlFor="product">Что за товар</label>
                  <textarea id="product" className="field app-textarea" rows={6} maxLength={2000} value={form.product}
                    placeholder="Кожаная сумка-шоппер, чёрная, 35×30 см. Натуральная кожа, внутренний карман на молнии, длинные ручки. Для работы и на каждый день."
                    onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))} />
                  <span className="app-hint">Материал, размеры, главные плюсы. Чем точнее, тем лучше тексты на слайдах.</span>
                </div>
                <div className="cards-row">
                  <div className="app-field">
                    <span className="auth-label">Площадка</span>
                    <div className="agent-tabs" role="radiogroup" aria-label="Площадка">
                      {MARKETS.map(([k, l]) => (
                        <button key={k} type="button" role="radio" aria-checked={form.marketplace === k} className={form.marketplace === k ? "is-on" : undefined}
                          onClick={() => setForm((f) => ({ ...f, marketplace: k }))}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <div className="app-field">
                    <span className="auth-label">Слайдов <span className="app-optional">· ≈ {formatRub(slideUsd * form.slides, fx)}</span></span>
                    <div className="agent-tabs" role="radiogroup" aria-label="Количество слайдов">
                      {COUNTS.map((n) => (
                        <button key={n} type="button" role="radio" aria-checked={form.slides === n} className={form.slides === n ? "is-on" : undefined}
                          onClick={() => setForm((f) => ({ ...f, slides: n }))}>{n}</button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="app-field">
                  <label className="auth-label" htmlFor="style">Стиль <span className="app-optional">· необязательно</span></label>
                  <input id="style" className="field" maxLength={300} value={form.style} placeholder="Минимализм, светлый фон, бежевые акценты"
                    onChange={(e) => setForm((f) => ({ ...f, style: e.target.value }))} />
                </div>
                {error && <p className="auth-error" role="alert">{error.text}</p>}
                <button type="submit" className="btn btn-primary app-run" disabled={busy}>{busy ? "Придумываю слайды…" : "Придумать слайды"}</button>
                <p className="app-hint cards-free">Это бесплатно. Платишь, только когда запускаешь отрисовку.</p>
              </div>
            </div>
          </form>
        )}

        {step === "plan" && plan && (
          <section className="cards-plan">
            <button type="button" className="link-btn cards-back" onClick={() => { setStep("form"); setError(null); }}>
              <ArrowLeftIcon size={12} aria-hidden />Изменить описание
            </button>
            <div className="cards-head">
              <div>
                <h1 className="app-title">{plan.title}</h1>
                <p className="app-desc cards-lead">Вот что будет на слайдах. В кавычках то, что напишем на картинке. Проверь цифры и характеристики: за них на площадке отвечает продавец.</p>
              </div>
              {form.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="cards-thumb" src={form.photoUrl} alt="Фото товара" />
              )}
            </div>
            <ol className="cards-slides">
              {plan.slides.map((s, i) => (
                <li key={i} className="cards-slide">
                  <span className="cards-num">{i + 1}</span>
                  <textarea className="field app-textarea" rows={5} maxLength={2000} value={s} aria-label={`Слайд ${i + 1}`}
                    onChange={(e) => setPlan((p) => p && { ...p, slides: p.slides.map((x, j) => (j === i ? e.target.value : x)) })} />
                  {plan.slides.length > 1 && (
                    <button type="button" className="icon-btn cards-drop" aria-label={`Убрать слайд ${i + 1}`}
                      onClick={() => setPlan((p) => p && { ...p, slides: p.slides.filter((_, j) => j !== i) })}>
                      <XIcon size={12} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <div className="cards-bar">
              <span className="cards-price">
                {count} {count === 1 ? "слайд" : count < 5 ? "слайда" : "слайдов"} по {formatKop(slideKop)} · {MARKETS.find(([k]) => k === form.marketplace)![1]}, 900×1200
              </span>
              {error && (
                <p className="auth-error" role="alert">
                  {error.text}{error.funds && <> <a className="link-btn" href="/studio?topup=1">Пополнить баланс</a></>}
                </p>
              )}
              <button type="button" className="btn btn-primary app-run" disabled={busy || !count} onClick={() => void make()}>
                {busy ? "Запускаю…" : `Нарисовать карточки · ${total}`}
              </button>
            </div>
          </section>
        )}

        {step === "make" && progress && (
          <section className="cards-result" aria-live="polite">
            <div className="cards-head">
              <div>
                <h1 className="app-title">{progress.name}</h1>
                <p className="app-desc cards-lead">
                  {pending
                    ? `Рисую слайды: готово ${done} из ${progress.slides.length}. Обычно это 1–2 минуты, страницу можно закрыть, результат сохранится в проектах.`
                    : failed
                      ? `Готово ${done} из ${progress.slides.length}. Не получилось: ${failed}. Их можно перезапустить в редакторе.`
                      : `Готово: ${done} ${done === 1 ? "слайд" : done < 5 ? "слайда" : "слайдов"} для ${progress.marketplace === "wb" ? "Wildberries" : "Ozon"}, 900×1200.`}
                  {progress.chargedKop !== null && progress.chargedKop > 0 && !pending && <> Списано {formatKop(progress.chargedKop)}.</>}
                </p>
              </div>
            </div>
            <div className="cards-actions">
              {done > 0 && !pending && (
                <a className="btn btn-primary" href={`/api/graphs/${graphId}/zip?node=s-fit`} download>
                  <DownloadSimpleIcon size={15} aria-hidden />Скачать всё архивом
                </a>
              )}
              <a className="btn btn-ghost" href={`/studio/${graphId}`}><PencilSimpleIcon size={15} aria-hidden />Открыть в редакторе</a>
              <button type="button" className="btn btn-ghost" onClick={restart}>Новый комплект</button>
            </div>
            <ol className="cards-tiles">
              {progress.slides.map((s, i) => (
                <li key={i} className={`cards-tile is-${s.status}`}>
                  <div className="cards-tile-media">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" aria-label={`Слайд ${i + 1} крупно`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={s.url} alt={`Слайд ${i + 1}`} />
                      </a>
                    ) : s.status === "failed" ? (
                      <div className="cards-tile-error"><WarningCircleIcon size={20} aria-hidden /><span>{s.error}</span></div>
                    ) : (
                      <div className="cards-tile-wait skeleton"><span>{s.status === "working" ? "Рисую…" : "В очереди"}</span></div>
                    )}
                  </div>
                  <div className="cards-tile-foot">
                    <span>Слайд {i + 1}</span>
                    {s.url && <a className="link-btn" href={`${s.url}?download`} download>Скачать</a>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </main>
    </div>
  );
}
