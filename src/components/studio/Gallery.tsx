"use client";

import { XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { OutputVersion } from "@/lib/jobs";
import { getModel } from "@/lib/models/registry";
import { PALETTE_MIME, setDragPayload, type PalettePayload } from "./Canvas";
import { useStudio } from "./store";

const time = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Every result on this canvas, newest first. Drag one onto the canvas to reuse it as an input. */
export function Gallery() {
  const open = useStudio((s) => s.galleryOpen);
  const setPanel = useStudio((s) => s.setPanel);
  const graphId = useStudio((s) => s.graphId);
  const setLightbox = useStudio((s) => s.setLightbox);
  const nodes = useStudio((s) => s.nodes);
  // total results across nodes: changes whenever something new is generated
  const total = useStudio((s) => Object.values(s.state).reduce((a, n) => a + n.outputCount, 0));
  const [items, setItems] = useState<OutputVersion[] | null>(null);
  const [filter, setFilter] = useState<"all" | "image" | "video" | "text">("all");

  useEffect(() => {
    if (!open || !graphId) return;
    let live = true;
    fetch(`/api/graphs/${graphId}/outputs`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((v: OutputVersion[]) => { if (live) setItems(v); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [open, graphId, total]);

  const names = useMemo(() => new Map(nodes.map((n) => [
    n.id, n.type === "model" ? getModel(n.data.modelId)?.name ?? "Модель" : "Нода",
  ])), [nodes]);

  if (!open) return null;
  const shown = (items ?? []).filter((i) => filter === "all" || i.kind === filter);

  const payloadFor = (o: OutputVersion): PalettePayload =>
    o.kind === "text"
      ? { type: "prompt", text: o.text ?? "" }
      : { type: "image", fileKey: o.fileKey ?? undefined, fileKind: o.kind };

  return (
    <aside className="gallery" aria-label="Результаты">
      <div className="gallery-head">
        <h2 className="gallery-title">Результаты</h2>
        <button type="button" className="icon-btn" aria-label="Закрыть галерею" onClick={() => setPanel({ galleryOpen: false })}>
          <XIcon size={13} weight="bold" aria-hidden />
        </button>
      </div>
      <div className="filters" role="group" aria-label="Тип результатов">
        {([["all", "Все"], ["image", "Картинки"], ["video", "Видео"], ["text", "Тексты"]] as const).map(([k, l]) => (
          <button key={k} type="button" className={`chip${filter === k ? " is-on" : ""}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      <p className="gallery-hint">Перетащи результат на холст, чтобы использовать его как вход.</p>
      <div className="gallery-list">
        {items === null && <div className="skeleton" style={{ height: 120 }} />}
        {items !== null && shown.length === 0 && <p className="palette-empty">Пока пусто. Запусти любую модель, результат появится здесь.</p>}
        {shown.map((o) => (
          <figure
            key={o.id}
            className={`gallery-item kind-${o.kind}`}
            draggable
            onDragStart={(e) => {
              const p = payloadFor(o);
              e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(p));
              e.dataTransfer.effectAllowed = "copy";
              setDragPayload(p);
            }}
            onDragEnd={() => setDragPayload(null)}
          >
            {o.kind === "image" && o.url && (
              <button type="button" className="gallery-media" onClick={() => setLightbox(o.url)} aria-label="Открыть крупно">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={o.url} alt="" loading="lazy" draggable={false} />
              </button>
            )}
            {o.kind === "video" && o.url && (
              <video className="gallery-media" src={`${o.url}#t=0.1`} muted loop playsInline preload="metadata"
                onMouseEnter={(e) => { e.currentTarget.play().catch(() => {}); }}
                onMouseLeave={(e) => { e.currentTarget.pause(); }} />
            )}
            {o.kind === "text" && <p className="gallery-text">{o.text}</p>}
            <figcaption>
              <span>{names.get(o.nodeId) ?? "Удалённая нода"}</span>
              <span>{time(o.createdAt)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </aside>
  );
}
