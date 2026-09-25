"use client";

import { CaretDownIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";
import { formatRub } from "@/lib/money";
import { estimate } from "@/lib/models/pricing";
import { MODELS, defaultParams } from "@/lib/models/registry";
import type { ModelCaps, ModelGroup, ModelSpec } from "@/lib/models/types";
import { PALETTE_MIME, type PalettePayload } from "./Canvas";
import { CapIcons, GROUP_ICONS, NodeIcon } from "./icons";
import { useStudio } from "./store";

const GROUPS: { id: ModelGroup; title: string }[] = [
  { id: "video", title: "Видео" },
  { id: "video-edit", title: "Правка и апскейл видео" },
  { id: "image", title: "Картинки" },
  { id: "image-style", title: "Стиль по образцам" },
  { id: "image-vector", title: "Векторы SVG" },
  { id: "text", title: "Текст (AI)" },
];

/** Filters answer "what do I need this model to take or do". */
const FILTERS: { key: keyof ModelCaps; label: string }[] = [
  { key: "frames", label: "Кадры" },
  { key: "refs", label: "Референсы" },
  { key: "mediaRefs", label: "Видео/аудио-реф." },
  { key: "audio", label: "Звук" },
  { key: "variants", label: "Варианты" },
];

const hasCap = (m: ModelSpec, k: keyof ModelCaps) => (k === "variants" ? m.caps.variants > 1 : !!m.caps[k]);

function startDrag(e: React.DragEvent, payload: PalettePayload) {
  e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";
}

export function Sidebar() {
  const addNode = useStudio((s) => s.addNode);
  const fx = useStudio((s) => s.fx);
  const { screenToFlowPosition } = useReactFlow();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<(keyof ModelCaps)[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const addAtCenter = (p: PalettePayload) => {
    const r = document.querySelector(".react-flow")?.getBoundingClientRect();
    const at = r ? screenToFlowPosition({ x: r.left + r.width / 2 - 160, y: r.top + r.height / 3 }) : { x: 0, y: 0 };
    addNode(p.type, { x: Math.round(at.x), y: Math.round(at.y) }, { kind: p.kind, modelId: p.modelId }); // store nudges to free space
  };

  // price of a default run: lets people compare models before picking one
  const prices = useMemo(() => new Map(MODELS.map((m) => {
    const e = estimate(m, { params: defaultParams(m), inputCounts: {}, promptChars: 300 });
    return [m.id, e.usd] as const;
  })), []);

  const q = query.trim().toLowerCase();
  const narrowing = q.length > 0 || filters.length > 0;
  const matches = MODELS.filter((m) =>
    (!q || `${m.name} ${m.vendor} ${m.id} ${m.blurb}`.toLowerCase().includes(q))
    && filters.every((f) => hasCap(m, f)));

  return (
    <aside className="sidebar" aria-label="Ноды и модели">
      <div className="search">
        <MagnifyingGlassIcon size={14} aria-hidden className="search-icon" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Найти модель"
          aria-label="Поиск модели"
        />
        {query && (
          <button type="button" className="icon-btn" aria-label="Очистить поиск" onClick={() => setQuery("")}>
            <XIcon size={12} weight="bold" aria-hidden />
          </button>
        )}
      </div>
      <div className="filters" role="group" aria-label="Фильтр по возможностям">
        {FILTERS.map((f) => {
          const on = filters.includes(f.key);
          return (
            <button
              key={f.key}
              type="button"
              className={`chip${on ? " is-on" : ""}`}
              aria-pressed={on}
              onClick={() => setFilters((cur) => (on ? cur.filter((x) => x !== f.key) : [...cur, f.key]))}
            >{f.label}</button>
          );
        })}
      </div>

      <div className="palette-scroll">
        {!narrowing && (
          <section className="palette">
            <h2 className="side-title">Входные данные</h2>
            <button
              type="button" className="palette-item" draggable
              onDragStart={(e) => startDrag(e, { type: "prompt" })}
              onClick={() => addAtCenter({ type: "prompt" })}
            >
              <NodeIcon node="prompt" dtype="text" />
              <span className="pi-text"><span className="pi-title">Промт</span><span className="pi-desc">Текст для моделей</span></span>
            </button>
            <button
              type="button" className="palette-item" draggable
              onDragStart={(e) => startDrag(e, { type: "image" })}
              onClick={() => addAtCenter({ type: "image" })}
            >
              <NodeIcon node="upload" dtype="image" />
              <span className="pi-text">
                <span className="pi-title">Файл</span>
                <span className="pi-desc">Картинка, видео или аудио</span>
              </span>
            </button>
          </section>
        )}

        {GROUPS.map((g) => {
          const all = matches.filter((m) => m.group === g.id);
          if (!all.length) return null;
          const expanded = narrowing || open[g.id];
          const shown = expanded ? all : all.filter((m) => m.featured).concat(all.every((m) => !m.featured) ? all.slice(0, 4) : []);
          const hidden = all.length - shown.length;
          const GIcon = GROUP_ICONS[g.id];
          return (
            <section key={g.id} className="palette">
              <h2 className="side-title">
                <GIcon size={13} aria-hidden />
                {g.title}
                <span className="side-count">{all.length}</span>
              </h2>
              {shown.map((m) => {
                const usd = prices.get(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="palette-item model-item"
                    draggable
                    onDragStart={(e) => startDrag(e, { type: "model", kind: m.kind, modelId: m.id })}
                    onClick={() => addAtCenter({ type: "model", kind: m.kind, modelId: m.id })}
                    title={m.blurb || `${m.vendor} ${m.name}`}
                  >
                    <span className="pi-text">
                      <span className="pi-title">
                        {m.name}
                        {usd !== null && usd !== undefined && <span className="pi-price">от {formatRub(usd, fx)}</span>}
                      </span>
                      <span className="pi-desc">{m.blurb || m.vendor}</span>
                      <CapIcons caps={m.caps} />
                    </span>
                  </button>
                );
              })}
              {!narrowing && (hidden > 0 || open[g.id]) && (
                <button
                  type="button"
                  className="show-more"
                  aria-expanded={!!open[g.id]}
                  onClick={() => setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                >
                  <CaretDownIcon size={11} weight="bold" aria-hidden className={open[g.id] ? "flip" : ""} />
                  {open[g.id] ? "Свернуть" : `Ещё ${hidden}`}
                </button>
              )}
            </section>
          );
        })}

        {narrowing && matches.length === 0 && (
          <p className="palette-empty">Ничего не нашлось. Попробуй другое название или сними фильтры.</p>
        )}
      </div>

      <div className="side-foot">
        <p>Соединяй выход и вход одного цвета. Голубой: текст, жёлтый: картинка, розовый: видео, бирюзовый: аудио.</p>
        <p>Ctrl+C и Ctrl+V копируют ноды, Ctrl+D дублирует, Ctrl+Z возвращает удалённое.</p>
      </div>
    </aside>
  );
}
