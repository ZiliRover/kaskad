"use client";

import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { NodeState, OutputVersion } from "@/lib/jobs";
import type { MediaKind } from "@/lib/models/types";
import { useStudio } from "../store";

interface Props {
  nodeId: string;
  kind: MediaKind;
  node: NodeState | undefined;
  busy: boolean;
  aspect: string | undefined;
}

function aspectStyle(aspect: string | undefined): React.CSSProperties {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  return { aspectRatio: m ? `${m[1]} / ${m[2]}` : "16 / 9" };
}

export function ResultView({ nodeId, kind, node, busy, aspect }: Props) {
  const setLightbox = useStudio((s) => s.setLightbox);
  const toast = useStudio((s) => s.toast);
  const graphId = useStudio((s) => s.graphId);

  // version history: 0 = latest; older versions load on first step back
  const [index, setIndex] = useState(0);
  const [versions, setVersions] = useState<OutputVersion[] | null>(null);
  const latestId = node?.output?.id;
  useEffect(() => { setIndex(0); setVersions(null); }, [latestId]);

  const total = node?.outputCount ?? 0;
  const out = index === 0 ? node?.output : versions?.[index];

  async function step(delta: 1 | -1) {
    const next = Math.min(total - 1, Math.max(0, index + delta));
    if (next !== 0 && !versions) {
      try {
        const r = await fetch(`/api/graphs/${graphId}/outputs?node=${encodeURIComponent(nodeId)}`);
        if (!r.ok) throw new Error();
        setVersions(await r.json());
      } catch {
        toast("Не удалось загрузить прошлые версии", true);
        return;
      }
    }
    setIndex(next);
  }

  if (!out) {
    if (!busy) return null;
    return kind === "text"
      ? <div className="result skeleton skeleton-text" />
      : <div className="result skeleton" style={aspectStyle(aspect)} />;
  }

  // previous result stays visible (dimmed) while a new one generates
  return (
    <div className={`result${busy && index === 0 ? " is-stale" : ""}`}>
      {out.kind === "image" && out.url && (
        <button type="button" className="result-media nodrag" onClick={() => setLightbox(out.url)} aria-label="Открыть крупно">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={out.url} alt="Результат генерации" />
        </button>
      )}
      {out.kind === "video" && out.url && (
        <video key={out.url} className="result-media nodrag" src={out.url} controls loop playsInline preload="metadata" />
      )}
      {out.kind === "text" && (
        <div className="result-text nodrag nowheel">{out.text}</div>
      )}
      <div className="result-bar">
        {total > 1 && (
          <div className="versions nodrag" title={index > 0 ? "Дальше по цепочке идёт последняя версия" : undefined}>
            <button type="button" className="icon-btn" aria-label="Предыдущая версия" disabled={index >= total - 1} onClick={() => step(1)}>
              <CaretLeftIcon size={12} weight="bold" aria-hidden />
            </button>
            <span className="versions-label">{total - index} из {total}</span>
            <button type="button" className="icon-btn" aria-label="Следующая версия" disabled={index === 0} onClick={() => step(-1)}>
              <CaretRightIcon size={12} weight="bold" aria-hidden />
            </button>
          </div>
        )}
        {out.kind === "text" ? (
          <button
            type="button"
            className="link-btn nodrag"
            onClick={() => navigator.clipboard.writeText(out.text ?? "").then(
              () => toast("Скопировано"),
              () => toast("Не удалось скопировать", true),
            )}
          >Копировать</button>
        ) : out.url ? (
          <a className="link-btn nodrag" href={`${out.url}?download`} download>Скачать</a>
        ) : null}
      </div>
    </div>
  );
}
