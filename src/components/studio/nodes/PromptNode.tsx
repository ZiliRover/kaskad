"use client";

import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useStudio, type PromptNodeT } from "../store";
import { NodeShell } from "./NodeShell";

export const PromptNode = memo(function PromptNode({ id, data, selected }: NodeProps<PromptNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  return (
    <NodeShell id={id} title="Промт" icon="prompt" dtype="text" selected={selected}>
      <textarea
        className="field nodrag nowheel"
        rows={5}
        value={data.text}
        aria-label="Текст промта"
        placeholder="Опиши сцену, стиль, свет, движение камеры"
        onChange={(e) => updateData<PromptNodeT>(id, { text: e.target.value })}
      />
    </NodeShell>
  );
});
