"use client";

import { useEffect, useRef } from "react";
import { useStudio } from "./store";

export function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast${t.error ? " is-error" : ""}`}>{t.text}</div>)}
    </div>
  );
}

export function ConfirmDialog() {
  const req = useStudio((s) => s.confirm);
  const close = useStudio((s) => s.closeConfirm);
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    ok.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, close]);

  if (!req) return null;
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title" className="dialog-title">{req.title}</h2>
        <p className="dialog-body">{req.body}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => close(false)}>Отмена</button>
          <button type="button" className="btn btn-primary" ref={ok} onClick={() => close(true)}>{req.confirm}</button>
        </div>
      </div>
    </div>
  );
}

export function Lightbox() {
  const url = useStudio((s) => s.lightbox);
  const set = useStudio((s) => s.setLightbox);
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") set(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url, set]);
  if (!url) return null;
  return (
    <div className="overlay overlay-dark" onClick={() => set(null)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="lightbox-img" src={url} alt="Просмотр результата" />
    </div>
  );
}
