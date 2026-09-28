"use client";

import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { useStudio, type StudioStore } from "./store";

/**
 * The run made visible on the wires:
 *  flow     the target is generating now: light pulses travel into it;
 *  pending  the target waits in the queue: a slow dashed route towards it.
 */
function phaseOf(s: StudioStore, nodeId: string): "flow" | "pending" | null {
  const status = s.state[nodeId]?.job?.status;
  if (status === "running") return "flow";
  if (status === "queued" || s.submitting[nodeId]) return "pending";
  return null;
}

export const FlowEdge = memo(function FlowEdge({
  id, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, sourceHandleId, markerEnd, style, interactionWidth,
}: EdgeProps) {
  const phase = useStudio((s) => phaseOf(s, target));
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const dtype = sourceHandleId ?? "text";

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={interactionWidth} />
      {phase && (
        <g className={`edge-run is-${phase} t-${dtype}`} aria-hidden>
          <path d={path} className="edge-run-track" pathLength={100} />
          <path d={path} className="edge-run-pulse" pathLength={100} />
        </g>
      )}
    </>
  );
});
