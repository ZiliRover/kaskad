import { connection } from "next/server";
import { Studio } from "@/components/studio/Studio";
import { DEFAULT_GRAPH_ID, graphState, loadGraph } from "@/server/graphs";
import { providerMode } from "@/server/providers";

export default async function StudioPage() {
  await connection(); // per-request: reads the database
  const graph = (await loadGraph(DEFAULT_GRAPH_ID))!;
  return (
    <Studio
      graphId={graph.id}
      graphName={graph.name}
      initialDoc={graph.doc}
      initialState={await graphState(graph.id)}
      providerMode={providerMode()}
    />
  );
}
