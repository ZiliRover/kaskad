import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Showcase } from "@/components/app/Showcase";
import { BRAND } from "@/config/brand";
import { listShowcase } from "@/server/apps";
import { currentUser } from "@/server/auth";

export const metadata: Metadata = { title: `Витрина · ${BRAND.name}` };

export default async function ShowcasePage() {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/login?next=/showcase");
  return <Showcase initial={await listShowcase(user.id, "top", "")} />;
}
