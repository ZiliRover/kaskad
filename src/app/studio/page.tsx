import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Home } from "@/components/app/Home";
import { toKop } from "@/lib/money";
import { isAdmin } from "@/server/admin";
import { currentUser } from "@/server/auth";
import { balanceKop } from "@/server/billing";
import { getFx } from "@/server/fx";
import { listProjects, userGraph } from "@/server/graphs";
import { slidePriceUsd } from "@/server/seller";
import { acceptInvites } from "@/server/sharing";

/**
 * /studio is the start screen: pick a task or a recent project. With a query (back from
 * the checkout, "Пополнить" from other pages) it opens the canvas edited last, which
 * handles it.
 */
export default async function StudioIndex({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/login");
  await acceptInvites(user.id, user.email);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  if (q.size) redirect(`/studio/${(await userGraph(user.id)).id}?${q}`);

  const admin = isAdmin(user);
  const [projects, balance, fx] = await Promise.all([listProjects(user.id), balanceKop(user.id), getFx()]);
  return (
    <Home
      projects={projects}
      balanceKop={admin ? null : balance}
      email={user.email}
      cardsKop={toKop(slidePriceUsd().usd * 7, admin ? { ...fx, markup: 1 } : fx)}
    />
  );
}
