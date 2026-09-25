"use client";

import { SparkleIcon, TranslateIcon } from "@phosphor-icons/react";
import type { NodeProps } from "@xyflow/react";
import { memo, useEffect, useRef, useState } from "react";
import { useStudio, type PromptNodeT } from "../store";
import { NodeShell } from "./NodeShell";

type Mode = "improve" | "translate";

/** Rewrites or translates the prompt with a cheap text model, tuned to where the prompt goes. */
function EnhanceMenu({ id, text }: { id: string; text: string }) {
  const updateData = useStudio((s) => s.updateData);
  const toast = useStudio((s) => s.toast);
  // tune the rewrite for the first model this prompt feeds
  const target = useStudio((s) => {
    const e = s.edges.find((x) => x.source === id);
    const n = e && s.nodes.find((x) => x.id === e.target);
    return n?.type === "model" ? n.data.kind : null;
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Mode | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  async function go(mode: Mode) {
    setOpen(false);
    if (!text.trim()) { toast("Сначала напиши промт", true); return; }
    setBusy(mode);
    try {
      const r = await fetch("/api/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, target, mode }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Не удалось");
      const before = text;
      updateData<PromptNodeT>(id, { text: d.text });
      toast(mode === "improve" ? "Промт улучшен" : "Промт переведён", false, {
        label: "Вернуть", run: () => updateData<PromptNodeT>(id, { text: before }),
      });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="enhance nodrag" ref={root}>
      <button
        type="button"
        className={`icon-btn enhance-btn${busy ? " is-busy" : ""}`}
        aria-label="Улучшить промт"
        title="Улучшить или перевести промт"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!!busy}
        onClick={() => setOpen((o) => !o)}
      >
        <SparkleIcon size={14} weight={busy ? "fill" : "regular"} aria-hidden />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={() => go("improve")}>
            <SparkleIcon size={13} aria-hidden />Улучшить промт
          </button>
          <button type="button" role="menuitem" onClick={() => go("translate")}>
            <TranslateIcon size={13} aria-hidden />Перевести на английский
          </button>
        </div>
      )}
    </div>
  );
}

export const PromptNode = memo(function PromptNode({ id, data, selected }: NodeProps<PromptNodeT>) {
  const updateData = useStudio((s) => s.updateData);
  return (
    <NodeShell
      id={id} title="Промт" icon="prompt" dtype="text" selected={selected}
      actions={<EnhanceMenu id={id} text={data.text} />}
    >
      <textarea
        className="field nodrag nowheel"
        rows={5}
        value={data.text}
        aria-label="Текст промта"
        placeholder="Опиши сцену своими словами. Кнопка со звёздочкой сделает из этого подробный промт"
        onChange={(e) => updateData<PromptNodeT>(id, { text: e.target.value })}
      />
    </NodeShell>
  );
});
