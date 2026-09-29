"use client";

import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeSlashIcon, ScissorsIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { fanOut } from "@/lib/graph/plan";
import type { GraphDoc, ModelData } from "@/lib/graph/types";
import { getModel } from "@/lib/models/registry";
import { fileUrl } from "../upload";
import { useStudio, type ModelNodeT } from "../store";

type Timeline = NonNullable<ModelData["timeline"]>;
interface Clip { key: string; label: string; url: string | null }

const sec = (s: number) => `${s.toFixed(1).replace(".", ",")} с`;

/** Clips feeding the montage node, in wire order, the way the planner sees them. */
function useClips(nodeId: string): Clip[] {
  // a string snapshot: equal clips compare equal, so the node re-renders only on real changes
  const json = useStudio((s) => {
    const fans = fanOut({ nodes: s.nodes as unknown as GraphDoc["nodes"], edges: s.edges as GraphDoc["edges"] });
    const clips: Clip[] = [];
    for (const e of s.edges.filter((x) => x.target === nodeId && x.targetHandle === "clips")) {
      const src = s.nodes.find((n) => n.id === e.source);
      if (!src) continue;
      if (src.type === "image" && src.data.fileKey) {
        clips.push({ key: `file:${src.data.fileKey}`, label: src.data.name || "Файл", url: fileUrl(src.data.fileKey) });
      } else if (src.type === "model") {
        const name = getModel(src.data.modelId)?.name ?? "Видео";
        const st = s.state[src.id];
        const fan = fans.get(src.id) ?? 0;
        if (fan) {
          for (let i = 0; i < fan; i++) {
            const b = st?.batch[i] ?? (fan === 1 && st?.output ? { url: st.output.url } : undefined);
            clips.push({ key: `${src.id}#${i}`, label: `${name} · ${i + 1}`, url: b?.url ?? null });
          }
        } else {
          clips.push({ key: `${src.id}#`, label: name, url: st?.output?.url ?? null });
        }
      }
    }
    return JSON.stringify(clips);
  });
  return useMemo(() => JSON.parse(json) as Clip[], [json]);
}

/** Order, trim and switch off the clips of a montage; the run reads this from the node. */
export function TimelineEditor({ nodeId, data }: { nodeId: string; data: ModelData }) {
  const updateData = useStudio((s) => s.updateData);
  const clips = useClips(nodeId);
  const [open, setOpen] = useState<string | null>(null);
  const [lengths, setLengths] = useState<Record<string, number>>({});
  const tl: Timeline = { order: [], trims: {}, off: [], ...data.timeline };

  const rank = (k: string) => { const i = tl.order.indexOf(k); return i < 0 ? 1e6 : i; };
  const ordered = clips.map((c, i) => ({ ...c, i })).sort((a, b) => rank(a.key) - rank(b.key) || a.i - b.i);
  const save = (next: Partial<Timeline>) =>
    updateData<ModelNodeT>(nodeId, { timeline: { ...tl, order: ordered.map((c) => c.key), ...next } });

  const move = (idx: number, dir: -1 | 1) => {
    const keys = ordered.map((c) => c.key);
    const j = idx + dir;
    if (j < 0 || j >= keys.length) return;
    [keys[idx], keys[j]] = [keys[j], keys[idx]];
    save({ order: keys });
  };
  const toggle = (k: string) => save({ off: tl.off.includes(k) ? tl.off.filter((x) => x !== k) : [...tl.off, k] });
  const trim = (k: string, patch: { start?: number; end?: number | null }) => {
    const cur = tl.trims[k] ?? { start: 0, end: null };
    save({ trims: { ...tl.trims, [k]: { ...cur, ...patch } } });
  };

  const length = (c: Clip) => {
    const full = lengths[c.key];
    if (full === undefined) return null;
    const t = tl.trims[c.key] ?? { start: 0, end: null };
    return Math.max(0, (t.end ?? full) - t.start);
  };
  const on = ordered.filter((c) => !tl.off.includes(c.key));
  const known = on.map(length);
  const total = known.every((x) => x !== null) ? known.reduce((a, b) => a + (b ?? 0), 0) : null;

  if (!clips.length) return <p className="list-hint">Подключи ролики во вход «Ролики»: они выстроятся здесь по порядку.</p>;

  return (
    <div className="timeline nodrag nowheel">
      {ordered.map((c, idx) => {
        const off = tl.off.includes(c.key);
        const t = tl.trims[c.key] ?? { start: 0, end: null };
        const full = lengths[c.key];
        const len = length(c);
        return (
          <div key={c.key} className={`tl-clip${off ? " is-off" : ""}`}>
            <div className="tl-row">
              <span className="tl-index">{idx + 1}</span>
              <div className="tl-thumb">
                {c.url
                  ? <video src={`${c.url}#t=${t.start + 0.05}`} muted preload="metadata"
                      onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setLengths((x) => ({ ...x, [c.key]: d })); }} />
                  : <span>нет</span>}
              </div>
              <span className="tl-label" title={c.label}>{c.label}<span className="tl-len">{len !== null ? sec(len) : c.url ? "…" : "ещё не готов"}</span></span>
              <span className="tl-actions">
                <button type="button" className="icon-btn" aria-label="Выше" disabled={idx === 0} onClick={() => move(idx, -1)}><ArrowUpIcon size={12} aria-hidden /></button>
                <button type="button" className="icon-btn" aria-label="Ниже" disabled={idx === ordered.length - 1} onClick={() => move(idx, 1)}><ArrowDownIcon size={12} aria-hidden /></button>
                <button type="button" className={`icon-btn${open === c.key ? " is-on" : ""}`} aria-label="Обрезать" title="Обрезать" disabled={!full} onClick={() => setOpen(open === c.key ? null : c.key)}><ScissorsIcon size={12} aria-hidden /></button>
                <button type="button" className="icon-btn" aria-label={off ? "Включить" : "Выключить"} title={off ? "Включить" : "Убрать из монтажа"} onClick={() => toggle(c.key)}>
                  {off ? <EyeSlashIcon size={12} aria-hidden /> : <EyeIcon size={12} aria-hidden />}
                </button>
              </span>
            </div>
            {open === c.key && full !== undefined && (
              <div className="tl-trim">
                <label>Начало <input type="range" min={0} max={full} step={0.1} value={t.start}
                  onChange={(e) => trim(c.key, { start: Math.min(Number(e.target.value), (t.end ?? full) - 0.2) })} /> <span>{sec(t.start)}</span></label>
                <label>Конец <input type="range" min={0} max={full} step={0.1} value={t.end ?? full}
                  onChange={(e) => { const v = Math.max(Number(e.target.value), t.start + 0.2); trim(c.key, { end: v >= full - 0.05 ? null : v }); }} /> <span>{sec(t.end ?? full)}</span></label>
              </div>
            )}
          </div>
        );
      })}
      <p className="tl-total">Итого: {on.length} из {clips.length}{total !== null ? `, ${sec(total)}` : ""}</p>
    </div>
  );
}
