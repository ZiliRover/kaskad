"use client";

import { CaretLeftIcon, CaretRightIcon, CheckIcon, PushPinIcon, WaveformIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { NodeState, OutputVersion } from "@/lib/jobs";
import type { MediaKind } from "@/lib/models/types";
import { FeedButton } from "../FeedButton";
import { useStudio } from "../store";

interface Props {
  nodeId: string;
  kind: MediaKind;
  node: NodeState | undefined;
  busy: boolean;
  aspect: string | undefined;
  /** result the user chose to pass downstream (undefined = latest) */
  pinnedId: string | undefined;
}

function aspectStyle(aspect: string | undefined): React.CSSProperties {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  return { aspectRatio: m ? `${m[1]} / ${m[2]}` : "16 / 9" };
}

type Shown = Pick<OutputVersion, "id" | "kind" | "url" | "text">;

export function ResultView({ nodeId, kind, node, busy, aspect, pinnedId }: Props) {
  const setLightbox = useStudio((s) => s.setLightbox);
  const toast = useStudio((s) => s.toast);
  const pin = useStudio((s) => s.pin);
  const graphId = useStudio((s) => s.graphId);

  const latest = node?.output ?? null;
  const total = node?.outputCount ?? 0;
  const [versions, setVersions] = useState<OutputVersion[] | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);

  // history (newest first) is loaded once there is more than one result
  useEffect(() => {
    setViewId(null);
    if (total < 2 || !latest) { setVersions(null); return; }
    let live = true;
    fetch(`/api/graphs/${graphId}/outputs?node=${encodeURIComponent(nodeId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((v: OutputVersion[]) => { if (live) setVersions(v); })
      .catch(() => { if (live) toast("Не удалось загрузить прошлые версии", true); });
    return () => { live = false; };
  }, [graphId, nodeId, latest?.id, total, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!latest) {
    if (!busy) return null;
    return kind === "text" || kind === "audio"
      ? <div className="result skeleton skeleton-text" />
      : <div className="result skeleton" style={aspectStyle(aspect)} />;
  }

  const batch = node?.batch ?? [];
  // a batch run (list): its results are the items, one per input, nothing to pick
  const fanned = !!node?.job?.items;
  const find = (id: string | null | undefined): Shown | undefined => {
    if (!id) return undefined;
    if (id === latest.id) return latest;
    const b = batch.find((x) => x.id === id);
    if (b) return { id: b.id, url: b.url, kind: latest.kind, text: null };
    return versions?.find((v) => v.id === id);
  };
  const selectedId = find(pinnedId) ? pinnedId! : latest.id;
  const out: Shown = find(viewId) ?? (fanned ? find(batch[0]?.id) : undefined) ?? find(selectedId) ?? latest;
  const list = versions ?? [];
  const index = Math.max(0, list.findIndex((v) => v.id === out.id));

  const choose = (id: string) => { pin(nodeId, id === latest.id ? null : id); setViewId(null); };

  // previous result stays visible (dimmed) while a new one generates
  return (
    <div className={`result${busy ? " is-stale" : ""}`}>
      {node?.job?.draft && node.job.status === "succeeded" && <span className="draft-tag" title="Сделано в режиме черновика: дешёвые настройки">черновик</span>}
      {out.kind === "image" && out.url && (
        <button type="button" className="result-media nodrag" onClick={() => setLightbox(out.url)} aria-label="Открыть крупно">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={out.url} alt="Результат генерации" />
        </button>
      )}
      {out.kind === "video" && out.url && (
        <video key={out.url} className="result-media nodrag" src={`${out.url}#t=0.1`} controls loop playsInline preload="metadata" />
      )}
      {out.kind !== "text" && out.text && <p className="result-note">{out.text}</p>}
      {out.kind === "audio" && out.url && (
        <audio key={out.url} className="result-audio nodrag" src={out.url} controls preload="metadata" />
      )}
      {out.kind === "text" && <div className="result-text nodrag nowheel">{out.text}</div>}

      {batch.length > 1 && (
        <div
          className={`batch nodrag nowheel${batch.length > 5 ? " is-many" : ""}`} role="listbox"
          aria-label={fanned ? "Результаты по элементам списка" : "Варианты последнего запуска"}
          style={{ gridTemplateColumns: `repeat(${Math.min(batch.length, 5)}, 1fr)` }}
        >
          {batch.map((b, i) => (
            <button
              key={b.id}
              type="button"
              role="option"
              aria-selected={fanned ? b.id === out.id : b.id === selectedId}
              className={`batch-item${!fanned && b.id === selectedId ? " is-selected" : ""}${b.id === out.id ? " is-viewed" : ""}`}
              onClick={() => (fanned ? setViewId(b.id) : choose(b.id))}
              title={fanned ? `Элемент ${i + 1}` : `Вариант ${i + 1}: передавать дальше`}
            >
              {b.url && latest.kind === "audio"
                ? <span className="batch-audio"><WaveformIcon size={16} aria-hidden /></span>
                : b.url && latest.kind === "video"
                ? <video src={`${b.url}#t=0.1`} muted preload="metadata" />
                // eslint-disable-next-line @next/next/no-img-element
                : b.url && <img src={b.url} alt={`${fanned ? "Элемент" : "Вариант"} ${i + 1}`} />}
              {fanned && <span className="batch-num">{i + 1}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="result-bar">
        {total > 1 && list.length > 0 && (
          <div className="versions nodrag">
            <button type="button" className="icon-btn" aria-label="Предыдущая версия" disabled={index >= list.length - 1} onClick={() => setViewId(list[index + 1].id)}>
              <CaretLeftIcon size={12} weight="bold" aria-hidden />
            </button>
            <span className="versions-label">{list.length - index} из {list.length}</span>
            <button type="button" className="icon-btn" aria-label="Следующая версия" disabled={index === 0} onClick={() => setViewId(list[index - 1].id)}>
              <CaretRightIcon size={12} weight="bold" aria-hidden />
            </button>
          </div>
        )}
        {total > 1 && !fanned && (out.id === selectedId ? (
          <span className="flows" title="Эта версия уходит в следующие ноды"><CheckIcon size={11} weight="bold" aria-hidden />идёт дальше</span>
        ) : (
          <button type="button" className="link-btn nodrag pin-btn" onClick={() => choose(out.id)}>
            <PushPinIcon size={11} weight="bold" aria-hidden />Передавать дальше
          </button>
        ))}
        <span className="result-actions">
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
            <>
              {batch.length > 1 && (
                <a className="link-btn nodrag" href={`/api/graphs/${graphId}/zip?node=${encodeURIComponent(nodeId)}`} download>Скачать всё</a>
              )}
              {(out.kind === "image" || out.kind === "video") && <FeedButton outputId={out.id} up />}
              <a className="link-btn nodrag" href={`${out.url}?download`} download>Скачать</a>
            </>
          ) : null}
        </span>
      </div>
    </div>
  );
}
