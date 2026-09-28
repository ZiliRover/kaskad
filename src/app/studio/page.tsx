import { connection } from "next/server";
import { Studio } from "@/components/studio/Studio";
import { getFx } from "@/server/fx";
import { DEFAULT_GRAPH_ID, graphState, loadGraph } from "@/server/graphs";
import { blockedVendors, providerMode } from "@/server/providers";

export default async function StudioPage() {
  await connection(); // per-request: reads the database
  const [graph, fx] = await Promise.all([loadGraph(DEFAULT_GRAPH_ID), getFx()]);
  if (!graph) throw new Error("default graph missing");
  return (
    <Studio
      graphId={graph.id}
      graphName={graph.name}
      initialDoc={graph.doc}
      initialState={await graphState(graph.id)}
      providerMode={providerMode()}
      fx={fx}
      blockedVendors={blockedVendors()}
    />
  );
}
