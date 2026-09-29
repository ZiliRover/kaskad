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
  const [mode, setMode] = useState<"graph" | "video">("graph");
  const [video, setVideo] = useState<VideoForm>({ seconds: 15, aspect: "9:16", voice: VOICES[0][0], subtitles: true, music: false, quality: "draft" });

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
                    : "Идея ролика. Например: утро в маленькой кофейне, бариста готовит капучино, город просыпается"}
                  value={request} onChange={(e) => setRequest(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && request.trim().length >= 3) void build(); }}
                />
                {mode === "graph" ? (
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
                    : "Режиссёр напишет сценарий по сценам и соберёт весь ролик: кадры, видео, монтаж, голос, субтитры."}</span>
                  <button type="submit" className="btn btn-primary" disabled={busy || request.trim().length < 3}>
                    {busy ? (mode === "graph" ? "Собираю граф…" : "Пишу сценарий…") : "Собрать"}
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
