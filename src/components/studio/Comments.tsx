"use client";

import { ChatCircleDotsIcon, CheckIcon, PaperPlaneRightIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { useEffect, useState } from "react";
import type { Comment } from "@/lib/comments";
import { colorFor } from "./Share";
import { authLost, useStudio } from "./store";

const when = (iso: string) => new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

async function call(graphId: string, method: string, body?: unknown): Promise<Comment[] | null> {
  const r = await fetch(`/api/graphs/${graphId}/comments`, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, cache: "no-store",
  }).catch(() => null);
  if (!r || authLost(r)) return null;
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    useStudio.getState().toast(d.error ?? "Не получилось", true);
    return null;
  }
  return r.json();
}

/** Header button: comment mode on or off, with the number of open threads. */
export function CommentsButton() {
  const on = useStudio((s) => s.commentMode);
  const open = useStudio((s) => s.comments.filter((c) => !c.parentId && !c.resolved).length);
  return (
    <button type="button" className={`icon-btn tb-icon comments-btn${on ? " is-on" : ""}`} aria-pressed={on}
      title={on ? "Режим комментариев: кликни на холст, чтобы оставить комментарий" : "Комментарии"} aria-label="Комментарии"
      onClick={() => useStudio.setState((s) => ({ commentMode: !s.commentMode, draftPin: null }))}>
      <ChatCircleDotsIcon size={16} aria-hidden />
      {open > 0 && <span className="comments-count">{open}</span>}
    </button>
  );
}

/** Pins and threads over the canvas (screen space, so text stays readable at any zoom). */
export function CommentsLayer() {
  const graphId = useStudio((s) => s.graphId);
  const rev = useStudio((s) => s.commentsRev);
  const comments = useStudio((s) => s.comments);
  const mode = useStudio((s) => s.commentMode);
  const openId = useStudio((s) => s.openThread);
  const draft = useStudio((s) => s.draftPin);
  const me = useStudio((s) => s.me);
  const role = useStudio((s) => s.role);
  const { flowToScreenPosition } = useReactFlow();
  useViewport(); // re-render as the canvas moves
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!graphId) return;
    void call(graphId, "GET").then((list) => { if (list) useStudio.setState({ comments: list }); });
  }, [graphId, rev]);

  useEffect(() => { setText(""); }, [openId, draft]);

  const box = typeof document !== "undefined" ? document.querySelector(".react-flow")?.getBoundingClientRect() : undefined;
  if (!box) return null;
  const at = (x: number, y: number) => { const p = flowToScreenPosition({ x, y }); return { left: p.x - box.left, top: p.y - box.top }; };
  const roots = comments.filter((c) => !c.parentId);
  const replies = (id: string) => comments.filter((c) => c.parentId === id);
  const thread = roots.find((c) => c.id === openId);
  const save = async (body: unknown) => {
    setBusy(true);
    const list = await call(graphId, "POST", body);
    setBusy(false);
    if (list) { useStudio.setState({ comments: list, draftPin: null }); setText(""); }
    return list;
  };

  return (
    <div className="comments-layer">
      {roots.filter((c) => !c.resolved || c.id === openId).map((c) => {
        const n = replies(c.id).length;
        return (
          <button key={c.id} type="button" className={`comment-pin${c.resolved ? " is-resolved" : ""}${c.id === openId ? " is-open" : ""}`}
            style={{ ...at(c.x, c.y), background: colorFor(c.author.email) }}
            title={`${c.author.email}: ${c.text}`}
            onClick={() => useStudio.setState({ openThread: c.id === openId ? null : c.id, draftPin: null })}>
            {c.author.email.slice(0, 1).toUpperCase()}{n > 0 && <span className="comment-pin-n">{n + 1}</span>}
          </button>
        );
      })}

      {draft && (
        <div className="comment-pop" style={at(draft.x, draft.y)}>
          <span className="comment-pin is-draft" aria-hidden />
          <form className="comment-card" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void save({ text, x: draft.x, y: draft.y }); }}>
            <textarea className="field" rows={3} autoFocus placeholder="Комментарий" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") useStudio.setState({ draftPin: null }); if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && text.trim()) void save({ text, x: draft.x, y: draft.y }); }} />
            <div className="comment-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => useStudio.setState({ draftPin: null })}>Отмена</button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>Отправить</button>
            </div>
          </form>
        </div>
      )}

      {thread && (
        <div className="comment-pop" style={at(thread.x, thread.y)}>
          <div className="comment-card">
            <div className="comment-head">
              <span>{thread.resolved ? "Решено" : "Обсуждение"}</span>
              <span className="comment-tools">
                <button type="button" className="icon-btn" title={thread.resolved ? "Открыть снова" : "Отметить решённым"} aria-label="Решено"
                  onClick={() => void call(graphId, "PATCH", { id: thread.id, resolved: !thread.resolved }).then((l) => { if (l) useStudio.setState({ comments: l, openThread: thread.resolved ? thread.id : null }); })}>
                  <CheckIcon size={13} aria-hidden />
                </button>
                {(thread.author.id === me?.id || role === "owner") && (
                  <button type="button" className="icon-btn" title="Удалить обсуждение" aria-label="Удалить"
                    onClick={() => void call(graphId, "DELETE", { id: thread.id }).then((l) => { if (l) useStudio.setState({ comments: l, openThread: null }); })}>
                    <TrashIcon size={13} aria-hidden />
                  </button>
                )}
                <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => useStudio.setState({ openThread: null })}><XIcon size={12} aria-hidden /></button>
              </span>
            </div>
            <ul className="comment-list">
              {[thread, ...replies(thread.id)].map((c) => (
                <li key={c.id}>
                  <span className="avatar" style={{ background: colorFor(c.author.email), width: 20, height: 20, fontSize: 10 }} aria-hidden>{c.author.email.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <span className="comment-meta">{c.author.email.split("@")[0]} · {when(c.createdAt)}</span>
                    <p className="comment-text">{c.text}</p>
                  </div>
                </li>
              ))}
            </ul>
            <form className="comment-reply" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void save({ text, parentId: thread.id }); }}>
              <input className="field" placeholder="Ответить" value={text} onChange={(e) => setText(e.target.value)} />
              <button type="submit" className="icon-btn" aria-label="Отправить ответ" disabled={busy || !text.trim()}><PaperPlaneRightIcon size={14} aria-hidden /></button>
            </form>
          </div>
        </div>
      )}

      {mode && !draft && !thread && <div className="comment-hint">Кликни на холст, чтобы оставить комментарий</div>}
    </div>
  );
}
