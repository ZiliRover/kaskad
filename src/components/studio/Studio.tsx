"use client";

import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useState } from "react";
import type { GraphDoc } from "@/lib/graph/types";
import type { GraphState } from "@/lib/jobs";
import type { Fx } from "@/lib/money";
import { Canvas } from "./Canvas";
import { Gallery } from "./Gallery";
import { Templates } from "./Templates";
import { useTheme } from "./theme";
import { ConfirmDialog, Lightbox, Toasts } from "./Overlays";
import { Shortcuts } from "./Shortcuts";
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
  blockedVendors: string[];
}

export function Studio({ graphId, graphName, initialDoc, initialState, providerMode, fx, blockedVendors }: Props) {
  // the store is a browser singleton: fill it on mount, never during server render
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useStudio.getState().init(graphId, initialDoc, initialState, fx);
    useStudio.setState({ blockedVendors });
    setReady(true);
  }, [graphId, initialDoc, initialState, fx, blockedVendors]);
  useEffect(() => useTheme.getState().init(), []);

  return (
    <ReactFlowProvider>
      <div className="app">
        <TopBar graphName={graphName} providerMode={providerMode} />
        <div className="workspace">
          <Sidebar />
          <main className="canvas">{ready ? <Canvas /> : null}</main>
          <Gallery />
        </div>
      </div>
      <Shortcuts />
      <Templates />
      <Toasts />
      <ConfirmDialog />
      <Lightbox />
    </ReactFlowProvider>
  );
}
