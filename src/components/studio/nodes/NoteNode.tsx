"use client";

import { XIcon } from "@phosphor-icons/react";
import type { NodeProps } from "@xyflow/react";
import { memo } from "react";
import { NOTE_COLORS } from "@/lib/graph/types";
import { NodeIcon } from "../icons";
import { useStudio, type NoteNodeT } from "../store";

const COLOR_LABEL = { yellow: "Жёлтая", blue: "Синяя", pink: "Розовая", green: "Зелёная", gray: "Серая" } as const;

/** Sticky note: plans, briefs and reminders on the canvas. Never executed. */
export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps<NoteNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  const removeNode = useStudio((s) => s.removeNode);
  const color = data.color ?? "yellow";
  return (
    <div className={`note note-${color}${selected ? " is-selected" : ""}`}>
      <div className="node-head note-head">
        <NodeIcon node="note" dtype={null} size={14} />
        <span className="node-title">Заметка</span>
        <span className="note-colors nodrag" role="radiogroup" aria-label="Цвет заметки">
          {NOTE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === color}
              aria-label={COLOR_LABEL[c]}
              className={`swatch swatch-${c}${c === color ? " is-on" : ""}`}
              onClick={() => updateData<NoteNodeT>(id, { color: c })}
            />
          ))}
        </span>
        <button type="button" className="icon-btn node-close nodrag" aria-label="Удалить заметку" onClick={() => removeNode(id)}>
          <XIcon size={12} weight="bold" aria-hidden />
        </button>
      </div>
      <textarea
        className="note-text nodrag nowheel"
        value={data.text}
        rows={5}
        aria-label="Текст заметки"
        placeholder="Идея, бриф, что поправить…"
        onChange={(e) => updateData<NoteNodeT>(id, { text: e.target.value })}
      />
    </div>
  );
});
