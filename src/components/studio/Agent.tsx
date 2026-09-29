"use client";

import { ArrowRightIcon, SparkleIcon, XIcon } from "@phosphor-icons/react";
import { useReactFlow } from "@xyflow/react";
import { Fragment, useEffect, useState } from "react";
import { fanOut } from "@/lib/graph/plan";
import { outputHandle, type GraphEdge, type GraphNode } from "@/lib/graph/types";
import { formatRub } from "@/lib/money";
import { estimate } from "@/lib/models/pricing";
import { getModel } from "@/lib/models/registry";
import { NodeIcon } from "./icons";
import { authLost, useStudio } from "./store";
import { iconFor, nodeLabel } from "./Templates";
import { uploadFile } from "./upload";

interface Proposal { title: string; summary: string; nodes: GraphNode[]; edges: GraphEdge[]; fixes: string[] }

const EXAMPLES = [
  "Видео-обзор товара для WB из моего фото, вертикальное",
  "10 аватарок в разных стилях из одного описания",
  "Ролик на 15 секунд из трёх сцен про уютную кофейню",
  "Перерисовать мою картинку в стиле аниме и сделать 9:16",
];

const VOICES: [string, string][] = [
  ["Russian_ReliableMan", "Мужской, спокойный"], ["Russian_AttractiveGuy", "Мужской, обаятельный"],
  ["Russian_BrightHeroine", "Женский, яркий"], ["Russian_AmbitiousWoman", "Женский, уверенный"],
];

interface CardsForm { marketplace: "wb" | "ozon"; slides: 5 | 7 | 10; style: string; photo: { key: string; url: string } | null }

interface VideoForm { seconds: 15 | 30 | 60; aspect: "9:16" | "16:9" | "1:1"; voice: string; subtitles: boolean; music: boolean; quality: "draft" | "final" }

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="director-field">
      <span className="auth-label">{label}</span>
      <div className="director-chips" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className={`chip${value === v ? " is-on" : ""}`} onClick={() => onChange(v)}>{l}</button>
        ))}
      </div>
    </div>
  );
}

/** Price of one run of the whole proposal (lists multiply their models). */
function proposalPrice(p: Proposal): { usd: number; approx: boolean } {
  const fans = fanOut(p);
  let usd = 0, approx = false;
  for (const n of p.nodes) {
    if (n.type !== "model") continue;
    const spec = getModel(n.data.modelId);
    if (!spec) continue;
    const counts: Record<string, number> = {};
    for (const e of p.edges) if (e.target === n.id) counts[e.targetHandle] = (counts[e.targetHandle] ?? 0) + 1;
    const est = estimate(spec, { params: n.data.params, inputCounts: counts, promptChars: 400 });
    if (est.usd === null) { approx = true; continue; }
    usd += est.usd * (fans.get(n.id) || 1);
    approx ||= est.approx;
  }
  return { usd, approx };
}

/** "Build from a description": the header button and its dialog. */
export function Agent() {
  const insert = useStudio((s) => s.insertTemplate);
  const fx = useStudio((s) => s.fx);
  const { fitView } = useReactFlow();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Proposal | null>(null);
  const [mode, setMode] = useState<"graph" | "video" | "cards">("graph");
  const [cards, setCards] = useState<CardsForm>({ marketplace: "wb", slides: 7, style: "", photo: null });
  const [uploading, setUploading] = useState(false);
  const [video, setVideo] = useState<VideoForm>({ seconds: 15, aspect: "9:16", voice: VOICES[0][0], subtitles: true, music: false, quality: "draft" });

  // "Ролик по идее" on the start screen lands here with ?open=director
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("open") !== "director") return;
    setMode("video");
    setOpen(true);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, busy]);

  const build = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = mode === "graph"
        ? await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }) })
        : mode === "cards"
          ? await fetch("/api/seller", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ product: request, photoKey: cards.photo?.key, marketplace: cards.marketplace, slides: cards.slides, style: cards.style }),
          })
          : await fetch("/api/director", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idea: request, ...video, voice: video.voice || null }),
        });
      if (authLost(r)) return;
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error ?? "Не удалось собрать граф");
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    if (!result) return;
    const ids = insert({ id: "agent", title: result.title, description: result.summary, audience: "", build: () => ({ nodes: result.nodes, edges: result.edges }) });
    setOpen(false);
    setResult(null);
    setRequest("");
    setTimeout(() => fitView({ nodes: ids.map((id) => ({ id })), padding: 0.2, duration: 400 }), 80);
  };

  const price = result ? proposalPrice(result) : null;
  const chain = result?.nodes.filter((n) => n.type !== "note") ?? [];

  return (
    <>
      <button type="button" className="btn btn-ghost" aria-label="Собрать граф по описанию" title="Собрать граф по описанию" onClick={() => setOpen(true)}>
        <SparkleIcon size={15} aria-hidden /><span className="tb-label">Собрать</span>
      </button>
      {open && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
          <div className="dialog agent" role="dialog" aria-modal="true" aria-labelledby="agent-title">
            <div className="templates-head">
              <div className="agent-tabs" role="tablist">
                <button type="button" role="tab" aria-selected={mode === "graph"} className={mode === "graph" ? "is-on" : undefined}
                  disabled={busy || !!result} onClick={() => setMode("graph")}>Граф по описанию</button>
                <button type="button" role="tab" aria-selected={mode === "video"} className={mode === "video" ? "is-on" : undefined}
                  disabled={busy || !!result} onClick={() => setMode("video")}>Ролик по идее</button>
                <button type="button" role="tab" aria-selected={mode === "cards"} className={mode === "cards" ? "is-on" : undefined}
                  disabled={busy || !!result} onClick={() => setMode("cards")}>Карточки товара</button>
              </div>
              <h2 id="agent-title" className="sr-only">Собрать граф</h2>
              <button type="button" className="icon-btn" aria-label="Закрыть" disabled={busy} onClick={() => setOpen(false)}>
                <XIcon size={14} weight="bold" aria-hidden />
              </button>
            </div>

            {!result ? (
              <form className="agent-form" onSubmit={(e) => { e.preventDefault(); if (request.trim().length >= 3) void build(); }}>
                <textarea
                  className="field agent-input" rows={4} autoFocus maxLength={2000} disabled={busy}
                  placeholder={mode === "graph"
                    ? "Что нужно получить? Например: вертикальное видео с моим товаром, который вращается на подиуме"
                    : mode === "cards"
                      ? "Что за товар: название, материал, размеры, главные преимущества, для кого"
                      : "Идея ролика. Например: утро в маленькой кофейне, бариста готовит капучино, город просыпается"}
                  value={request} onChange={(e) => setRequest(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && request.trim().length >= 3) void build(); }}
                />
                {mode === "cards" ? (
                  <div className="director-options">
                    <div className="director-field">
                      <span className="auth-label">Фото товара</span>
                      <label className={`seller-photo${cards.photo ? " has-photo" : ""}`}>
                        {cards.photo
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={cards.photo.url} alt="Фото товара" />
                          : <span>{uploading ? "Загружаю…" : "Выбрать фото"}</span>}
                        <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={uploading}
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (!f) return;
                            setUploading(true); setError(null);
                            try { const u = await uploadFile(f); setCards((x) => ({ ...x, photo: { key: u.key, url: u.url } })); }
                            catch (err) { setError((err as Error).message); }
                            finally { setUploading(false); }
                          }} />
                      </label>
                    </div>
                    <div className="director-field">
                      <Choice label="Площадка" value={cards.marketplace} options={[["wb", "Wildberries"], ["ozon", "Ozon"]]}
                        onChange={(v) => setCards((x) => ({ ...x, marketplace: v as CardsForm["marketplace"] }))} />
                      <Choice label="Слайдов" value={String(cards.slides)} options={[["5", "5"], ["7", "7"], ["10", "10"]]}
                        onChange={(v) => setCards((x) => ({ ...x, slides: Number(v) as CardsForm["slides"] }))} />
                      <label className="director-field">
                        <span className="auth-label">Стиль (необязательно)</span>
                        <input className="field" maxLength={300} value={cards.style} placeholder="минимализм, пастельные тона"
                          onChange={(e) => setCards((x) => ({ ...x, style: e.target.value }))} />
                      </label>
                    </div>
                  </div>
                ) : mode === "graph" ? (
                  <div className="agent-examples">
                    {EXAMPLES.map((x) => (
                      <button key={x} type="button" className="chip" disabled={busy} onClick={() => setRequest(x)}>{x}</button>
                    ))}
                  </div>
                ) : (
                  <div className="director-options">
                    <Choice label="Длина" value={String(video.seconds)} options={[["15", "15 с"], ["30", "30 с"], ["60", "60 с"]]}
                      onChange={(v) => setVideo((x) => ({ ...x, seconds: Number(v) as 15 | 30 | 60 }))} />
                    <Choice label="Кадр" value={video.aspect} options={[["9:16", "9:16"], ["16:9", "16:9"], ["1:1", "1:1"]]}
                      onChange={(v) => setVideo((x) => ({ ...x, aspect: v as VideoForm["aspect"] }))} />
                    <Choice label="Качество" value={video.quality} options={[["draft", "Черновик"], ["final", "Финал"]]}
                      onChange={(v) => setVideo((x) => ({ ...x, quality: v as VideoForm["quality"] }))} />
                    <label className="director-field">
                      <span className="auth-label">Голос за кадром</span>
                      <select className="field" value={video.voice} onChange={(e) => setVideo((x) => ({ ...x, voice: e.target.value }))}>
                        <option value="">Без голоса</option>
                        {VOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    <label className="director-check"><input type="checkbox" checked={video.subtitles} onChange={(e) => setVideo((x) => ({ ...x, subtitles: e.target.checked }))} />Субтитры</label>
                    <label className="director-check"><input type="checkbox" checked={video.music} onChange={(e) => setVideo((x) => ({ ...x, music: e.target.checked }))} />Музыка (Lyria)</label>
                  </div>
                )}
                {error && <p className="auth-error" role="alert">{error}</p>}
                <div className="dialog-actions">
                  <span className="agent-note">{mode === "graph"
                    ? "Агент подберёт модели и напишет промты. Ты увидишь граф и цену до запуска."
                    : mode === "cards"
                      ? "Слайды в едином стиле по твоему фото: обложка, преимущества, размеры, применение. Сразу 900×1200 для площадки."
                      : "Режиссёр напишет сценарий по сценам и соберёт весь ролик: кадры, видео, монтаж, голос, субтитры."}</span>
                  <button type="submit" className="btn btn-primary" disabled={busy || request.trim().length < 3 || (mode === "cards" && !cards.photo)}>
                    {busy ? (mode === "graph" ? "Собираю граф…" : mode === "cards" ? "Планирую слайды…" : "Пишу сценарий…") : "Собрать"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="agent-result">
                <h3 className="tpl-title">{result.title}</h3>
                {result.summary && <p className="dialog-body">{result.summary}</p>}
                <div className="tpl-chain" aria-label="Цепочка нод">
                  {chain.map((n, i) => (
                    <Fragment key={n.id}>
                      {i > 0 && <ArrowRightIcon size={10} className="tpl-arrow" aria-hidden />}
                      <span className="tpl-step" title={nodeLabel(n)}>
                        <NodeIcon node={iconFor(n)} dtype={outputHandle(n)} size={13} />
                        <span>{nodeLabel(n) || "Список"}</span>
                      </span>
                    </Fragment>
                  ))}
                </div>
                {price && (
                  <p className="agent-price">
                    Запуск всей цепочки: {price.usd > 0 ? `${price.approx ? "примерно " : ""}${formatRub(price.usd, fx)}` : "бесплатно"}
                  </p>
                )}
                {result.fixes.length > 0 && <p className="agent-fixes">Поправлено при проверке: {result.fixes.join("; ")}</p>}
                <div className="dialog-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>Изменить запрос</button>
                  <button type="button" className="btn btn-primary" onClick={add}>Добавить на холст</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
