"use client";

import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import { outputHandle } from "@/lib/graph/types";
import { ASSET_LABEL } from "@/lib/library";
import { useStudio, type AssetNodeT } from "../store";
import { fileUrl } from "../upload";
import { NodeShell } from "./NodeShell";

/** A library item on the canvas: its photos go into image inputs, its description into the prompt. */
export const AssetNode = memo(function AssetNode({ id, data, selected }: NodeProps<AssetNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  // the library version, to offer an update when it changed after this node was placed
  const fresh = useStudio((s) => (data.assetId ? s.library.find((l) => l.id === data.assetId) : undefined));
  const stale = !!fresh && (fresh.name !== data.name || fresh.description !== data.text || fresh.files.join() !== data.files.join());
  const dtype = outputHandle({ id, type: "asset", position: { x: 0, y: 0 }, data }) ?? "image";

  return (
    <NodeShell
      id={id} title={data.name || "Из библиотеки"} subtitle={ASSET_LABEL[data.kind]} icon="asset" dtype={dtype} selected={selected}
      hint="Фото идут во входы-картинки, описание добавляется к промту модели"
      actions={stale ? (
        <button type="button" className="icon-btn nodrag" title="В библиотеке есть новая версия: обновить" aria-label="Обновить из библиотеки"
          onClick={() => fresh && updateData<AssetNodeT>(id, { name: fresh.name, text: fresh.description, files: fresh.files, kind: fresh.kind })}>
          <ArrowsClockwiseIcon size={13} aria-hidden />
        </button>
      ) : undefined}
    >
      {data.files.length > 0 && (
        <div className="list-grid asset-grid">
          {data.files.map((k, i) => (
            <div key={k} className="list-cell">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={fileUrl(k)} alt={`Фото ${i + 1}`} loading="lazy" />
            </div>
          ))}
        </div>
      )}
      {data.text && <p className="asset-text">{data.text}</p>}
      <label className="asset-toggle nodrag">
        <input type="checkbox" checked={data.addText} onChange={(e) => updateData<AssetNodeT>(id, { addText: e.target.checked })} />
        Добавлять описание к промту модели
      </label>
    </NodeShell>
  );
});
