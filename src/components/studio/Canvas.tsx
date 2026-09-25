"use client";

import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow,
  type Connection, type Edge, type NodeTypes,
} from "@xyflow/react";
import { useCallback } from "react";
import type { MediaKind } from "@/lib/models/types";
import { canConnect, outputType, remember, useStudio, type StudioNode } from "./store";
import { mediaFiles } from "./upload";
import { ImageNode } from "./nodes/ImageNode";
import { ModelNode } from "./nodes/ModelNode";
import { PromptNode } from "./nodes/PromptNode";

const nodeTypes: NodeTypes = { prompt: PromptNode, image: ImageNode, model: ModelNode };

export const PALETTE_MIME = "application/x-kaskad-node";
export interface PalettePayload { type: StudioNode["type"]; kind?: MediaKind; modelId?: string }

// muted type colors: the minimap orients, it should not compete with the canvas
const MINIMAP_COLORS: Record<string, string> = {
  text: "rgba(125, 211, 252, .45)", image: "rgba(251, 191, 36, .45)", video: "rgba(251, 113, 133, .45)", audio: "rgba(94, 234, 212, .45)",
};

export function Canvas() {
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const viewport = useStudio((s) => s.viewport);
  const { onNodesChange, onEdgesChange, onConnect, setViewport, addNode, addFiles } = useStudio.getState();
  const { screenToFlowPosition } = useReactFlow();

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const s = useStudio.getState();
    return canConnect(s.nodes, s.edges, c);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const payload = e.dataTransfer.getData(PALETTE_MIME);
    if (payload) {
      const p = JSON.parse(payload) as PalettePayload;
      addNode(p.type, { x: at.x - 40, y: at.y - 20 }, { kind: p.kind, modelId: p.modelId, exact: true });
      return;
    }
    // files from the desktop become upload nodes where they were dropped
    const files = mediaFiles(e.dataTransfer.files);
    if (files.length) addFiles(files, { x: at.x - 40, y: at.y - 20 });
  }, [screenToFlowPosition, addNode, addFiles]);

  return (
    <ReactFlow<StudioNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDelete={({ nodes: n, edges: e }) => remember(n, e)}
      isValidConnection={isValidConnection}
      defaultViewport={viewport}
      onMoveEnd={(_, v) => setViewport(v)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={onDrop}
      deleteKeyCode={["Delete", "Backspace"]}
      multiSelectionKeyCode={["Shift", "Meta", "Control"]}
      minZoom={0.2}
      maxZoom={2}
      colorMode="dark"
      connectionRadius={28}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--grid-dot)" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        ariaLabel="Миникарта холста"
        nodeColor={(n) => MINIMAP_COLORS[outputType(n as StudioNode)] ?? "#6b707a"}
        nodeStrokeWidth={0}
        nodeBorderRadius={6}
        style={{ width: 168, height: 108 }}
        maskColor="rgba(14, 15, 18, 0.72)"
      />
      {nodes.length === 0 && (
        <div className="canvas-empty">
          <strong>Холст пуст</strong>
          <span>Перетащи модель из панели слева или брось сюда картинку, видео или аудио</span>
        </div>
      )}
    </ReactFlow>
  );
}
