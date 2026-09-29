import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AppRunner } from "@/components/app/AppRunner";
import { BRAND } from "@/config/brand";
import { isAdmin } from "@/server/admin";
import { appInfo, appPrice, getApp, likeState, runnerGraphId } from "@/server/apps";
import { currentUser } from "@/server/auth";
import { balanceKop } from "@/server/billing";
import { getFx } from "@/server/fx";
import { graphState } from "@/server/graphs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const app = UUID.test(id) ? await getApp(id) : null;
  return { title: app ? `${app.name} · ${BRAND.name}` : BRAND.name };
}

/** A published graph behind a form. Anyone signed in may run it, paying for their own runs. */
export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/app/${id}`);
  const app = UUID.test(id) ? await getApp(id) : null;
  if (!app) notFound();

  const admin = isAdmin(user);
  const [fx, balance, graphId, like] = await Promise.all([getFx(), balanceKop(user.id), runnerGraphId(app.id, user.id), likeState(app.id, user.id)]);
  return (
    <AppRunner
      app={appInfo(app)}
      price={appPrice(app)}
      fx={admin ? { ...fx, markup: 1 } : fx}
      balanceKop={admin ? null : balance}
      graphId={graphId}
      initialState={graphId ? await graphState(graphId) : {}}
      isOwner={app.ownerId === user.id}
      sourceGraphId={app.sourceGraphId}
      like={app.listed || app.ownerId === user.id ? like : null}
    />
  );
}
