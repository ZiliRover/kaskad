"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { authLost, useStudio } from "./store";

let loading: Promise<void> | null = null;

/** Which of my results are in the showcase: fetched once per studio visit. */
function loadPosted() {
  if (useStudio.getState().posted || loading) return;
  loading = fetch("/api/posts", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((m: Record<string, string>) => { useStudio.setState({ posted: m }); })
    .catch(() => { useStudio.setState({ posted: {} }); })
    .finally(() => { loading = null; });
}

/** "В ленту": puts an image or video result into the public showcase, or takes it back. */
export function FeedButton({ outputId, up = false }: { outputId: string; up?: boolean }) {
  const postId = useStudio((s) => s.posted?.[outputId]);
  const viewer = useStudio((s) => s.role === "viewer");
  const toast = useStudio((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [showPrompt, setShowPrompt] = useState(true);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(loadPosted, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (viewer) return null;

  const setPosted = (id: string | null) => useStudio.setState((s) => {
    const { [outputId]: _old, ...rest } = s.posted ?? {};
    return { posted: id ? { ...rest, [outputId]: id } : rest };
  });

  const publish = async () => {
    setBusy(true);
    const r = await fetch("/api/posts", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outputId, showPrompt }),
    }).catch(() => null);
    setBusy(false);
    if (!r || authLost(r)) return;
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error ?? "Не получилось выложить", true); return; }
    setPosted(d.id);
    setOpen(false);
    toast("Работа в витрине");
  };

  const unpublish = async () => {
    if (!postId) return;
    setBusy(true);
    const r = await fetch(`/api/posts/${postId}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!r || authLost(r)) return;
    if (!r.ok && r.status !== 404) { toast("Не получилось убрать", true); return; }
    setPosted(null);
    setOpen(false);
    toast("Убрано из витрины");
  };

  return (
    <span className="feed-btn" ref={box}>
      <button type="button" className={`link-btn nodrag${postId ? " is-posted" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {postId ? <><CheckIcon size={11} weight="bold" aria-hidden />В витрине</> : "В витрину"}
      </button>
      {open && (
        <div className={`menu feed-pop nodrag nowheel${up ? " is-up" : ""}`} role="dialog" aria-label="Витрина работ">
          {postId ? (
            <>
              <p className="feed-pop-text">Работу видят все в витрине. Проект и остальные результаты закрыты.</p>
              <div className="feed-pop-actions">
                <a className="btn btn-ghost btn-sm" href="/showcase" target="_blank" rel="noreferrer">Открыть витрину</a>
                <button type="button" className="btn btn-ghost btn-sm feed-remove" disabled={busy} onClick={() => void unpublish()}>Убрать</button>
              </div>
            </>
          ) : (
            <>
              <p className="feed-pop-title">Выложить в витрину</p>
              <p className="feed-pop-text">Работу увидят все пользователи. Проект и остальные результаты останутся закрытыми.</p>
              <p className="feed-pop-text">Нельзя: чужие лица без согласия, 18+, насилие. <a href="/terms#content" target="_blank" rel="noreferrer">Правила</a></p>
              <label className="feed-pop-check">
                <input type="checkbox" checked={showPrompt} onChange={(e) => setShowPrompt(e.target.checked)} />
                Показать промт
              </label>
              <div className="feed-pop-actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void publish()}>{busy ? "Выкладываю…" : "Выложить"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </span>
  );
}
