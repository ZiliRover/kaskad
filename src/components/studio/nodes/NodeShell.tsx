"use client";

import { XIcon } from "@phosphor-icons/react";
import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { MediaKind } from "@/lib/models/types";
import { NodeIcon, type NodeKey } from "../icons";
import { useStudio } from "../store";

interface Props {
  id: string;
  title: string;
  icon: NodeKey;
  dtype: MediaKind;
  selected?: boolean;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/** Common frame: draggable header with the output handle, body, optional footer. */
export function NodeShell({ id, title, icon, dtype, selected, busy, wide, children, footer }: Props) {
  const removeNode = useStudio((s) => s.removeNode);
  return (
    <div className={`node${wide ? " node-wide" : ""}${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}`}>
      <div className="node-head">
        <NodeIcon node={icon} dtype={dtype} />
        <span className="node-title">{title}</span>
        <button
          type="button"
          className="icon-btn node-close nodrag"
          aria-label="Удалить ноду"
          title="Удалить (Delete)"
          onClick={() => removeNode(id)}
        >
          <XIcon size={13} weight="bold" aria-hidden />
        </button>
        <Handle type="source" position={Position.Right} id={dtype} className={`handle handle-${dtype}`} />
      </div>
      <div className="node-body">{children}</div>
      {footer}
    </div>
  );
}
