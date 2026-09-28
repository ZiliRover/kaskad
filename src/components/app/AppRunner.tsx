"use client";

import { ArrowLeftIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { AppField, AppInfo } from "@/lib/apps";
import { LIST_MAX } from "@/lib/graph/types";
import { ACTIVE_STATUSES, type GraphState } from "@/lib/jobs";
import { formatKop, formatRub, toKop, type Fx } from "@/lib/money";
import { BRAND } from "@/config/brand";
import { ACCEPT_ATTR, fileUrl, mediaFiles, uploadFile } from "../studio/upload";

type Values = Record<string, string | string[]>;

function FileField({ field, value, onChange, multiple }: {
  field: AppField; value: string[]; onChange: (keys: string[]) => void; multiple: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setError(null);
    const keys: string[] = [];
    for (const f of multiple ? files.slice(0, LIST_MAX - value.length) : files.slice(0, 1)) {
      try {
        const r = await uploadFile(f);
        if (field.kind && r.kind !== field.kind) { setError(`${f.name}: нужен файл другого типа`); continue; }
        keys.push(r.key);
      } catch (e) { setError(`${f.name}: ${(e as Error).message}`); }
    }
    onChange(multiple ? [...value, ...keys] : keys.slice(0, 1));
    setBusy(false);
  };

  return (
    <div
      className={`app-files${over ? " is-over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void add(mediaFiles(e.dataTransfer.files)); }}
    >
      {value.map((k) => (
        <div key={k} className="app-file">
          {field.kind === "video" ? <video src={`${fileUrl(k)}#t=0.1`} muted preload="metadata" />
            : field.kind === "audio" ? <audio src={fileUrl(k)} controls preload="none" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={fileUrl(k)} alt="" />}
          <button type="button" className="list-remove" aria-label="Убрать файл" onClick={() => onChange(value.filter((x) => x !== k))}>
            <XIcon size={10} weight="bold" aria-hidden />
          </button>
        </div>
      ))}
      {(multiple ? value.length < LIST_MAX : value.length === 0) && (
        <button type="button" className="app-file-add" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? "Загружаю…" : <><PlusIcon size={16} aria-hidden /><span>{multiple ? "Добавить файлы" : "Загрузить файл"}</span><span className="app-file-sub">или перетащи сюда</span></>}
        </button>
      )}
      {error && <p className="auth-error">{error}</p>}
      <input ref={input} type="file" hidden multiple={multiple} accept={ACCEPT_ATTR}
        onChange={(e) => { void add(mediaFiles(e.target.files)); e.target.value = ""; }} />
    </div>
  );
}

export function AppRunner({ app, price, fx, balanceKop, graphId: initialGraph, initialState, isOwner, sourceGraphId }: {
  app: AppInfo;
  price: { unitUsd: number; approx: boolean; perItem: boolean };
  fx: Fx;
  /** null for operators: they run without a limit */
  balanceKop: number | null;
  graphId: string | null;
  initialState: GraphState;
  isOwner: boolean;
  sourceGraphId: string | null;
}) {
  const [values, setValues] = useState<Values>(() => Object.fromEntries(app.fields.map((f) => [
    f.nodeId, f.type === "text" || f.type === "list-text" ? f.default ?? "" : [],
  ])));
  const [graphId, setGraphId] = useState(initialGraph);
  const [state, setState] = useState<GraphState>(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; funds?: boolean } | null>(null);
  const [balance, setBalance] = useState(balanceKop);

  const active = app.outputs.some((o) => {
    const s = state[o.nodeId]?.job?.status;
    return !!s && ACTIVE_STATUSES.includes(s);
  });

  // follow the run until every output settles
  useEffect(() => {
    if (!graphId || !active) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/graphs/${graphId}/state`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) setState(await r.json());
    }, 2000);
    return () => clearInterval(t);
  }, [graphId, active]);
  useEffect(() => {
    if (active || balance === null) return;
    fetch("/api/billing", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((b) => { if (b) setBalance(b.balanceKop); }).catch(() => {});
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = Math.max(1, ...app.fields.filter((f) => f.type.startsWith("list")).map((f) => {
    const v = values[f.nodeId];
    return Array.isArray(v) ? v.length : String(v).split("\n").filter((l) => l.trim()).length;
  }));
  const usd = price.unitUsd * (price.perItem ? items : 1);

  const run = async () => {
    setBusy(true); setError(null);
    const payload: Values = {};
    for (const f of app.fields) {
      const v = values[f.nodeId];
      payload[f.nodeId] = f.type === "list-text" ? String(v).split("\n").map((l) => l.trim()).filter(Boolean) : v;
    }
    try {
      const r = await fetch(`/api/apps/${app.id}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: payload }),
      });
      if (r.status === 401) { window.location.assign(`/login?next=/app/${app.id}`); return; }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError({ text: d.error ?? "Не удалось запустить", funds: r.status === 402 }); return; }
      setGraphId(d.graphId);
      const s = await fetch(`/api/graphs/${d.graphId}/state`, { cache: "no-store" });
      if (s.ok) setState(await s.json());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-page">
      <header className="app-top">
        <a className="auth-brand" href="/studio"><span className="logo" aria-hidden /><span className="brand">{BRAND.name}</span></a>
        <span className="app-top-right">
          {isOwner && sourceGraphId && (
            <a className="link-btn" href={`/studio/${sourceGraphId}`}><ArrowLeftIcon size={12} aria-hidden /> Открыть граф</a>
          )}
          {balance !== null && <a className="btn btn-ghost btn-sm" href="/studio" title="Пополнить в студии">Баланс {formatKop(Math.max(0, balance))}</a>}
        </span>
      </header>

      <main className="app-main">
        <form className="app-form" onSubmit={(e) => { e.preventDefault(); if (!busy && !active) void run(); }}>
          <h1 className="app-title">{app.name}</h1>
          {app.description && <p className="app-desc">{app.description}</p>}

          {app.fields.map((f) => (
            <div key={f.nodeId} className="app-field">
              <label className="auth-label" htmlFor={`f-${f.nodeId}`}>{f.label}{!f.required && <span className="app-optional"> · необязательно</span>}</label>
              {f.hint && <span className="app-hint">{f.hint}</span>}
              {f.type === "text" || f.type === "list-text" ? (
                <textarea
                  id={`f-${f.nodeId}`} className="field app-textarea" rows={f.type === "list-text" ? 6 : 4}
                  value={String(values[f.nodeId] ?? "")}
                  placeholder={f.type === "list-text" ? "Каждая строка: отдельный результат" : ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.nodeId]: e.target.value }))}
                />
              ) : (
                <FileField field={f} multiple={f.type === "list-file"} value={(values[f.nodeId] as string[]) ?? []}
                  onChange={(keys) => setValues((v) => ({ ...v, [f.nodeId]: keys }))} />
              )}
            </div>
          ))}

          {error && (
            <p className="auth-error" role="alert">
              {error.text}{error.funds && <> <a className="link-btn" href="/studio">Пополнить баланс</a></>}
            </p>
          )}
          <button type="submit" className="btn btn-primary app-run" disabled={busy || active}>
            {active ? "Генерация идёт…" : busy ? "Запускаю…" : usd > 0
              ? `Запустить · ${price.approx ? "≈ " : ""}${formatRub(usd, fx)}`
              : "Запустить"}
          </button>
          {price.perItem && items > 1 && <p className="app-hint">{items} шт. по {formatRub(price.unitUsd, fx)}</p>}
        </form>

        <section className="app-results" aria-label="Результаты" aria-live="polite">
          {app.outputs.map((o) => {
            const s = state[o.nodeId];
            const job = s?.job;
            const status = !job ? null
              : job.status === "queued" ? (job.items ? `В очереди: ${job.items.total} шт.` : "В очереди")
                : job.status === "running" ? (job.items ? `Генерация: готово ${job.items.done} из ${job.items.total}` : "Генерация…")
                  : job.status === "failed" || job.status === "skipped" ? job.error ?? "Не получилось"
                    : job.status === "canceled" ? "Остановлено" : null;
            const cost = job?.status === "succeeded" ? job.chargedKop ?? (job.costUsd !== null ? toKop(job.costUsd, fx) : null) : null;
            const tiles = s?.batch.length ? s.batch : s?.output ? [{ id: s.output.id, url: s.output.url }] : [];
            return (
              <div key={o.nodeId} className="app-output">
                <div className="app-output-head">
                  <span className="app-output-name">{o.label}</span>
                  {status && <span className={`app-status${job?.status === "failed" || job?.status === "skipped" ? " is-error" : ""}`}>{status}</span>}
                  {cost !== null && cost > 0 && <span className="compare-price">{formatKop(cost)}</span>}
                </div>
                {o.kind === "text" && s?.output?.text ? <div className="app-text">{s.output.text}</div> : tiles.length ? (
                  <div className={`app-tiles${tiles.length > 1 ? " is-many" : ""}`}>
                    {tiles.map((t, i) => t.url && (
                      <figure key={t.id} className="app-tile">
                        {o.kind === "image"
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <a href={t.url} target="_blank" rel="noreferrer"><img src={t.url} alt={`Результат ${i + 1}`} /></a>
                          : o.kind === "video" ? <video src={`${t.url}#t=0.1`} controls playsInline preload="metadata" />
                            : <audio src={t.url} controls preload="metadata" />}
                        <a className="link-btn" href={`${t.url}?download`} download>Скачать{tiles.length > 1 ? ` ${i + 1}` : ""}</a>
                      </figure>
                    ))}
                  </div>
                ) : (
                  <div className={`app-empty${job && ACTIVE_STATUSES.includes(job.status) ? " skeleton" : ""}`}>
                    {!job && "Здесь появится результат"}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
