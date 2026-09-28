import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Studio } from "@/components/studio/Studio";
import { isAdmin } from "@/server/admin";
import { currentUser } from "@/server/auth";
import { balanceKop, reservedKop } from "@/server/billing";
import { getFx } from "@/server/fx";
import { graphState, userGraph } from "@/server/graphs";
import { paymentsProvider } from "@/server/payments";
import { blockedVendors, providerMode } from "@/server/providers";
import { accountBalanceUsd } from "@/server/providers/openrouter";

export default async function StudioPage() {
  await connection(); // per-request: reads the session and the database
  const user = await currentUser();
  if (!user) redirect("/login");
  const admin = isAdmin(user);
  const [graph, fx, available, reserved, providerUsd] = await Promise.all([
    userGraph(user.id), getFx(), balanceKop(user.id), reservedKop(user.id),
    admin ? accountBalanceUsd() : Promise.resolve(null),
  ]);
  return (
    <Studio
      graphId={graph.id}
      graphName={graph.name}
      initialDoc={graph.doc}
      initialState={await graphState(graph.id)}
      providerMode={providerMode()}
      fx={fx}
      blockedVendors={blockedVendors()}
      account={{
        email: user.email, availableKop: available, reservedKop: reserved, payments: paymentsProvider(),
        admin, providerUsd,
      }}
    />
  );
}
