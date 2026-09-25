"use client";

import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useState } from "react";
import type { GraphDoc } from "@/lib/graph/types";
import type { GraphState } from "@/lib/jobs";
import type { Fx } from "@/lib/money";
import { Canvas } from "./Canvas";
import { ConfirmDialog, Lightbox, Toasts } from "./Overlays";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useStudio } from "./store";

interface Props {
  graphId: string;
  graphName: string;
  initialDoc: GraphDoc;
  initialState: GraphState;
  providerMode: "live" | "mock";
  fx: Fx;
}

export function Studio({ graphId, graphName, initialDoc, initialState, providerMode, fx }: Props) {
  // the store is a browser singleton: fill it on mount, never during server render
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useStudio.getState().init(graphId, initialDoc, initialState, fx);
    setReady(true);
  }, [graphId, initialDoc, initialState, fx]);

  // Ctrl+Z / Cmd+Z restores the last deletion (text fields keep their own undo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.code !== "KeyZ") return; // code, not key: works in the Russian layout too
      const t = e.target;
      if (t instanceof Element && t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!useStudio.getState().trash) return;
      e.preventDefault();
      useStudio.getState().undoDelete();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ReactFlowProvider>
      <div className="app">
        <TopBar graphName={graphName} providerMode={providerMode} />
        <div className="workspace">
          <Sidebar />
          <main className="canvas">{ready ? <Canvas /> : null}</main>
        </div>
      </div>
      <Toasts />
      <ConfirmDialog />
      <Lightbox />
    </ReactFlowProvider>
  );
}
