"use client";

import { CopyIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { AppField } from "@/lib/apps";
import { getModel } from "@/lib/models/registry";
import { authLost, flushPendingSave, useStudio, type StudioNode } from "./store";

interface FieldDraft { on: boolean; label: string; hint: string }

function defaultLabel(n: StudioNode, i: number, total: number): string {
  if (n.type === "prompt") return total > 1 ? `Описание ${i + 1}` : "Описание";
  if (n.type === "image") return n.data.kind === "video" ? "Видео" : n.data.kind === "audio" ? "Аудио" : "Фото";
  if (n.type === "list") return n.data.kind === "text" ? "Список: по строке на результат" : "Файлы";
  return "Поле";
}

function nodeCaption(n: StudioNode): string {
  if (n.type === "prompt") return n.data.text.trim().slice(0, 60) || "пустой промт";
  if (n.type === "image") return n.data.name || "файл не загружен";
  if (n.type === "list") return n.data.kind === "text" ? "список строк" : "список файлов";
  return "";
}

/** "Make an app from this project": pick form fields and results, get a link. */
export function AppPublish({ graphId, projectName }: { graphId: string; projectName: string }) {
  const open = useStudio((s) => s.publishOpen);
  const setPanel = useStudio((s) => s.setPanel);
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const toast = useStudio((s) => s.toast);
  const close = () => setPanel({ publishOpen: false });

  const inputs = useMemo(() => nodes.filter((n) => n.type === "prompt" || n.type === "image" || n.type === "list"), [nodes]);
  const models = useMemo(() => nodes.filter((n) => n.type === "model"), [nodes]);
  const sinks = useMemo(() => new Set(models.filter((m) =>
    !edges.some((e) => e.source === m.id && nodes.find((n) => n.id === e.target)?.type === "model")).map((m) => m.id)), [models, edges, nodes]);

  const [name, setName] = useState(projectName);
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<Record<string, FieldDraft>>({});
  const [outputs, setOutputs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLink(null); setError(null); setName(projectName);
    const prompts = inputs.filter((n) => n.type === "prompt");
    setFields(Object.fromEntries(inputs.map((n) => [n.id, {
      on: true, hint: "",
      label: defaultLabel(n, n.type === "prompt" ? prompts.indexOf(n) : 0, n.type === "prompt" ? prompts.length : 1),
    }])));
    setOutputs(models.filter((m) => sinks.has(m.id)).map((m) => m.id));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPanel({ publishOpen: false }); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const publish = async () => {
    setBusy(true); setError(null);
    try {
      await flushPendingSave(); // the server publishes what is saved
      const list: AppField[] = inputs.filter((n) => fields[n.id]?.on).map((n) => ({
        nodeId: n.id, label: fields[n.id].label.trim() || "Поле", hint: fields[n.id].hint.trim(),
        type: n.type === "prompt" ? "text" : n.type === "image" ? "file" : n.type === "list" && n.data.kind === "text" ? "list-text" : "list-file",
        required: true,
      }));
      const r = await fetch("/api/apps", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graphId, name, description, fields: list, outputs }),
      });
      if (authLost(r)) return;
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Не удалось опубликовать");
      setLink(`${window.location.origin}${d.url}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog publish" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <div className="templates-head">
          <h2 id="publish-title" className="dialog-title">Приложение из проекта</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={close}><XIcon size={14} weight="bold" aria-hidden /></button>
        </div>

        {link ? (
          <div className="publish-done">
            <p className="dialog-body">Готово. По ссылке откроется форма: человек заполняет поля и запускает граф за свой счёт. Сам граф он не видит.</p>
            <div className="publish-link">
              <input className="field" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Ссылка на приложение" />
              <button type="button" className="btn" onClick={() => navigator.clipboard.writeText(link).then(() => toast("Ссылка скопирована"), () => toast("Не удалось скопировать", true))}>
                <CopyIcon size={14} aria-hidden />Копировать
              </button>
            </div>
            <div className="dialog-actions">
              <a className="btn btn-primary" href={link} target="_blank" rel="noreferrer">Открыть приложение</a>
            </div>
          </div>
        ) : (
          <form className="publish-form" onSubmit={(e) => { e.preventDefault(); void publish(); }}>
            <label className="auth-label" htmlFor="app-name">Название</label>
            <input id="app-name" className="field" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <label className="auth-label" htmlFor="app-desc">Что делает (увидят люди)</label>
            <textarea id="app-desc" className="field" rows={2} maxLength={600} value={description}
              placeholder="Например: загрузи фото товара и получи карточку для маркетплейса" onChange={(e) => setDescription(e.target.value)} />

            <span className="auth-label">Поля формы</span>
            <p className="app-hint">Отмеченные входы человек заполнит сам. Остальные останутся как в проекте.</p>
            <div className="publish-list">
              {inputs.length === 0 && <p className="app-hint">В проекте нет промтов, файлов или списков.</p>}
              {inputs.map((n) => {
                const f = fields[n.id];
                if (!f) return null;
                return (
                  <div key={n.id} className={`publish-row${f.on ? " is-on" : ""}`}>
                    <input type="checkbox" checked={f.on} aria-label={`Поле: ${nodeCaption(n)}`}
                      onChange={() => setFields((x) => ({ ...x, [n.id]: { ...f, on: !f.on } }))} />
                    <div className="publish-row-body">
                      <span className="publish-caption">{nodeCaption(n)}</span>
                      {f.on && (
                        <input className="field" value={f.label} maxLength={80} aria-label="Подпись поля"
                          onChange={(e) => setFields((x) => ({ ...x, [n.id]: { ...f, label: e.target.value } }))} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <span className="auth-label">Результаты</span>
            <div className="publish-list">
              {models.map((m) => {
                const on = outputs.includes(m.id);
                const spec = m.type === "model" ? getModel(m.data.modelId) : undefined;
                return (
                  <label key={m.id} className={`publish-row${on ? " is-on" : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => setOutputs((o) => (on ? o.filter((x) => x !== m.id) : [...o, m.id]))} />
                    <span className="publish-caption">{spec?.name ?? "Модель"}{sinks.has(m.id) ? "" : " (промежуточный шаг)"}</span>
                  </label>
                );
              })}
            </div>

            {error && <p className="auth-error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button type="submit" className="btn btn-primary" disabled={busy || !outputs.length || !name.trim()}>
                {busy ? "Публикую…" : "Опубликовать"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
