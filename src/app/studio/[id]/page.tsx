import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Studio } from "@/components/studio/Studio";
import { isAdmin } from "@/server/admin";
import { currentUser } from "@/server/auth";
import { balanceKop, reservedKop } from "@/server/billing";
import { getFx } from "@/server/fx";
import { graphState, listProjects } from "@/server/graphs";
import { acceptInvites, graphAccess } from "@/server/sharing";
import { paymentsProvider } from "@/server/payments";
import { blockedVendors, providerMode } from "@/server/providers";
import { accountBalanceUsd } from "@/server/providers/openrouter";

export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  await connection(); // per-request: reads the session and the database
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const admin = isAdmin(user);
  await acceptInvites(user.id, user.email);
  const [access, fx, available, reserved, providerUsd, projects] = await Promise.all([
    graphAccess(id, user.id), getFx(), balanceKop(user.id), reservedKop(user.id),
    admin ? accountBalanceUsd() : Promise.resolve(null),
    listProjects(user.id),
  ]);
  if (!access) notFound(); // someone else's canvas looks exactly like a missing one
  const graph = access.graph;
  return (
    <Studio
      graphId={graph.id}
      graphName={graph.name}
      initialDoc={graph.doc}
      initialState={await graphState(graph.id)}
      providerMode={providerMode()}
      // operators see what the provider actually charges; users see their price with the markup
      fx={admin ? { ...fx, markup: 1 } : fx}
      blockedVendors={blockedVendors()}
      projects={projects}
      role={access.role}
      me={{ id: user.id, email: user.email }}
      account={{
        email: user.email, availableKop: available, reservedKop: reserved, payments: paymentsProvider(),
        admin, providerUsd,
      }}
    />
  );
}
