"use client";

import type { NodeProps } from "@xyflow/react";
import { memo, useRef, useState } from "react";
import { useStudio, type ImageNodeT } from "../store";
import { fileUrl, firstImageFile, uploadImage } from "../upload";
import { NodeShell } from "./NodeShell";

export const ImageNode = memo(function ImageNode({ id, data, selected }: NodeProps<ImageNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  const toast = useStudio((s) => s.toast);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function take(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadImage(file);
      updateData<ImageNodeT>(id, { fileKey: r.key, name: file.name });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <NodeShell id={id} title="Изображение" icon="image" dtype="image" selected={selected} busy={busy}>
      <button
        type="button"
        className={`drop nodrag${data.fileKey ? " has-image" : ""}${over ? " is-over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setOver(false); take(firstImageFile(e.dataTransfer.files)); }}
      >
        {data.fileKey ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(data.fileKey)} alt={data.name || "Загруженное изображение"} />
            <span className="drop-replace">Заменить</span>
          </>
        ) : busy ? (
          <span className="drop-hint">Загружаю…</span>
        ) : (
          <span className="drop-hint">
            <strong>Загрузить картинку</strong>
            <span>или перетащи файл сюда</span>
            <span className="drop-formats">PNG, JPEG, WebP до 20 МБ</span>
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => { take(firstImageFile(e.target.files)); e.target.value = ""; }}
      />
    </NodeShell>
  );
});
