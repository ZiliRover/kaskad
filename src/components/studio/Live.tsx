"use client";

import { NavigationArrowIcon } from "@phosphor-icons/react";
import { useReactFlow, ViewportPortal } from "@xyflow/react";
import { useEffect } from "react";
import { colorFor } from "./Share";
import { applyRemote, clientId, ensurePolling, refreshState, reloadRemote, useStudio } from "./store";

export interface Peer {
  user: { id: string; email: string };
  cursor: { x: number; y: number } | null;
  selection: string[];
  at: number;
}

const STALE_MS = 9_000;

/**
 * The project's live channel: remote edits, job updates and where the others are.
 * Renders nothing; lives inside the React Flow provider to map cursors to the canvas.
 */
export function LiveChannel() {
  const graphId = useStudio((s) => s.graphId);
  const { screenToFlowPosition } = useReactFlow();

  useEffect(() => {
    if (!graphId) return;
    let stateTimer: ReturnType<typeof setTimeout> | null = null;
    const es = new EventSource(`/api/graphs/${graphId}/live?client=${clientId}`);
    es.onmessage = (e) => {
      let msg: { t: string; from?: string; ops?: unknown; user?: Peer["user"]; cursor?: Peer["cursor"]; selection?: string[] };
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === "ops") applyRemote(msg.ops as Parameters<typeof applyRemote>[0]);
      else if (msg.t === "reload") void reloadRemote();
      else if (msg.t === "state") {
        // a burst of job updates becomes one refetch
        if (stateTimer) clearTimeout(stateTimer);
        stateTimer = setTimeout(() => { void refreshState().then(() => ensurePolling()); }, 250);
      } else if (msg.t === "presence" && msg.from && msg.user) {
        const peer: Peer = { user: msg.user, cursor: msg.cursor ?? null, selection: msg.selection ?? [], at: Date.now() };
        useStudio.setState((s) => ({ peers: { ...s.peers, [msg.from!]: peer } }));
      } else if (msg.t === "leave" && msg.from) {
        useStudio.setState((s) => { const { [msg.from!]: _gone, ...peers } = s.peers; return { peers }; });
      } else if (msg.t === "comments") {
        useStudio.setState((s) => ({ commentsRev: s.commentsRev + 1 }));
      }
    };

    // where I am: on cursor moves (a few times a second at most) and as a heartbeat
    let cursor: Peer["cursor"] = null;
    let last = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;
    const send = () => {
      last = Date.now();
      const selection = useStudio.getState().nodes.filter((n) => n.selected).map((n) => n.id).slice(0, 50);
      void fetch(`/api/graphs/${graphId}/live`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client: clientId, cursor, selection }),
      }).catch(() => {});
    };
    const onMove = (e: PointerEvent) => {
      const pane = (e.target as Element | null)?.closest?.(".react-flow");
      cursor = pane ? screenToFlowPosition({ x: e.clientX, y: e.clientY }) : null;
      if (Date.now() - last > 140) send();
      else if (!pending) pending = setTimeout(() => { pending = null; send(); }, 140);
    };
    window.addEventListener("pointermove", onMove);
    const beat = setInterval(send, 3_000);
    const prune = setInterval(() => {
      const now = Date.now();
      useStudio.setState((s) => {
        const alive = Object.entries(s.peers).filter(([, p]) => now - p.at < STALE_MS);
        return alive.length === Object.keys(s.peers).length ? s : { peers: Object.fromEntries(alive) };
      });
    }, 2_000);
    send();

    return () => {
      es.close();
      window.removeEventListener("pointermove", onMove);
      clearInterval(beat); clearInterval(prune);
      if (pending) clearTimeout(pending);
      if (stateTimer) clearTimeout(stateTimer);
      useStudio.setState({ peers: {} });
    };
  }, [graphId, screenToFlowPosition]);

  return null;
}

/** Other people's cursors on the canvas, and their selected nodes outlined in their colour. */
export function PeerCursors() {
  // every other open tab, including your own second tab
  const list = Object.entries(useStudio((s) => s.peers));
  const style = list.flatMap(([, p]) => p.selection.map((id) =>
    `.react-flow__node[data-id="${CSS.escape(id)}"] > .node { box-shadow: 0 0 0 2px ${colorFor(p.user.email)}, var(--shadow); }`)).join("\n");
  return (
    <>
      {style && <style>{style}</style>}
      <ViewportPortal>
        {list.map(([id, p]) => p.cursor && (
          <div key={id} className="peer-cursor" style={{ transform: `translate(${p.cursor.x}px, ${p.cursor.y}px)`, color: colorFor(p.user.email) }}>
            <NavigationArrowIcon size={18} weight="fill" style={{ transform: "scaleX(-1)" }} aria-hidden />
            <span className="peer-name" style={{ background: colorFor(p.user.email) }}>{p.user.email.split("@")[0]}</span>
          </div>
        ))}
      </ViewportPortal>
    </>
  );
}

/** Who else has the project open. */
export function PeerAvatars() {
  const peers = useStudio((s) => s.peers);
  const me = useStudio((s) => s.me);
  const people = [...new Map(Object.values(peers).filter((p) => p.user.id !== me?.id).map((p) => [p.user.id, p.user])).values()];
  if (!people.length) return null;
  return (
    <span className="peers" aria-label={`Сейчас в проекте: ${people.map((u) => u.email).join(", ")}`}>
      {people.slice(0, 4).map((u) => (
        <span key={u.id} className="avatar peer-avatar" style={{ background: colorFor(u.email) }} title={u.email}>{u.email.slice(0, 1).toUpperCase()}</span>
      ))}
      {people.length > 4 && <span className="avatar peer-avatar peer-more">+{people.length - 4}</span>}
    </span>
  );
}
