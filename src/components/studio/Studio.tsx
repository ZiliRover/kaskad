"use client";

import { ReactFlowProvider } from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useEffect, useState } from "react";
import type { GraphDoc } from "@/lib/graph/types";
import type { GraphState } from "@/lib/jobs";
import type { Fx } from "@/lib/money";
import { formatKop } from "@/lib/money";
import { Billing } from "./Billing";
import { Canvas } from "./Canvas";
import { Gallery } from "./Gallery";
import { Templates } from "./Templates";
import { useTheme } from "./theme";
import { ConfirmDialog, Lightbox, Toasts } from "./Overlays";
import { Shortcuts } from "./Shortcuts";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useStudio, type Account } from "./store";

interface Props {
  graphId: string;
  graphName: string;
  initialDoc: GraphDoc;
  initialState: GraphState;
  providerMode: "live" | "mock";
  fx: Fx;
  blockedVendors: string[];
  account: Account;
}

/** Back from the checkout (?payment=id): wait for the provider's confirmation, then say what happened. */
async function followPayment(id: string) {
  const { toast, refreshBalance } = useStudio.getState();
  window.history.replaceState(null, "", window.location.pathname);
  for (let i = 0; i < 15; i++) {
    const r = await fetch(`/api/payments/${id}`, { cache: "no-store" }).catch(() => null);
    const p = r?.ok ? await r.json() : null;
    if (!p) return;
    if (p.status === "succeeded") { toast(`Баланс пополнен на ${formatKop(p.amountKop)}`); await refreshBalance(); return; }
    if (p.status === "canceled") { toast("Платёж отменён, деньги не списаны"); return; }
    await new Promise((res) => setTimeout(res, 2000));
  }
  toast("Платёж ещё обрабатывается. Баланс обновится, как только банк его подтвердит.");
}

export function Studio({ graphId, graphName, initialDoc, initialState, providerMode, fx, blockedVendors, account }: Props) {
  // the store is a browser singleton: fill it on mount, never during server render
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useStudio.getState().init(graphId, initialDoc, initialState, fx);
    useStudio.setState({ blockedVendors, account });
    setReady(true);
  }, [graphId, initialDoc, initialState, fx, blockedVendors, account]);
  useEffect(() => {
    const payment = new URLSearchParams(window.location.search).get("payment");
    if (payment) void followPayment(payment);
    // a tab left open while generations finish elsewhere
    const onFocus = () => void useStudio.getState().refreshBalance();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
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
      <Billing />
      <Toasts />
      <ConfirmDialog />
      <Lightbox />
    </ReactFlowProvider>
  );
}
