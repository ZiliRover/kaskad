"use client";

import type { NodeProps } from "@xyflow/react";
import { useStudio, type PromptNodeT } from "../store";
import { NodeShell } from "./NodeShell";

export function PromptNode({ id, data, selected }: NodeProps<PromptNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  return (
    <NodeShell id={id} title="Промт" dtype="text" selected={selected}>
      <textarea
        className="field nodrag nowheel"
        rows={5}
        value={data.text}
        placeholder="Опиши сцену, стиль, свет, движение камеры…"
        onChange={(e) => updateData<PromptNodeT>(id, { text: e.target.value })}
      />
    </NodeShell>
  );
}
