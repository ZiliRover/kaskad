"use client";

import { Handle, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { MediaKind } from "@/lib/models/types";
import { useStudio } from "../store";

interface Props {
  id: string;
  title: string;
  dtype: MediaKind;
  selected?: boolean;
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/** Common frame: draggable header with the output handle, body, optional footer. */
export function NodeShell({ id, title, dtype, selected, busy, wide, children, footer }: Props) {
  const removeNode = useStudio((s) => s.removeNode);
  return (
    <div className={`node${wide ? " node-wide" : ""}${selected ? " is-selected" : ""}${busy ? " is-busy" : ""}`}>
      <div className="node-head">
        <span className={`dot dot-${dtype}`} aria-hidden />
        <span className="node-title">{title}</span>
        <button
          type="button"
          className="icon-btn node-close nodrag"
          aria-label="Удалить ноду"
          title="Удалить"
          onClick={() => removeNode(id)}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M1.5 1.5l7 7m0-7l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <Handle type="source" position={Position.Right} id={dtype} className={`handle handle-${dtype}`} />
      </div>
      <div className="node-body">{children}</div>
      {footer}
    </div>
  );
}
