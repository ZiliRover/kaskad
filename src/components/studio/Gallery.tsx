"use client";

import { BookmarkSimpleIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { OutputVersion } from "@/lib/jobs";
import type { MediaItem } from "@/lib/media";
import { getModel } from "@/lib/models/registry";
import { PALETTE_MIME, setDragPayload, type PalettePayload } from "./Canvas";
import { FeedButton } from "./FeedButton";
import { useStudio } from "./store";

const time = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

type Scope = "project" | "results" | "uploads";
type Kind = "all" | "image" | "video" | "audio" | "text";

interface Entry { id: string; kind: MediaItem["kind"]; fileKey: string | null; url: string | null; text: string | null; createdAt: string; caption: string; sub: string | null; prompt: string | null }

/**
 * Results and uploads. "Этот проект": everything on this canvas; "Все проекты" and
 * "Загрузки": the whole media library, searchable. Drag any item onto the canvas.
 */
export function Gallery() {
  const open = useStudio((s) => s.galleryOpen);
  const setPanel = useStudio((s) => s.setPanel);
  const graphId = useStudio((s) => s.graphId);
  const setLightbox = useStudio((s) => s.setLightbox);
  const nodes = useStudio((s) => s.nodes);
  // total results across nodes: changes whenever something new is generated
  const total = useStudio((s) => Object.values(s.state).reduce((a, n) => a + n.outputCount, 0));
  const [scope, setScope] = useState<Scope>("project");
  const [kind, setKind] = useState<Kind>("all");
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Entry[] | null>(null);
  const [more, setMore] = useState(false);

  const names = useMemo(() => new Map(nodes.map((n) => [
    n.id, n.type === "model" ? getModel(n.data.modelId)?.name ?? "Модель" : "Нода",
  ])), [nodes]);

  // search as you type, without a request per key
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const fetchPage = async (before?: string): Promise<Entry[]> => {
    if (scope === "project") {
      const r = await fetch(`/api/graphs/${graphId}/outputs`);
      const v: OutputVersion[] = r.ok ? await r.json() : [];
      return v.map((o) => ({ ...o, caption: names.get(o.nodeId) ?? "Удалённая нода", sub: null, prompt: null }));
    }
    const params = new URLSearchParams({ source: scope });
    if (kind !== "all") params.set("kind", kind);
    if (q) params.set("q", q);
    if (before) params.set("before", before);
    const r = await fetch(`/api/media?${params}`);
    const v: MediaItem[] = r.ok ? await r.json() : [];
    return v.map((m) => ({ ...m, caption: m.title, sub: m.projectName, prompt: m.prompt }));
  };

  useEffect(() => {
    if (!open || !graphId) return;
    let live = true;
    setItems(null);
    fetchPage().then((v) => { if (live) { setItems(v); setMore(scope !== "project" && v.length >= 60); } }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [open, graphId, total, scope, kind, q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const shown = (items ?? []).filter((i) => scope !== "project" || kind === "all" || i.kind === kind);

  const payloadFor = (o: Entry): PalettePayload =>
    o.kind === "text"
      ? { type: "prompt", text: o.text ?? "" }
      : { type: "image", fileKey: o.fileKey ?? undefined, fileKind: o.kind };

  const loadMore = async () => {
    const last = items?.[items.length - 1];
    if (!last) return;
    const next = await fetchPage(last.createdAt);
    setItems((x) => [...(x ?? []), ...next]);
    setMore(next.length >= 60);
  };

  return (
    <aside className="gallery" aria-label="Медиатека">
      <div className="gallery-head">
        <h2 className="gallery-title">Медиатека</h2>
        <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => setPanel({ galleryOpen: false })}>
          <XIcon size={13} weight="bold" aria-hidden />
        </button>
      </div>
      <div className="agent-tabs gallery-tabs" role="tablist">
        {([["project", "Этот проект"], ["results", "Все проекты"], ["uploads", "Загрузки"]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={scope === k} className={scope === k ? "is-on" : undefined} onClick={() => setScope(k)}>{l}</button>
        ))}
      </div>
      {scope !== "project" && (
        <div className="search gallery-search">
          <MagnifyingGlassIcon size={14} aria-hidden className="search-icon" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={scope === "uploads" ? "Имя файла" : "Промт, проект или текст"} aria-label="Поиск в медиатеке" />
        </div>
      )}
      <div className="filters" role="group" aria-label="Тип">
        {([["all", "Все"], ["image", "Картинки"], ["video", "Видео"], ["audio", "Аудио"], ["text", "Тексты"]] as const)
          .filter(([k]) => scope !== "uploads" || k !== "text")
          .map(([k, l]) => (
            <button key={k} type="button" className={`chip${kind === k ? " is-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
          ))}
      </div>
      <p className="gallery-hint">Перетащи на холст, чтобы использовать как вход.</p>
      <div className="gallery-list">
        {items === null && <div className="skeleton" style={{ height: 120 }} />}
        {items !== null && shown.length === 0 && (
          <p className="palette-empty">{q ? "Ничего не нашлось." : scope === "uploads" ? "Загрузок пока нет." : "Пока пусто. Запусти любую модель, результат появится здесь."}</p>
        )}
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
            title={o.prompt ?? undefined}
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
            {o.kind === "audio" && o.url && <audio className="gallery-audio" src={o.url} controls preload="none" />}
            {o.kind === "text" && <p className="gallery-text">{o.text}</p>}
            <figcaption>
              <span className="gallery-cap">{o.caption}{o.sub && <span className="gallery-sub">{o.sub}</span>}</span>
              <span>{time(o.createdAt)}</span>
            </figcaption>
            <div className="gallery-actions">
              {o.kind === "image" && o.fileKey && (
                <button type="button" className="gallery-save" title="Сохранить в библиотеку как персонажа, товар, бренд или стиль"
                  onClick={() => useStudio.setState({ libraryEdit: "new", libraryPrefill: [o.fileKey!] })}>
                  <BookmarkSimpleIcon size={12} aria-hidden />В библиотеку
                </button>
              )}
              {scope !== "uploads" && (o.kind === "image" || o.kind === "video") && o.url && <FeedButton outputId={o.id} />}
            </div>
          </figure>
        ))}
        {more && <button type="button" className="show-more" onClick={() => void loadMore()}>Показать ещё</button>}
      </div>
    </aside>
  );
}
