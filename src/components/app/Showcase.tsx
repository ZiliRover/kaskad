"use client";

import { CaretLeftIcon, CaretRightIcon, CopyIcon, FlagIcon, HeartIcon, XIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ART_SETS, artSlide } from "@/config/art";
import { BRAND } from "@/config/brand";
import type { FeedPost } from "@/lib/feed";

type Sort = "top" | "new";
type Kind = "all" | "image" | "video";

const PAGE = 40;
const GAP = 6;
const date = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });

function columnsFor(width: number) {
  if (width < 560) return 2;
  if (width < 960) return 3;
  if (width < 1440) return 4;
  if (width < 1920) return 5;
  return 6;
}

/** Plays muted videos while they are on screen, pauses them once they scroll away. */
function useAutoplay() {
  const observer = useRef<IntersectionObserver | null>(null);
  useEffect(() => {
    observer.current = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = e.target as HTMLVideoElement;
        if (e.isIntersecting) v.play().catch(() => {}); else v.pause();
      }
    }, { threshold: 0.35 });
    return () => observer.current?.disconnect();
  }, []);
  return useCallback((v: HTMLVideoElement | null) => { if (v) observer.current?.observe(v); }, []);
}

function Tile({ post, onOpen, onLike, watch }: { post: FeedPost; onOpen: () => void; onLike: () => void; watch: (v: HTMLVideoElement | null) => void }) {
  return (
    <div className={`feed-tile${post.hidden ? " is-hidden" : ""}`} style={{ aspectRatio: `${post.width} / ${post.height}` }}>
      <button type="button" className="feed-open" onClick={onOpen} aria-label={post.prompt ? `Открыть: ${post.prompt.slice(0, 80)}` : "Открыть работу"}>
        {post.kind === "video"
          ? <video ref={watch} src={post.url} muted loop playsInline preload="metadata" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img src={post.url} alt="" loading="lazy" decoding="async" />}
      </button>
      <div className="feed-meta">
        <span className="feed-model">{post.model}</span>
        <button type="button" className={`feed-heart${post.liked ? " is-on" : ""}`} aria-pressed={post.liked}
          aria-label={post.liked ? "Убрать лайк" : "Нравится"} onClick={onLike}>
          <HeartIcon size={14} weight={post.liked ? "fill" : "bold"} aria-hidden />{post.likes > 0 && post.likes}
        </button>
      </div>
    </div>
  );
}

const REASONS = [
  ["person", "Чужое лицо без согласия"],
  ["adult", "Контент 18+"],
  ["violence", "Насилие или жестокость"],
  ["rights", "Нарушает чьи-то права"],
  ["other", "Другое"],
] as const;

/** "Пожаловаться": pick a reason, sent once. */
function Report({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  useEffect(() => { setOpen(false); setState("idle"); }, [postId]);
  const send = async (reason: string) => {
    setState("sending");
    const r = await fetch(`/api/posts/${postId}/report`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    }).catch(() => null);
    setState(r?.ok ? "sent" : "error");
  };
  if (state === "sent") return <p className="feed-report-done">Жалоба отправлена. Спасибо, посмотрим.</p>;
  return (
    <div className="feed-report">
      {!open ? (
        <button type="button" className="link-btn" onClick={() => setOpen(true)}><FlagIcon size={12} aria-hidden />Пожаловаться</button>
      ) : (
        <>
          <span className="feed-report-title">Что не так?</span>
          <div className="feed-report-list">
            {REASONS.map(([k, l]) => (
              <button key={k} type="button" className="chip" disabled={state === "sending"} onClick={() => void send(k)}>{l}</button>
            ))}
          </div>
          {state === "error" && <p className="auth-error">Не отправилось, попробуй ещё раз.</p>}
        </>
      )}
    </div>
  );
}

function Viewer({ post, operator, onClose, onPrev, onNext, onLike, onRemove }: {
  post: FeedPost; operator: boolean; onClose: () => void; onPrev: (() => void) | null; onNext: (() => void) | null; onLike: () => void; onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => { setCopied(false); setConfirmRemove(false); }, [post.id]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && onPrev) onPrev();
      else if (e.key === "ArrowRight" && onNext) onNext();
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = overflow; };
  }, [onClose, onPrev, onNext]);

  const copy = () => {
    if (!post.prompt) return;
    navigator.clipboard.writeText(post.prompt).then(() => setCopied(true), () => {});
  };

  return (
    <div className="feed-viewer" role="dialog" aria-modal="true" aria-label="Работа из витрины">
      <div className="feed-stage" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {post.kind === "video"
          ? <video key={post.id} ref={startPlaying} src={post.url} loop playsInline controls />
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={post.id} src={post.url} alt={post.prompt ?? "Работа из витрины"} />}
        {onPrev && (
          <button type="button" className="feed-nav is-prev" aria-label="Предыдущая работа" onClick={onPrev}><CaretLeftIcon size={20} weight="bold" aria-hidden /></button>
        )}
        {onNext && (
          <button type="button" className="feed-nav is-next" aria-label="Следующая работа" onClick={onNext}><CaretRightIcon size={20} weight="bold" aria-hidden /></button>
        )}
      </div>
      <aside className="feed-side">
        <div className="feed-side-head">
          <button type="button" className={`like-btn${post.liked ? " is-on" : ""}`} aria-pressed={post.liked}
            aria-label={post.liked ? "Убрать лайк" : "Нравится"} onClick={onLike}>
            <HeartIcon size={15} weight={post.liked ? "fill" : "regular"} aria-hidden />{post.likes}
          </button>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}><XIcon size={16} aria-hidden /></button>
        </div>
        <dl className="feed-facts">
          <div><dt>Модель</dt><dd>{post.model}</dd></div>
          <div><dt>Опубликовано</dt><dd>{date(post.createdAt)}</dd></div>
        </dl>
        <section className="feed-prompt">
          <h2>Промт</h2>
          {post.prompt ? (
            <>
              <p>{post.prompt}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
                <CopyIcon size={14} aria-hidden />{copied ? "Скопировано" : "Скопировать промт"}
              </button>
            </>
          ) : <p className="feed-hidden">Автор не показал промт.</p>}
        </section>
        {post.hidden && (
          <p className="feed-flagged">{post.mine
            ? "На работу пожаловались, и её скрыли из витрины до проверки. Её видишь только ты."
            : "Скрыта из витрины по жалобам."}</p>
        )}
        {post.mine || operator ? (
          <div className="feed-mine">
            <span>{post.mine ? "Это твоя работа" : `Модерация${post.reports ? ` · жалоб: ${post.reports}` : ""}`}</span>
            {confirmRemove
              ? <span className="feed-confirm">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmRemove(false)}>Отмена</button>
                  <button type="button" className="btn btn-sm feed-danger" onClick={onRemove}>Убрать</button>
                </span>
              : <button type="button" className="link-btn" onClick={() => setConfirmRemove(true)}>Убрать из витрины</button>}
          </div>
        ) : (
          <div className="feed-mine"><Report postId={post.id} /></div>
        )}
      </aside>
    </div>
  );
}

/** With sound when the browser allows it, muted otherwise. */
function startPlaying(v: HTMLVideoElement | null) {
  if (!v) return;
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
}

/** Works people chose to show: a full-screen wall of images and videos, by likes or by date. */
export function Showcase({ initial, operator }: { initial: FeedPost[]; operator: boolean }) {
  const [sort, setSort] = useState<Sort>("top");
  const [kind, setKind] = useState<Kind>("all");
  const [posts, setPosts] = useState(initial);
  const [done, setDone] = useState(initial.length < PAGE);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cols, setCols] = useState(4);
  const wall = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const watch = useAutoplay();

  useLayoutEffect(() => {
    const el = wall.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCols(columnsFor(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fetchPage = useCallback(async (offset: number) => {
    const q = new URLSearchParams({ sort, offset: String(offset) });
    if (kind !== "all") q.set("kind", kind);
    const r = await fetch(`/api/feed?${q}`, { cache: "no-store" });
    if (r.status === 401) { location.href = "/login?next=/showcase"; return null; }
    return r.ok ? (await r.json() as FeedPost[]) : null;
  }, [sort, kind]);

  // a new sort or filter starts the wall over
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    let live = true;
    setLoading(true);
    void fetchPage(0).then((page) => {
      if (!live || !page) return;
      setPosts(page); setDone(page.length < PAGE); setLoading(false);
      window.scrollTo({ top: 0 });
    });
    return () => { live = false; };
  }, [fetchPage]);

  const loadMore = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    const page = await fetchPage(posts.length);
    setLoading(false);
    if (!page) return;
    // likes move posts around between pages: skip the ones already shown
    setPosts((cur) => { const seen = new Set(cur.map((p) => p.id)); return [...cur, ...page.filter((p) => !seen.has(p.id))]; });
    if (page.length < PAGE) setDone(true);
  }, [loading, done, fetchPage, posts.length]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) void loadMore(); }, { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  // masonry that keeps the feed's order: each post goes to the shortest column
  const columns = useMemo(() => {
    const out: FeedPost[][] = Array.from({ length: cols }, () => []);
    const heights = new Array(cols).fill(0);
    for (const p of posts) {
      const i = heights.indexOf(Math.min(...heights));
      out[i].push(p);
      heights[i] += p.height / Math.max(1, p.width) + 0.02;
    }
    return out;
  }, [posts, cols]);

  const like = useCallback(async (id: string) => {
    const flip = (p: FeedPost) => (p.id === id ? { ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) } : p);
    setPosts((cur) => cur.map(flip));
    const r = await fetch(`/api/posts/${id}/like`, { method: "POST" }).catch(() => null);
    if (r?.ok) {
      const d: { liked: boolean; likes: number } = await r.json();
      setPosts((cur) => cur.map((p) => (p.id === id ? { ...p, ...d } : p)));
    } else setPosts((cur) => cur.map(flip));
  }, []);

  const remove = useCallback(async (id: string) => {
    const r = await fetch(`/api/posts/${id}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) { setOpenId(null); setPosts((cur) => cur.filter((p) => p.id !== id)); }
  }, []);

  const index = openId ? posts.findIndex((p) => p.id === openId) : -1;
  const open = index >= 0 ? posts[index] : null;
  const prev = index > 0 ? () => setOpenId(posts[index - 1].id) : null;
  const next = index >= 0 && index < posts.length - 1 ? () => {
    setOpenId(posts[index + 1].id);
    if (index + 1 > posts.length - 6) void loadMore();
  } : null;
  const close = useCallback(() => setOpenId(null), []);

  return (
    <div className="feed-page">
      <header className="feed-top">
        <a className="auth-brand" href="/studio"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></a>
        <nav className="feed-controls" aria-label="Витрина">
          <div className="agent-tabs" role="tablist" aria-label="Порядок">
            <button type="button" role="tab" aria-selected={sort === "top"} className={sort === "top" ? "is-on" : undefined} onClick={() => setSort("top")}>Популярные</button>
            <button type="button" role="tab" aria-selected={sort === "new"} className={sort === "new" ? "is-on" : undefined} onClick={() => setSort("new")}>Новые</button>
          </div>
          <div className="filters" role="group" aria-label="Тип">
            {([["all", "Всё"], ["image", "Картинки"], ["video", "Видео"]] as const).map(([k, l]) => (
              <button key={k} type="button" className={`chip${kind === k ? " is-on" : ""}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
        </nav>
        <a className="btn btn-ghost btn-sm feed-studio" href="/studio">В студию</a>
      </header>

      <main ref={wall} className={`feed-wall${loading && posts.length === 0 ? " is-loading" : ""}`} style={{ gap: GAP, padding: GAP }}>
        {posts.length === 0 && !loading ? (
          <div className="feed-empty">
            <div className="feed-empty-art" aria-hidden>
              {ART_SETS.slice(0, 5).map((set, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={set.id} src={artSlide(set.id, set.best[0])} alt="" style={{ ["--i" as string]: i }} />
              ))}
            </div>
            <h1>Витрина пока пустая</h1>
            <p>{kind === "all"
              ? "Здесь появятся картинки и видео, которые авторы решили показать. Выложи свою: у результата в студии нажми «В витрину»."
              : kind === "video" ? "Видео ещё никто не выложил." : "Картинок ещё никто не выложил."}</p>
            <a className="btn btn-primary" href="/studio">Открыть студию</a>
          </div>
        ) : columns.map((col, i) => (
          <div key={i} className="feed-col" style={{ gap: GAP }}>
            {col.map((p) => <Tile key={p.id} post={p} watch={watch} onOpen={() => setOpenId(p.id)} onLike={() => void like(p.id)} />)}
          </div>
        ))}
      </main>
      <div ref={sentinel} className="feed-sentinel" aria-hidden />
      {loading && posts.length > 0 && <p className="feed-more" role="status">Загружаю ещё…</p>}

      {open && <Viewer post={open} operator={operator} onClose={close} onPrev={prev} onNext={next} onLike={() => void like(open.id)} onRemove={() => void remove(open.id)} />}
    </div>
  );
}
