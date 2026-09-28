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

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, busy]);

  const build = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await fetch("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ request }),
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
              <h2 id="agent-title" className="dialog-title">Собрать граф по описанию</h2>
              <button type="button" className="icon-btn" aria-label="Закрыть" disabled={busy} onClick={() => setOpen(false)}>
                <XIcon size={14} weight="bold" aria-hidden />
              </button>
            </div>

            {!result ? (
              <form className="agent-form" onSubmit={(e) => { e.preventDefault(); if (request.trim().length >= 3) void build(); }}>
                <textarea
                  className="field agent-input" rows={4} autoFocus maxLength={2000} disabled={busy}
                  placeholder="Что нужно получить? Например: вертикальное видео с моим товаром, который вращается на подиуме"
                  value={request} onChange={(e) => setRequest(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && request.trim().length >= 3) void build(); }}
                />
                <div className="agent-examples">
                  {EXAMPLES.map((x) => (
                    <button key={x} type="button" className="chip" disabled={busy} onClick={() => setRequest(x)}>{x}</button>
                  ))}
                </div>
                {error && <p className="auth-error" role="alert">{error}</p>}
                <div className="dialog-actions">
                  <span className="agent-note">Агент подберёт модели и напишет промты. Ты увидишь граф и цену до запуска.</span>
                  <button type="submit" className="btn btn-primary" disabled={busy || request.trim().length < 3}>
                    {busy ? "Собираю граф…" : "Собрать"}
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
