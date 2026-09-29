"use client";

import { HeartIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { BRAND } from "@/config/brand";

export interface Card {
  id: string; name: string; description: string;
  cover: string | null; coverKind: "image" | "video" | null;
  likes: number; liked: boolean; mine: boolean; createdAt: string;
}

/** A heart that likes or unlikes an app, updating the count in place. */
export function LikeButton({ appId, likes, liked, onChange }: { appId: string; likes: number; liked: boolean; onChange?: (s: { liked: boolean; likes: number }) => void }) {
  const [state, setState] = useState({ likes, liked });
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    // optimistic: the heart reacts at once
    const optimistic = { liked: !state.liked, likes: state.likes + (state.liked ? -1 : 1) };
    setState(optimistic);
    try {
      const r = await fetch(`/api/apps/${appId}/like`, { method: "POST" });
      if (r.ok) { const d = await r.json(); setState(d); onChange?.(d); } else setState(state);
    } catch { setState(state); } finally { setBusy(false); }
  };
  return (
    <button type="button" className={`like-btn${state.liked ? " is-on" : ""}`} aria-pressed={state.liked}
      aria-label={state.liked ? "Убрать лайк" : "Нравится"} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void toggle(); }}>
      <HeartIcon size={15} weight={state.liked ? "fill" : "regular"} aria-hidden />{state.likes}
    </button>
  );
}

/** Published apps people can run, sorted by likes or by date. */
export function Showcase({ initial }: { initial: Card[] }) {
  const [sort, setSort] = useState<"top" | "new">("top");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState(initial);
  const [first, setFirst] = useState(true);

  useEffect(() => {
    if (first) { setFirst(false); return; }
    const t = setTimeout(() => {
      fetch(`/api/showcase?sort=${sort}&q=${encodeURIComponent(query.trim())}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setCards(d); }).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [sort, query]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-page">
      <header className="app-top">
        <a className="auth-brand" href="/studio"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></a>
        <a className="btn btn-ghost btn-sm" href="/studio">В студию</a>
      </header>
      <main className="showcase">
        <div className="showcase-head">
          <div>
            <h1 className="app-title">Витрина</h1>
            <p className="app-desc">Готовые приложения других авторов: заполни форму и получи результат. Платишь только за свои запуски.</p>
          </div>
          <div className="showcase-controls">
            <div className="agent-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={sort === "top"} className={sort === "top" ? "is-on" : undefined} onClick={() => setSort("top")}>Популярные</button>
              <button type="button" role="tab" aria-selected={sort === "new"} className={sort === "new" ? "is-on" : undefined} onClick={() => setSort("new")}>Новые</button>
            </div>
            <div className="search">
              <MagnifyingGlassIcon size={14} aria-hidden className="search-icon" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти приложение" aria-label="Поиск по витрине" />
            </div>
          </div>
        </div>
        {cards.length === 0 ? (
          <p className="palette-empty">{query ? "Ничего не нашлось." : "Пока пусто. Опубликуй проект как приложение и отметь «Показать в витрине»."}</p>
        ) : (
          <div className="showcase-grid">
            {cards.map((c) => (
              <a key={c.id} className="showcase-card" href={`/app/${c.id}`}>
                <div className="showcase-cover">
                  {c.cover && c.coverKind === "video"
                    ? <video src={`${c.cover}#t=0.5`} muted loop playsInline preload="metadata"
                        onMouseEnter={(e) => { e.currentTarget.play().catch(() => {}); }} onMouseLeave={(e) => { e.currentTarget.pause(); }} />
                    // eslint-disable-next-line @next/next/no-img-element
                    : c.cover ? <img src={c.cover} alt="" loading="lazy" /> : <span className="showcase-initial">{c.name.slice(0, 1)}</span>}
                </div>
                <div className="showcase-body">
                  <span className="showcase-name">{c.name}{c.mine && <span className="showcase-mine">моё</span>}</span>
                  {c.description && <span className="showcase-desc">{c.description}</span>}
                </div>
                <div className="showcase-foot">
                  <LikeButton appId={c.id} likes={c.likes} liked={c.liked} />
                  <span className="showcase-open">Открыть</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
