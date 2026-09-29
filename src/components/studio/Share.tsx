"use client";

import { LinkIcon, UsersThreeIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { ROLE_LABEL, type Member } from "@/lib/sharing";
import { authLost, useStudio } from "./store";

/** "Поделиться": who has access to this project, invitations by email. */
export function Share() {
  const graphId = useStudio((s) => s.graphId);
  const role = useStudio((s) => s.role);
  const me = useStudio((s) => s.me);
  const toast = useStudio((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owner = role === "owner";

  useEffect(() => {
    if (!open) return;
    fetch(`/api/graphs/${graphId}/members`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).then(setMembers).catch(() => setMembers([]));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, graphId]);

  const send = async (method: "POST" | "DELETE", body: unknown) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/graphs/${graphId}/members`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (authLost(r)) return null;
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Не получилось");
      setMembers(d.members);
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const inviteNow = async () => {
    const d = await send("POST", { email, role: newRole });
    if (!d) return;
    toast(d.status === "invited" ? "Приглашение ждёт: проект появится, когда человек войдёт с этой почтой" : "Доступ выдан");
    setEmail("");
  };

  const leave = async () => {
    if (!me) return;
    if (await send("DELETE", { userId: me.id })) window.location.assign("/studio");
  };

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm share-btn" title="Доступ к проекту" onClick={() => setOpen(true)}>
        <UsersThreeIcon size={14} aria-hidden /><span className="tb-label">Поделиться</span>
      </button>
      {open && (
        <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="dialog share" role="dialog" aria-modal="true" aria-labelledby="share-title">
            <div className="templates-head">
              <h2 id="share-title" className="dialog-title">Доступ к проекту</h2>
              <button type="button" className="icon-btn" aria-label="Закрыть" onClick={() => setOpen(false)}><XIcon size={14} weight="bold" aria-hidden /></button>
            </div>
            {owner ? (
              <form className="share-invite" onSubmit={(e) => { e.preventDefault(); if (email.trim()) void inviteNow(); }}>
                <input className="field" type="email" placeholder="почта коллеги" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Почта" />
                <select className="field" value={newRole} onChange={(e) => setNewRole(e.target.value as "editor" | "viewer")} aria-label="Роль">
                  <option value="editor">Редактор</option>
                  <option value="viewer">Зритель</option>
                </select>
                <button type="submit" className="btn btn-primary" disabled={busy || !email.trim()}>Пригласить</button>
              </form>
            ) : (
              <p className="dialog-body">Ты {role === "viewer" ? "зритель: можешь смотреть и скачивать" : "редактор: меняешь граф и запускаешь, платишь за свои запуски"}. Приглашать может владелец.</p>
            )}
            <p className="app-hint">Редактор меняет граф и запускает генерации за свой счёт. Зритель только смотрит.</p>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <ul className="share-list">
              {members === null && <li className="app-hint">Загружаю…</li>}
              {members?.map((m) => (
                <li key={m.userId ?? m.email}>
                  <span className="avatar" style={{ background: colorFor(m.email) }} aria-hidden>{m.email.slice(0, 1).toUpperCase()}</span>
                  <span className="share-email">{m.email}{m.userId === me?.id && " (ты)"}</span>
                  <span className="share-role">{m.pending ? "приглашён" : ROLE_LABEL[m.role]}</span>
                  {owner && m.role !== "owner" && (
                    <button type="button" className="icon-btn" aria-label={`Убрать ${m.email}`} disabled={busy}
                      onClick={() => void send("DELETE", m.userId ? { userId: m.userId } : { email: m.email })}>
                      <XIcon size={12} aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              {!owner && <button type="button" className="btn btn-ghost library-delete" onClick={() => void leave()}>Покинуть проект</button>}
              <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(window.location.href).then(() => toast("Ссылка скопирована: откроется у участников"))}>
                <LinkIcon size={14} aria-hidden />Скопировать ссылку
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** A stable, readable colour per person (avatars, cursors, selections). */
export function colorFor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 62% 52%)`;
}
