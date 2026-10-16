import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { KeySetup } from "@/components/auth/KeySetup";
import { BRAND } from "@/config/brand";
import { currentUser } from "@/server/auth";
import { isDesktop } from "@/server/desktop";
import { desktopKey } from "@/server/desktop-key";

export const metadata: Metadata = { title: `Ключ OpenRouter · ${BRAND.name}` };

/** Desktop app only: where the person enters (or changes) their OpenRouter key. */
export default async function SetupPage() {
  await connection();
  if (!isDesktop()) notFound();
  if (!(await currentUser())) redirect("/login");
  return <KeySetup hasKey={!!desktopKey()} />;
}
