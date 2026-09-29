"use client";

import { PencilSimpleIcon, PlusIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ASSET_KINDS } from "@/lib/graph/types";
import { ASSET_HINT, ASSET_LABEL, type AssetKind, type LibraryItem } from "@/lib/library";
import { authLost, useStudio } from "./store";
import { fileUrl, mediaFiles, uploadFile } from "./upload";

/** Load the library into the store once; the sidebar and dialogs read it from there. */
export async function loadLibrary() {
  try {
    const r = await fetch("/api/library", { cache: "no-store" });
    if (authLost(r) || !r.ok) return;
    useStudio.setState({ library: await r.json() });
  } catch { /* the section simply stays empty */ }
}

/** Create or edit a library item: kind, name, description, up to 9 photos. */
export function LibraryDialog() {
  const editing = useStudio((s) => s.libraryEdit);
  const toast = useStudio((s) => s.toast);
  const ask = useStudio((s) => s.ask);
  const close = () => useStudio.setState({ libraryEdit: null });
  const [kind, setKind] = useState<AssetKind>("character");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) return;
    const item = editing === "new" ? null : editing;
    setKind(item?.kind ?? "character"); setName(item?.name ?? ""); setDescription(item?.description ?? "");
    setFiles(item?.files ?? useStudio.getState().libraryPrefill ?? []); setError(null);
    useStudio.setState({ libraryPrefill: null });
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") useStudio.setState({ libraryEdit: null }); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [editing]);

  if (!editing) return null;
  const item = editing === "new" ? null : editing;

  const add = async (list: File[]) => {
    const take = list.filter((f) => f.type.startsWith("image/")).slice(0, 9 - files.length);
    setUploading(take.length);
    const keys: string[] = [];
    for (const f of take) {
      try { keys.push((await uploadFile(f)).key); } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
      setUploading((n) => n - 1);
    }
    setFiles((x) => [...x, ...keys].slice(0, 9));
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(item ? `/api/library/${item.id}` : "/api/library", {
        method: item ? "PUT" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, description, files }),
      });
      if (authLost(r)) return;
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Не удалось сохранить");
      await loadLibrary();
      toast(item ? "Сохранено" : `«${d.name}» в библиотеке: перетащи на холст`);
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!item || !(await ask({ title: `Удалить «${item.name}»?`, body: "Из библиотеки. Ноды на холстах останутся как есть.", confirm: "Удалить" }))) return;
    await fetch(`/api/library/${item.id}`, { method: "DELETE" });
    await loadLibrary();
    close();
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog library" role="dialog" aria-modal="true" aria-labelledby="lib-title">
        <div className="templates-head">
          <h2 id="lib-title" className="dialog-title">{item ? item.name : "Новое в библиотеке"}</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={close}><XIcon size={14} weight="bold" aria-hidden /></button>
        </div>
        <form className="publish-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="director-chips" role="radiogroup" aria-label="Что это">
            {ASSET_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} className={`chip${kind === k ? " is-on" : ""}`} onClick={() => setKind(k)}>{ASSET_LABEL[k]}</button>
            ))}
          </div>
          <label className="auth-label" htmlFor="lib-name">Название</label>
          <input id="lib-name" className="field" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)}
            placeholder={kind === "brand" ? "Кофейня «Зерно»" : kind === "product" ? "Сумка-шоппер «Сити»" : kind === "style" ? "Тёплый плёночный" : "Лиса Рыжик"} />
          <label className="auth-label" htmlFor="lib-desc">Описание</label>
          <textarea id="lib-desc" className="field" rows={4} maxLength={4000} value={description} placeholder={ASSET_HINT[kind]} onChange={(e) => setDescription(e.target.value)} />
          <span className="auth-label">Фото (до 9)</span>
          <div className="list-grid" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(mediaFiles(e.dataTransfer.files)); }}>
            {files.map((k, i) => (
              <div key={k} className="list-cell">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(k)} alt={`Фото ${i + 1}`} />
                <button type="button" className="list-remove" aria-label={`Убрать фото ${i + 1}`} onClick={() => setFiles((x) => x.filter((f) => f !== k))}>
                  <XIcon size={10} weight="bold" aria-hidden />
                </button>
              </div>
            ))}
            {files.length < 9 && (
              <button type="button" className="list-add" disabled={uploading > 0} onClick={() => input.current?.click()}>
                {uploading ? <span>Загружаю…</span> : <><PlusIcon size={14} aria-hidden /><span>Фото</span></>}
              </button>
            )}
          </div>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
            onChange={(e) => { void add(mediaFiles(e.target.files)); e.target.value = ""; }} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            {item && <button type="button" className="btn btn-ghost library-delete" onClick={() => void remove()}><TrashIcon size={14} aria-hidden />Удалить</button>}
            <button type="submit" className="btn btn-primary" disabled={busy || uploading > 0 || !name.trim() || (!description.trim() && !files.length)}>
              {busy ? "Сохраняю…" : item ? "Сохранить" : "Добавить в библиотеку"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Sidebar row of a library item: drag onto the canvas, or edit. */
export function LibraryRow({ item, onDragStart, onAdd }: {
  item: LibraryItem; onDragStart: (e: React.DragEvent) => void; onAdd: () => void;
}) {
  return (
    <div className="library-row">
      <button type="button" className="palette-item library-item" draggable onDragStart={onDragStart} onClick={onAdd}
        title="Перетащи на холст или нажми, чтобы добавить">
        <span className="library-thumbs">
          {item.thumbs.length
            // eslint-disable-next-line @next/next/no-img-element
            ? item.thumbs.slice(0, 3).map((t) => <img key={t} src={t} alt="" />)
            : <span className="library-initial">{item.name.slice(0, 1)}</span>}
        </span>
        <span className="pi-text">
          <span className="pi-title">{item.name}</span>
          <span className="pi-desc">{ASSET_LABEL[item.kind]}{item.files.length ? ` · ${item.files.length} фото` : ""}</span>
        </span>
      </button>
      <button type="button" className="icon-btn library-edit" aria-label={`Изменить «${item.name}»`} title="Изменить"
        onClick={() => useStudio.setState({ libraryEdit: item })}>
        <PencilSimpleIcon size={13} aria-hidden />
      </button>
    </div>
  );
}
