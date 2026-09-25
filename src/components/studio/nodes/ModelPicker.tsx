"use client";

import { useEffect, useRef, useState } from "react";
import { getModel, modelsOfKind } from "@/lib/models/registry";
import type { MediaKind } from "@/lib/models/types";

interface Props {
  kind: MediaKind;
  value: string;
  onChange: (modelId: string) => void;
}

export function ModelPicker({ kind, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = getModel(value);
  const models = modelsOfKind(kind);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="picker nodrag nowheel" ref={root}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="picker-name">{current?.name ?? "Модель недоступна"}</span>
        <span className="picker-vendor">{current?.vendor}</span>
        <svg className="chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {current && <div className="picker-blurb">{current.blurb}</div>}
      {open && (
        <ul className="picker-list" role="listbox">
          {models.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === value}>
              <button
                type="button"
                className={m.id === value ? "is-current" : ""}
                onClick={() => { onChange(m.id); setOpen(false); }}
              >
                <span className="pl-top">
                  <span className="pl-name">{m.name}</span>
                  <span className="pl-vendor">{m.vendor}</span>
                </span>
                <span className="pl-blurb">{m.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
