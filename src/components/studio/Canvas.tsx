"use client";

import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow,
  type Connection, type Edge, type EdgeTypes, type Node, type NodeTypes,
} from "@xyflow/react";
import { useCallback, useRef } from "react";
import { getModel } from "@/lib/models/registry";
import type { MediaKind } from "@/lib/models/types";
import { canConnect, outputType, remember, useStudio, type StudioNode } from "./store";
import { FlowEdge } from "./FlowEdge";
import { useTheme } from "./theme";
import { mediaFiles } from "./upload";
import { GroupNode } from "./nodes/GroupNode";
import { ImageNode } from "./nodes/ImageNode";
import { AssetNode } from "./nodes/AssetNode";
import { ListNode } from "./nodes/ListNode";
import { ModelNode } from "./nodes/ModelNode";
import { NoteNode } from "./nodes/NoteNode";
import { PromptNode } from "./nodes/PromptNode";

const nodeTypes: NodeTypes = { prompt: PromptNode, image: ImageNode, model: ModelNode, note: NoteNode, group: GroupNode, list: ListNode, asset: AssetNode };
const edgeTypes: EdgeTypes = { default: FlowEdge };

export const PALETTE_MIME = "application/x-kaskad-node";
export interface PalettePayload {
  type: StudioNode["type"];
  kind?: MediaKind;
  modelId?: string;
  /** gallery drag: an existing file or text result */
  fileKey?: string;
  fileKind?: "image" | "video" | "audio";
  text?: string;
  /** list node: prompts or files */
  listKind?: "text" | "image";
  /** library item */
  assetId?: string;
}

/**
 * The payload is unreadable during dragover (browser security), so the palette also
 * records it here: that lets a model node light up when a compatible model hovers it.
 */
let dragging: PalettePayload | null = null;
export const setDragPayload = (p: PalettePayload | null) => { dragging = p; };

// muted type colors: the minimap orients, it should not compete with the canvas
const MINIMAP_COLORS: Record<string, string> = {
  text: "rgba(125, 211, 252, .45)", image: "rgba(251, 191, 36, .45)", video: "rgba(251, 113, 133, .45)",
  audio: "rgba(94, 234, 212, .45)", note: "rgba(250, 204, 21, .3)", group: "rgba(150, 150, 160, .12)",
};

/** Model node under the pointer that could take the dragged model (same kind). */
function swapTarget(e: React.DragEvent): { el: HTMLElement; node: StudioNode } | null {
  if (!dragging?.modelId) return null;
  const el = (e.target as HTMLElement).closest?.(".react-flow__node") as HTMLElement | null;
  const node = el && useStudio.getState().nodes.find((n) => n.id === el.dataset.id);
  if (!node || node.type !== "model" || node.data.kind !== getModel(dragging.modelId)?.kind) return null;
  return { el, node };
}

let hovered: HTMLElement | null = null;
const highlight = (el: HTMLElement | null) => {
  if (hovered === el) return;
  hovered?.classList.remove("is-swap-target");
  el?.classList.add("is-swap-target");
  hovered = el;
};

export function Canvas() {
  const nodes = useStudio((s) => s.nodes);
  const edges = useStudio((s) => s.edges);
  const viewport = useStudio((s) => s.viewport);
  const theme = useTheme((s) => s.resolved);
  const { onNodesChange, onEdgesChange, onConnect, setViewport, addNode, addFiles, setModel, setUpload, updateData, toast } = useStudio.getState();
  const { screenToFlowPosition } = useReactFlow();
  // group drag: nodes inside the frame move with it
  const groupDrag = useRef<{ start: { x: number; y: number }; inside: Map<string, { x: number; y: number }> } | null>(null);

  const isValidConnection = useCallback((c: Connection | Edge) => {
    const s = useStudio.getState();
    return canConnect(s.nodes, s.edges, c);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    highlight(null);
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const raw = e.dataTransfer.getData(PALETTE_MIME);
    if (raw) {
      const p = JSON.parse(raw) as PalettePayload;
      dragging = p;
      const target = swapTarget(e);
      dragging = null;
      if (target && p.modelId) {
        setModel(target.node.id, p.modelId);
        toast(`Модель заменена на ${getModel(p.modelId)?.name}`);
        return;
      }
      const id = addNode(p.type, { x: at.x - 40, y: at.y - 20 }, { kind: p.kind, modelId: p.modelId, listKind: p.listKind, assetId: p.assetId, exact: true });
      if (p.fileKey && p.fileKind) setUpload(id, { fileKey: p.fileKey, name: "из галереи", kind: p.fileKind });
      if (p.type === "prompt" && p.text) updateData(id, { text: p.text });
      return;
    }
    // files from the desktop become upload nodes where they were dropped
    const files = mediaFiles(e.dataTransfer.files);
    if (files.length) addFiles(files, { x: at.x - 40, y: at.y - 20 });
  }, [screenToFlowPosition, addNode, addFiles, setModel, setUpload, updateData, toast]);

  const onNodeDragStart = useCallback((_: unknown, node: Node) => {
    if (node.type !== "group") return;
    const g = node as StudioNode & { type: "group" };
    const w = g.width ?? g.data.width, h = g.height ?? g.data.height;
    const inside = new Map<string, { x: number; y: number }>();
    for (const n of useStudio.getState().nodes) {
      if (n.id === g.id || n.type === "group") continue;
      const nw = n.measured?.width ?? 300, nh = n.measured?.height ?? 200;
      const cx = n.position.x + nw / 2, cy = n.position.y + nh / 2;
      if (cx > g.position.x && cx < g.position.x + w && cy > g.position.y && cy < g.position.y + h) {
        inside.set(n.id, { ...n.position });
      }
    }
    groupDrag.current = { start: { ...g.position }, inside };
  }, []);

  const onNodeDrag = useCallback((_: unknown, node: Node) => {
    const d = groupDrag.current;
    if (node.type !== "group" || !d?.inside.size) return;
    const dx = node.position.x - d.start.x, dy = node.position.y - d.start.y;
    useStudio.setState((s) => ({
      nodes: s.nodes.map((n) => {
        const p = d.inside.get(n.id);
        return p ? { ...n, position: { x: p.x + dx, y: p.y + dy } } : n;
      }),
    }));
  }, []);

  return (
    <ReactFlow<StudioNode>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onDelete={({ nodes: n, edges: e }) => remember(n, e)}
      onNodeDragStart={onNodeDragStart}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={() => { groupDrag.current = null; }}
      isValidConnection={isValidConnection}
      defaultViewport={viewport}
      onMoveEnd={(_, v) => setViewport(v)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        highlight(swapTarget(e)?.el ?? null);
      }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) highlight(null); }}
      onDrop={onDrop}
      deleteKeyCode={["Delete", "Backspace"]}
      multiSelectionKeyCode={["Shift", "Meta", "Control"]}
      minZoom={0.2}
      maxZoom={2}
      colorMode={theme}
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
        nodeColor={(n) => MINIMAP_COLORS[outputType(n as StudioNode) ?? n.type ?? ""] ?? "rgba(150, 150, 160, .3)"}
        nodeStrokeWidth={0}
        nodeBorderRadius={6}
        style={{ width: 168, height: 108 }}
        maskColor="var(--minimap-mask)"
      />
      {nodes.length === 0 && (
        <div className="canvas-empty">
          <strong>Холст пуст</strong>
          <span>Возьми шаблон сверху, перетащи модель из панели или брось сюда картинку, видео или аудио</span>
        </div>
      )}
    </ReactFlow>
  );
}
