"use client";

import { ColumnsIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { formatKop, formatRub, toKop } from "@/lib/money";
import { estimate } from "@/lib/models/pricing";
import { MODELS, defaultParams, getModel, isBlocked } from "@/lib/models/registry";
import { isActive, useStudio } from "./store";

const MAX_EXTRA = 3;

/** Node header button: copies of this node with other models, on the same inputs. */
export function CompareMenu({ nodeId, modelId }: { nodeId: string; modelId: string }) {
  const { compareWith, run, toast, fx, blocked } = useStudio(useShallow((s) => ({
    compareWith: s.compareWith, run: s.run, toast: s.toast, fx: s.fx, blocked: s.blockedVendors,
  })));
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const spec = getModel(modelId);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [open]);

  if (!spec || spec.pricing.type === "free") return null;
  // same job, other vendors: featured first (MODELS is already ordered that way)
  const options = MODELS.filter((m) => m.group === spec.group && m.id !== spec.id && !isBlocked(m.id, blocked)).slice(0, 14);

  const add = () => {
    const ids = compareWith(nodeId, picked);
    setOpen(false);
    setPicked([]);
    toast(`Добавлено для сравнения: ${ids.length - 1}. Запусти, потом выдели их и нажми «Сравнить»`, false, {
      label: "Запустить все", run: () => void run(ids, "missing"),
    });
  };

  return (
    <div className="enhance nodrag" ref={root}>
      <button
        type="button" className="icon-btn enhance-btn" aria-haspopup="menu" aria-expanded={open}
        title="Сравнить с другими моделями" aria-label="Сравнить с другими моделями" onClick={() => setOpen((v) => !v)}
      >
        <ColumnsIcon size={14} aria-hidden />
      </button>
      {open && (
        <div className="menu compare-menu" role="menu">
          <span className="compare-menu-title">С чем сравнить (до {MAX_EXTRA})</span>
          <div className="compare-options nowheel">
            {options.map((m) => {
              const on = picked.includes(m.id);
              const usd = estimate(m, { params: defaultParams(m), inputCounts: {}, promptChars: 300 }).usd;
              return (
                <label key={m.id} className={`compare-option${on ? " is-on" : ""}`}>
                  <input
                    type="checkbox" checked={on} disabled={!on && picked.length >= MAX_EXTRA}
                    onChange={() => setPicked((p) => (on ? p.filter((x) => x !== m.id) : [...p, m.id]))}
                  />
                  <span className="compare-name">{m.name}<span className="compare-vendor">{m.vendor}</span></span>
                  {usd !== null && <span className="compare-price">{formatRub(usd, fx)}</span>}
                </label>
              );
            })}
          </div>
          <button type="button" className="btn btn-primary btn-sm" disabled={!picked.length} onClick={add}>
            Добавить {picked.length ? picked.length : ""}
          </button>
        </div>
      )}
    </div>
  );
}

/** Appears over the canvas when several model nodes are selected. */
export function SelectionBar() {
  const { selected, withOutput, anyBusy } = useStudio(useShallow((s) => {
    const models = s.nodes.filter((n) => n.selected && n.type === "model");
    return {
      selected: models.map((n) => n.id).join(","),
      withOutput: models.filter((n) => s.state[n.id]?.output).map((n) => n.id).join(","),
      anyBusy: models.some((n) => isActive(s.state, n.id)),
    };
  }));
  const run = useStudio((s) => s.run);
  const setPanel = useStudio((s) => s.setPanel);
  const ids = selected ? selected.split(",") : [];
  const ready = withOutput ? withOutput.split(",") : [];
  if (ids.length < 2) return null;

  return (
    <div className="selection-bar" role="toolbar" aria-label="Выбранные ноды">
      <span className="selection-count">Выбрано моделей: {ids.length}</span>
      <button type="button" className="btn btn-sm" disabled={anyBusy} onClick={() => void run(ids, "missing")}>
        <PlayIcon size={12} weight="fill" aria-hidden />Запустить
      </button>
      <button
        type="button" className="btn btn-primary btn-sm" disabled={ready.length < 2}
        title={ready.length < 2 ? "Сравнить можно, когда хотя бы у двух есть результат" : undefined}
        onClick={() => setPanel({ compareIds: ready })}
      >
        <ColumnsIcon size={13} aria-hidden />Сравнить
      </button>
    </div>
  );
}

/** Results of the chosen nodes side by side, with what each cost. */
export function CompareView() {
  const ids = useStudio((s) => s.compareIds);
  const setPanel = useStudio((s) => s.setPanel);
  const setLightbox = useStudio((s) => s.setLightbox);
  const nodes = useStudio(useShallow((s) => ids.map((id) => s.nodes.find((n) => n.id === id)).filter((n) => n?.type === "model")));
  const state = useStudio((s) => s.state);
  const fx = useStudio((s) => s.fx);
  const close = () => setPanel({ compareIds: [] });

  useEffect(() => {
    if (!ids.length) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPanel({ compareIds: [] }); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [ids.length, setPanel]);

  if (!ids.length) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog compare" role="dialog" aria-modal="true" aria-labelledby="compare-title">
        <div className="templates-head">
          <h2 id="compare-title" className="dialog-title">Сравнение</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={close}><XIcon size={14} weight="bold" aria-hidden /></button>
        </div>
        <div className="compare-grid" style={{ gridTemplateColumns: `repeat(${Math.min(nodes.length, 4)}, minmax(0, 1fr))` }}>
          {nodes.map((n) => {
            if (!n || n.type !== "model") return null;
            const spec = getModel(n.data.modelId);
            const st = state[n.id];
            const out = st?.output;
            const job = st?.job;
            const kop = job?.chargedKop ?? (job?.costUsd != null ? toKop(job.costUsd, fx) : null);
            return (
              <figure key={n.id} className="compare-col">
                <figcaption>
                  <span className="compare-name">{spec?.name ?? n.data.modelId}<span className="compare-vendor">{spec?.vendor}</span></span>
                  {kop !== null && <span className="compare-price">{formatKop(kop)}</span>}
                </figcaption>
                <div className="compare-media">
                  {out?.kind === "image" && out.url && (
                    <button type="button" onClick={() => setLightbox(out.url)} aria-label="Открыть крупно">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={out.url} alt={`Результат ${spec?.name ?? ""}`} />
                    </button>
                  )}
                  {out?.kind === "video" && out.url && <video src={`${out.url}#t=0.1`} controls loop playsInline preload="metadata" />}
                  {out?.kind === "text" && <div className="compare-text">{out.text}</div>}
                  {!out && <span className="compare-empty">Нет результата</span>}
                </div>
              </figure>
            );
          })}
        </div>
      </div>
    </div>
  );
}
