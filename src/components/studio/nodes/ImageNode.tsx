"use client";

import type { NodeProps } from "@xyflow/react";
import { memo, useRef, useState } from "react";
import { useStudio, type ImageNodeT } from "../store";
import { ACCEPT_ATTR, fileUrl, mediaFiles, uploadFile } from "../upload";
import { NodeShell } from "./NodeShell";

const TITLES = { image: "Изображение", video: "Видео", audio: "Аудио" } as const;

/** An uploaded file: image, video or audio. Stored as node type "image" for compatibility. */
export const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps<ImageNodeT>) {
  const setUpload = useStudio((s) => s.setUpload);
  const toast = useStudio((s) => s.toast);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const kind = data.kind ?? "image";

  async function take(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadFile(file);
      setUpload(id, { fileKey: r.key, name: file.name, kind: r.kind });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  const url = data.fileKey ? fileUrl(data.fileKey) : null;
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(true); },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); take(mediaFiles(e.dataTransfer.files)[0]); },
  };

  return (
    <NodeShell id={id} title={TITLES[kind]} icon={`upload:${kind}`} dtype={kind} selected={selected} busy={busy}>
      {url && kind === "image" ? (
        <button type="button" className={`drop nodrag has-image${over ? " is-over" : ""}`} onClick={() => input.current?.click()} {...dropProps}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={data.name || "Загруженное изображение"} />
          <span className="drop-replace">Заменить</span>
        </button>
      ) : url ? (
        <div className={`drop has-image nodrag${over ? " is-over" : ""}`} {...dropProps}>
          {kind === "video"
            ? <video className="drop-media" src={url} controls loop playsInline preload="metadata" />
            : <audio className="drop-audio" src={url} controls preload="metadata" />}
          <button type="button" className="drop-replace is-visible" onClick={() => input.current?.click()}>Заменить</button>
        </div>
      ) : (
        <button type="button" className={`drop nodrag${over ? " is-over" : ""}`} onClick={() => input.current?.click()} {...dropProps}>
          {busy ? <span className="drop-hint">Загружаю…</span> : (
            <span className="drop-hint">
              <strong>Загрузить файл</strong>
              <span>или перетащи сюда</span>
              <span className="drop-formats">Картинка, видео или аудио</span>
            </span>
          )}
        </button>
      )}
      {url && <div className="file-name" title={data.name}>{data.name}</div>}
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => { take(mediaFiles(e.target.files)[0]); e.target.value = ""; }}
      />
    </NodeShell>
  );
});
