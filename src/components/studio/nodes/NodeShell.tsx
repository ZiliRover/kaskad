"use client";

import { XIcon } from "@phosphor-icons/react";
import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { DType } from "@/lib/models/types";
import { NodeIcon, type NodeKey } from "../icons";
import { useStudio } from "../store";

interface Props {
  id: string;
  title: string;
  /** small text after the title, e.g. model vendor */
  subtitle?: string;
  /** tooltip on the header */
  hint?: string;
  icon: NodeKey;
  dtype: DType;
  selected?: boolean;
  busy?: boolean;
  /** generating right now (not just queued) */
  running?: boolean;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /** extra header controls, left of the close button */
  actions?: ReactNode;
}

/** Common frame: draggable header with the output handle, body, optional footer. */
export function NodeShell({ id, title, subtitle, hint, icon, dtype, selected, busy, running, wide, children, footer, actions }: Props) {
  const removeNode = useStudio((s) => s.removeNode);
  return (
    <div className={`node${wide ? " node-wide" : ""}${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}${running ? " is-running" : ""}`}>
      <div className="node-head" title={hint}>
        <NodeIcon node={icon} dtype={dtype} />
        <span className="node-title">
          {title}
          {subtitle && <span className="node-subtitle">{subtitle}</span>}
        </span>
        {actions}
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
