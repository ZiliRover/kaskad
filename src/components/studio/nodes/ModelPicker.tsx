"use client";

import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { getModel, modelsOfKind } from "@/lib/models/registry";
import type { MediaKind, ModelGroup } from "@/lib/models/types";
import { CapIcons } from "../icons";

interface Props {
  kind: MediaKind;
  value: string;
  onChange: (modelId: string) => void;
}

const GROUP_ORDER: Record<ModelGroup, number> = {
  video: 0, "video-edit": 1, image: 0, "image-style": 1, "image-vector": 2, text: 0,
};

const GROUP_LABEL: Partial<Record<ModelGroup, string>> = {
  "video-edit": "Правка и апскейл",
  "image-style": "Стиль по образцам",
  "image-vector": "Векторы SVG",
};

export function ModelPicker({ kind, value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const current = getModel(value);
  const q = query.trim().toLowerCase();
  const models = modelsOfKind(kind)
    .filter((m) => !q || `${m.name} ${m.vendor} ${m.blurb}`.toLowerCase().includes(q))
    // main group first, specialised ones after their header (sort is stable)
    .sort((a, b) => GROUP_ORDER[a.group] - GROUP_ORDER[b.group]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  let lastGroup: ModelGroup | null = null;

  return (
    <div className="picker nodrag nowheel" ref={root}>
      <button
        type="button"
        className="picker-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
      >
        <span className="picker-name">{current?.name ?? "Модель недоступна"}</span>
        <span className="picker-vendor">{current?.vendor}</span>
        <CaretDownIcon className="chev" size={12} weight="bold" aria-hidden />
      </button>
      {current && (current.blurb || current.caps) && (
        <div className="picker-sub">
          {current.blurb && <span className="picker-blurb">{current.blurb}</span>}
          <CapIcons caps={current.caps} />
        </div>
      )}
      {open && (
        <div className="picker-pop">
          <label className="picker-search">
            <MagnifyingGlassIcon size={13} aria-hidden />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти модель" aria-label="Поиск модели" />
          </label>
          <ul className="picker-list" role="listbox">
            {models.map((m) => {
              const header = m.group !== lastGroup && GROUP_LABEL[m.group] ? GROUP_LABEL[m.group] : null;
              lastGroup = m.group;
              return (
                <li key={m.id} role="option" aria-selected={m.id === value}>
                  {header && <div className="picker-group">{header}</div>}
                  <button
                    type="button"
                    className={m.id === value ? "is-current" : ""}
                    onClick={() => { onChange(m.id); setOpen(false); }}
                  >
                    <span className="pl-top">
                      <span className="pl-name">{m.name}</span>
                      <span className="pl-vendor">{m.vendor}</span>
                      <CapIcons caps={m.caps} />
                    </span>
                    {m.blurb && <span className="pl-blurb">{m.blurb}</span>}
                  </button>
                </li>
              );
            })}
            {models.length === 0 && <li className="picker-empty">Не нашлось</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
