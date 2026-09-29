"use client";

import { BookmarkSimpleIcon, CaretRightIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { LibraryRow } from "./Library";
import { useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { formatRub } from "@/lib/money";
import { estimate } from "@/lib/models/pricing";
import { MODELS, defaultParams, isBlocked } from "@/lib/models/registry";
import type { ModelCaps, ModelGroup, ModelSpec } from "@/lib/models/types";
import { PALETTE_MIME, setDragPayload, type PalettePayload } from "./Canvas";
import { CapIcons, GROUP_ICONS, NodeIcon, type NodeKey } from "./icons";
import { useStudio } from "./store";

type SectionId = "inputs" | "canvas" | "library" | ModelGroup;

const MODEL_GROUPS: { id: ModelGroup; title: string }[] = [
  { id: "video", title: "Видео" },
  { id: "image", title: "Картинки" },
  { id: "tools", title: "Инструменты" },
  { id: "video-edit", title: "Правка и апскейл видео" },
  { id: "image-style", title: "Стиль по образцам" },
  { id: "image-vector", title: "Векторы SVG" },
  { id: "audio", title: "Озвучка" },
  { id: "text", title: "Текст (AI)" },
];

const DEFAULT_OPEN: SectionId[] = ["inputs", "library", "video", "image", "tools"];

/** Filters answer "what do I need this model to take or do". */
const FILTERS: { key: keyof ModelCaps; label: string }[] = [
  { key: "frames", label: "Кадры" },
  { key: "refs", label: "Референсы" },
  { key: "mediaRefs", label: "Видео/аудио-реф." },
  { key: "audio", label: "Звук" },
  { key: "variants", label: "Варианты" },
];

const hasCap = (m: ModelSpec, k: keyof ModelCaps) => (k === "variants" ? m.caps.variants > 1 : !!m.caps[k]);

const WIDTH_KEY = "kaskad-sidebar-width";
const OPEN_KEY = "kaskad-sidebar-open";
const MIN_W = 280, MAX_W = 520, DEFAULT_W = 340;

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* convenience only */ }
}

function startDrag(e: React.DragEvent, payload: PalettePayload) {
  e.dataTransfer.setData(PALETTE_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "copy";
  setDragPayload(payload);
}

const endDrag = () => setDragPayload(null);

function Section({ id, title, icon, count, open, onToggle, children }: {
  id: SectionId; title: string; icon: React.ReactNode; count?: number;
  open: boolean; onToggle: (id: SectionId) => void; children: React.ReactNode;
}) {
  return (
    <section className={`palette${open ? " is-open" : ""}`}>
      <button type="button" className="side-title" aria-expanded={open} onClick={() => onToggle(id)}>
        <CaretRightIcon size={10} weight="bold" className="side-caret" aria-hidden />
        {icon}
        {title}
        {count !== undefined && <span className="side-count">{count}</span>}
      </button>
      {open && <div className="palette-items">{children}</div>}
    </section>
  );
}

function SimpleItem({ node, title, desc, payload, onAdd }: {
  node: NodeKey; title: string; desc: string; payload: PalettePayload; onAdd: (p: PalettePayload) => void;
}) {
  return (
    <button
      type="button" className="palette-item" draggable
      onDragStart={(e) => startDrag(e, payload)} onDragEnd={endDrag} onClick={() => onAdd(payload)}
    >
      <NodeIcon node={node} dtype={node === "prompt" || node === "list" ? "text" : node === "upload" ? "image" : null} />
      <span className="pi-text"><span className="pi-title">{title}</span><span className="pi-desc">{desc}</span></span>
    </button>
  );
}

export function Sidebar() {
  const addNode = useStudio((s) => s.addNode);
  const fx = useStudio((s) => s.fx);
  const blocked = useStudio((s) => s.blockedVendors);
  const library = useStudio((s) => s.library);
  const { screenToFlowPosition } = useReactFlow();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<(keyof ModelCaps)[]>([]);
  const [open, setOpen] = useState<SectionId[]>(DEFAULT_OPEN);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(DEFAULT_W);

  useEffect(() => {
    setOpen(load(OPEN_KEY, DEFAULT_OPEN));
    setWidth(Math.min(MAX_W, Math.max(MIN_W, load(WIDTH_KEY, DEFAULT_W))));
  }, []);

  const toggle = (id: SectionId) => setOpen((cur) => {
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    save(OPEN_KEY, next);
    return next;
  });

  // drag the right edge to resize; double-click resets
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = width;
    let w = w0;
    const move = (ev: PointerEvent) => { w = Math.min(MAX_W, Math.max(MIN_W, w0 + ev.clientX - x0)); setWidth(w); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("is-resizing");
      save(WIDTH_KEY, w);
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const addAtCenter = (p: PalettePayload) => {
    const r = document.querySelector(".react-flow")?.getBoundingClientRect();
    const at = r ? screenToFlowPosition({ x: r.left + r.width / 2 - 160, y: r.top + r.height / 3 }) : { x: 0, y: 0 };
    addNode(p.type, { x: Math.round(at.x), y: Math.round(at.y) }, { kind: p.kind, modelId: p.modelId, listKind: p.listKind, assetId: p.assetId }); // store nudges to free space
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
    <aside className="sidebar" aria-label="Ноды и модели" style={{ width }}>
      <div className="search">
        <MagnifyingGlassIcon size={14} aria-hidden className="search-icon" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти модель" aria-label="Поиск модели" />
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
              key={f.key} type="button" className={`chip${on ? " is-on" : ""}`} aria-pressed={on}
              onClick={() => setFilters((cur) => (on ? cur.filter((x) => x !== f.key) : [...cur, f.key]))}
            >{f.label}</button>
          );
        })}
      </div>

      <div className="palette-scroll">
        {!narrowing && (
          <Section id="inputs" title="Входные данные" icon={null} open={open.includes("inputs")} onToggle={toggle}>
            <SimpleItem node="prompt" title="Промт" desc="Текст для моделей" payload={{ type: "prompt" }} onAdd={addAtCenter} />
            <SimpleItem node="upload" title="Файл" desc="Картинка, видео или аудио" payload={{ type: "image" }} onAdd={addAtCenter} />
            <SimpleItem node="list" title="Список промтов" desc="Пакетный запуск: модель сработает на каждую строку" payload={{ type: "list", listKind: "text" }} onAdd={addAtCenter} />
            <SimpleItem node="list" title="Список файлов" desc="Пакетный запуск: по разу на каждый файл" payload={{ type: "list", listKind: "image" }} onAdd={addAtCenter} />
          </Section>
        )}

        {!narrowing && (
          <Section id="library" title="Моя библиотека" count={library.length} icon={<BookmarkSimpleIcon size={13} aria-hidden />} open={open.includes("library")} onToggle={toggle}>
            {library.map((item) => (
              <LibraryRow key={item.id} item={item}
                onDragStart={(e) => startDrag(e, { type: "asset", assetId: item.id })}
                onAdd={() => addAtCenter({ type: "asset", assetId: item.id })} />
            ))}
            <button type="button" className="show-more library-new" onClick={() => useStudio.setState({ libraryEdit: "new" })}>
              <PlusIcon size={12} weight="bold" aria-hidden /> Персонаж, товар, бренд или стиль
            </button>
          </Section>
        )}

        {MODEL_GROUPS.map((g) => {
          const all = matches.filter((m) => m.group === g.id);
          if (!all.length) return null;
          const isOpen = narrowing || open.includes(g.id);
          const showAll = narrowing || expanded[g.id] || g.id === "tools";
          const featured = all.filter((m) => m.featured);
          const shown = showAll ? all : featured.length ? featured : all.slice(0, 4);
          const hidden = all.length - shown.length;
          const GIcon = GROUP_ICONS[g.id];
          return (
            <Section
              key={g.id} id={g.id} title={g.title} count={all.length}
              icon={<GIcon size={13} aria-hidden />}
              open={isOpen} onToggle={toggle}
            >
              {shown.map((m) => {
                const usd = prices.get(m.id);
                const payload: PalettePayload = { type: "model", kind: m.kind, modelId: m.id };
                const off = isBlocked(m.id, blocked);
                return (
                  <button
                    key={m.id} type="button" className={`palette-item model-item${off ? " is-blocked" : ""}`} draggable
                    onDragStart={(e) => startDrag(e, payload)} onDragEnd={endDrag} onClick={() => addAtCenter(payload)}
                    title={off
                      ? `${m.vendor} не обслуживает регион сервера: модель сейчас не запустится`
                      : `${m.blurb || `${m.vendor} ${m.name}`}\nПеретащи на холст или на ноду, чтобы сменить в ней модель`}
                  >
                    <span className="pi-text">
                      <span className="pi-title">
                        {m.name}
                        {off ? <span className="pi-price">недоступна</span> : usd !== null && usd !== undefined && (
                          <span className="pi-price">{m.pricing.type === "free" ? "бесплатно" : `от ${formatRub(usd, fx)}`}</span>
                        )}
                      </span>
                      <span className="pi-desc">{m.blurb || m.vendor}</span>
                      <CapIcons caps={m.caps} />
                    </span>
                  </button>
                );
              })}
              {!narrowing && hidden > 0 && (
                <button type="button" className="show-more" onClick={() => setExpanded((x) => ({ ...x, [g.id]: true }))}>
                  Показать ещё {hidden}
                </button>
              )}
              {!narrowing && expanded[g.id] && g.id !== "tools" && featured.length > 0 && (
                <button type="button" className="show-more" onClick={() => setExpanded((x) => ({ ...x, [g.id]: false }))}>
                  Только популярные
                </button>
              )}
            </Section>
          );
        })}

        {!narrowing && (
          <Section id="canvas" title="Холст" icon={null} open={open.includes("canvas")} onToggle={toggle}>
            <SimpleItem node="note" title="Заметка" desc="Бриф, идея, что поправить" payload={{ type: "note" }} onAdd={addAtCenter} />
            <SimpleItem node="group" title="Группа" desc="Рамка для части графа (Ctrl+G)" payload={{ type: "group" }} onAdd={addAtCenter} />
          </Section>
        )}

        {narrowing && matches.length === 0 && (
          <p className="palette-empty">Ничего не нашлось. Попробуй другое название или сними фильтры.</p>
        )}
      </div>

      <div
        className="sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Ширина панели"
        onPointerDown={startResize}
        onDoubleClick={() => { setWidth(DEFAULT_W); save(WIDTH_KEY, DEFAULT_W); }}
      />
    </aside>
  );
}
