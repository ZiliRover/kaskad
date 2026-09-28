"use client";

import { XIcon } from "@phosphor-icons/react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { NodeIcon } from "../icons";
import { useStudio, type GroupNodeT } from "../store";

/**
 * Titled frame behind a part of the graph. Dragging it by the title moves the nodes
 * inside (handled in Canvas); deleting it keeps them.
 */
export const GroupNode = memo(function GroupNode({ id, data, selected }: NodeProps<GroupNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  const removeNode = useStudio((s) => s.removeNode);
  return (
    <div className={`group${selected ? " is-selected" : ""}`}>
      <NodeResizer
        isVisible={selected}
        minWidth={240}
        minHeight={140}
        lineClassName="group-resize-line"
        handleClassName="group-resize-handle"
        onResizeEnd={(_, p) => updateData<GroupNodeT>(id, { width: Math.round(p.width), height: Math.round(p.height) })}
      />
      <div className="group-head">
        <NodeIcon node="group" dtype={null} size={14} />
        <input
          className="group-title nodrag"
          value={data.title}
          aria-label="Название группы"
          onChange={(e) => updateData<GroupNodeT>(id, { title: e.target.value })}
        />
        <button
          type="button"
          className="icon-btn nodrag"
          aria-label="Удалить группу (ноды внутри останутся)"
          title="Удалить группу, ноды останутся"
          onClick={() => removeNode(id)}
        >
          <XIcon size={12} weight="bold" aria-hidden />
        </button>
      </div>
    </div>
  );
});
