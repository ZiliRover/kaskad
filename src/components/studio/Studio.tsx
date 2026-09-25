"use client";

import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useState } from "react";
import type { GraphDoc } from "@/lib/graph/types";
import type { GraphState } from "@/lib/jobs";
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
}

export function Studio({ graphId, graphName, initialDoc, initialState, providerMode }: Props) {
  // the store is a browser singleton: fill it on mount, never during server render
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useStudio.getState().init(graphId, initialDoc, initialState);
    setReady(true);
  }, [graphId, initialDoc, initialState]);

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
