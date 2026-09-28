"use client";

import { CaretDownIcon, CopyIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { ProjectSummary } from "@/lib/projects";
import { authLost, flushPendingSave, useStudio } from "./store";

const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });

function ago(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return "только что";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

function nodesLabel(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? "нода" : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? "ноды" : "нод";
  return `${n} ${w}`;
}

async function open(id: string) {
  await flushPendingSave(); // don't lose the last edit on the way out
  window.location.assign(`/studio/${id}`);
}

async function send(url: string, method: string, body?: unknown) {
  const r = await fetch(url, {
    method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  if (authLost(r)) throw new Error("");
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Не получилось. Попробуйте ещё раз.");
  return data;
}

/** Project switcher in the header: the canvas name opens the list of all canvases. */
export function Projects({ currentId, initialName, initial }: { currentId: string; initialName: string; initial: ProjectSummary[] }) {
  const toast = useStudio((s) => s.toast);
  const ask = useStudio((s) => s.ask);
  const [openMenu, setOpenMenu] = useState(false);
  const [list, setList] = useState(initial);
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    // fresh list each time: another tab may have added or renamed something
    fetch("/api/graphs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((l) => { if (l) setList(l); }).catch(() => {});
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpenMenu(false); setEditing(null); } };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpenMenu(false); setEditing(null); } };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointerdown", away); window.removeEventListener("keydown", esc); };
  }, [openMenu]);

  const act = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { if ((e as Error).message) toast((e as Error).message, true); } finally { setBusy(false); }
  };

  const create = () => act(async () => { const g = await send("/api/graphs", "POST", { from: "empty" }); await open(g.id); });
  const duplicate = (p: ProjectSummary) => act(async () => { const g = await send("/api/graphs", "POST", { copyOf: p.id }); await open(g.id); });
  const rename = (p: ProjectSummary) => act(async () => {
    const next = draft.trim();
    setEditing(null);
    if (!next || next === p.name) return;
    await send(`/api/graphs/${p.id}`, "PATCH", { name: next });
    setList((l) => l.map((x) => (x.id === p.id ? { ...x, name: next } : x)));
    if (p.id === currentId) setName(next);
  });
  const remove = (p: ProjectSummary) => act(async () => {
    const ok = await ask({
      title: `Удалить «${p.name}»?`,
      body: "Проект удалится вместе со всеми результатами на нём. Это нельзя отменить.",
      confirm: "Удалить",
    });
    if (!ok) return;
    await send(`/api/graphs/${p.id}`, "DELETE");
    const rest = list.filter((x) => x.id !== p.id);
    setList(rest);
    if (p.id === currentId) {
      if (rest.length) await open(rest[0].id);
      else { const g = await send("/api/graphs", "POST", { from: "empty" }); await open(g.id); }
    }
  });

  return (
    <div className="projects" ref={ref}>
      <button
        type="button" className="projects-trigger" aria-haspopup="menu" aria-expanded={openMenu}
        title="Все проекты" onClick={() => setOpenMenu((v) => !v)}
      >
        <span className="graph-name">{name}</span>
        <CaretDownIcon size={11} weight="bold" aria-hidden />
      </button>
      {openMenu && (
        <div className="menu projects-menu" role="menu">
          <div className="projects-head">
            <span className="auth-label">Проекты</span>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void create()}>
              <PlusIcon size={12} weight="bold" aria-hidden />Новый
            </button>
          </div>
          <ul className="projects-list">
            {list.map((p) => (
              <li key={p.id} className={p.id === currentId ? "is-current" : undefined}>
                {editing === p.id ? (
                  <input
                    className="field projects-rename" autoFocus value={draft} maxLength={80}
                    aria-label="Название проекта"
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void rename(p); if (e.key === "Escape") { e.stopPropagation(); setEditing(null); } }}
                    onBlur={() => void rename(p)}
                  />
                ) : (
                  <button type="button" role="menuitem" className="projects-open" onClick={() => void (p.id === currentId ? setOpenMenu(false) : open(p.id))}>
                    <span className="projects-name">{p.name}</span>
                    <span className="projects-meta">{nodesLabel(p.nodes)} · {ago(p.updatedAt)}</span>
                  </button>
                )}
                {editing !== p.id && (
                  <span className="projects-actions">
                    <button type="button" className="icon-btn" title="Переименовать" aria-label={`Переименовать «${p.name}»`}
                      onClick={() => { setEditing(p.id); setDraft(p.name); }}>
                      <PencilSimpleIcon size={13} aria-hidden />
                    </button>
                    <button type="button" className="icon-btn" title="Сделать копию" aria-label={`Копия «${p.name}»`} disabled={busy}
                      onClick={() => void duplicate(p)}>
                      <CopyIcon size={13} aria-hidden />
                    </button>
                    <button type="button" className="icon-btn" title="Удалить" aria-label={`Удалить «${p.name}»`} disabled={busy}
                      onClick={() => void remove(p)}>
                      <TrashIcon size={13} aria-hidden />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
