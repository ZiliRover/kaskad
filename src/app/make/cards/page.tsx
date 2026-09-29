import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { CardsMaker } from "@/components/app/CardsMaker";
import { BRAND } from "@/config/brand";
import { isAdmin } from "@/server/admin";
import { currentUser } from "@/server/auth";
import { balanceKop } from "@/server/billing";
import { cardsProgress } from "@/server/cards";
import { getFx } from "@/server/fx";
import { slidePriceUsd } from "@/server/seller";

export const metadata: Metadata = { title: `Карточки для маркетплейса · ${BRAND.name}` };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CardsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/login?next=/make/cards");
  const admin = isAdmin(user);
  const { project } = await searchParams;
  const [fx, balance, progress] = await Promise.all([
    getFx(), balanceKop(user.id),
    project && UUID.test(project) ? cardsProgress(project, user.id) : Promise.resolve(null),
  ]);
  return (
    <CardsMaker
      // operators see what the provider actually charges
      fx={admin ? { ...fx, markup: 1 } : fx}
      balanceKop={admin ? null : balance}
      slideUsd={slidePriceUsd().usd}
      initial={progress && project ? { graphId: project, progress } : null}
    />
  );
}
