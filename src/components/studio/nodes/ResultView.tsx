"use client";

import type { NodeState } from "@/lib/jobs";
import type { MediaKind } from "@/lib/models/types";
import { useStudio } from "../store";

interface Props {
  kind: MediaKind;
  node: NodeState | undefined;
  busy: boolean;
  aspect: string | undefined;
}

function aspectStyle(aspect: string | undefined): React.CSSProperties {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  return { aspectRatio: m ? `${m[1]} / ${m[2]}` : "16 / 9" };
}

export function ResultView({ kind, node, busy, aspect }: Props) {
  const setLightbox = useStudio((s) => s.setLightbox);
  const toast = useStudio((s) => s.toast);
  const out = node?.output;

  if (!out) {
    if (!busy) return null;
    return kind === "text"
      ? <div className="result skeleton skeleton-text" />
      : <div className="result skeleton" style={aspectStyle(aspect)} />;
  }

  const version = node && node.outputCount > 1 ? <span className="result-version">версия {node.outputCount}</span> : null;

  // previous result stays visible (dimmed) while a new one generates
  return (
    <div className={`result${busy ? " is-stale" : ""}`}>
      {out.kind === "image" && out.url && (
        <button type="button" className="result-media nodrag" onClick={() => setLightbox(out.url)} aria-label="Открыть крупно">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={out.url} alt="Результат генерации" />
        </button>
      )}
      {out.kind === "video" && out.url && (
        <video className="result-media nodrag" src={out.url} controls loop playsInline preload="metadata" />
      )}
      {out.kind === "text" && (
        <div className="result-text nodrag nowheel">{out.text}</div>
      )}
      <div className="result-bar">
        {version}
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
