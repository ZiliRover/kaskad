import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { TestCheckout } from "@/components/auth/TestCheckout";
import { BRAND } from "@/config/brand";
import { currentUser } from "@/server/auth";
import { getPayment } from "@/server/payments";

export const metadata: Metadata = { title: `Тестовая оплата · ${BRAND.name}` };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stand-in for the bank's page while PAYMENTS_PROVIDER=test. No money moves. */
export default async function TestPayPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const p = UUID.test(id) ? await getPayment(id, user.id) : null;
  if (!p || p.provider !== "test") notFound();
  if (p.status !== "pending") redirect(`/studio?payment=${p.id}`);
  return <TestCheckout id={p.id} amountKop={p.amountKop} email={user.email} />;
}
