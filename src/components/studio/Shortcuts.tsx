"use client";

import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";
import { useStudio } from "./store";
import { mediaFiles } from "./upload";

const typing = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest("input, textarea, select, [contenteditable=true]");

/**
 * Canvas keyboard shortcuts. Keys are matched by `code`, not `key`, so they work
 * in the Russian layout too. Text fields keep their own copy/paste/undo.
 */
export function Shortcuts() {
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || typing(e.target)) return;
      const s = useStudio.getState();
      if (e.code === "KeyZ" && s.trash) { e.preventDefault(); s.undoDelete(); }
      else if (e.code === "KeyC") {
        const n = s.copySelection();
        if (n) s.toast(n > 1 ? `Скопировано нод: ${n}` : "Нода скопирована");
      } else if (e.code === "KeyD") { e.preventDefault(); s.duplicateSelection(); }
      // Ctrl+V is handled by the paste event: it also carries files from the OS clipboard
    };

    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const files = mediaFiles(e.clipboardData?.files);
      const s = useStudio.getState();
      if (files.length) {
        e.preventDefault();
        const r = document.querySelector(".react-flow")?.getBoundingClientRect();
        const at = r ? screenToFlowPosition({ x: r.left + r.width / 2 - 150, y: r.top + r.height / 2 - 120 }) : { x: 0, y: 0 };
        s.addFiles(files, at);
      } else {
        s.paste();
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("paste", onPaste); };
  }, [screenToFlowPosition]);

  return null;
}
