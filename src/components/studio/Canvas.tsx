"use client";

import {
  Background, BackgroundVariant, Controls, ReactFlow, useReactFlow,
  type Connection, type Edge, type NodeTypes,
} from "@xyflow/react";
import { useCallback } from "react";
import type { MediaKind } from "@/lib/models/types";
import { canConnect, useStudio, type ImageNodeT, type StudioNode } from "./store";
import { firstImageFile, uploadImage } from "./upload";
import { ImageNode } from "./nodes/ImageNode";
import { ModelNode } from "./nodes/ModelNode";
import { PromptNode } from "./nodes/PromptNode";

const nodeTypes: NodeTypes = { prompt: PromptNode, image: ImageNode, model: ModelNode };

export const PALETTE_MIME = "application/x-kaskad-node";

export function Canvas() {
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const viewport = useStudio((s) => s.viewport);
  const { onNodesChange, onEdgesChange, onConnect, setViewport, addNode, updateData, toast } = useStudio.getState();
  const { screenToFlowPosition } = useReactFlow();

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const s = useStudio.getState();
    return canConnect(s.nodes, s.edges, c);
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const payload = e.dataTransfer.getData(PALETTE_MIME);
    if (payload) {
      const { type, kind } = JSON.parse(payload) as { type: StudioNode["type"]; kind?: MediaKind };
      addNode(type, { x: at.x - 40, y: at.y - 20 }, kind, true);
      return;
    }
    // an image file dropped on empty canvas becomes an Image node
    const file = firstImageFile(e.dataTransfer.files);
    if (!file) return;
    addNode("image", { x: at.x - 40, y: at.y - 20 }, undefined, true);
    const id = useStudio.getState().nodes.at(-1)!.id;
    try {
      const r = await uploadImage(file);
      updateData<ImageNodeT>(id, { fileKey: r.key, name: file.name });
    } catch (err) {
      toast((err as Error).message, true);
    }
  }, [screenToFlowPosition, addNode, updateData, toast]);

  return (
    <ReactFlow<StudioNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      defaultViewport={viewport}
      onMoveEnd={(_, v) => setViewport(v)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={onDrop}
      deleteKeyCode={["Delete", "Backspace"]}
      minZoom={0.2}
      maxZoom={2}
      colorMode="dark"
      connectionRadius={28}
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="var(--grid-dot)" />
      <Controls showInteractive={false} position="bottom-left" />
      {nodes.length === 0 && (
        <div className="canvas-empty">
          <strong>Холст пуст</strong>
          <span>Перетащи ноду из панели слева или брось сюда картинку</span>
        </div>
      )}
    </ReactFlow>
  );
}
