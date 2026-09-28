import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { BRAND } from "@/config/brand";
import { currentUser } from "@/server/auth";
import { WELCOME_BONUS_KOP } from "@/server/billing";

export const metadata: Metadata = { title: `Вход · ${BRAND.name}` };

/** Only same-site paths: a login link must not be able to send people elsewhere. */
function safeNext(raw: string | string[] | undefined): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") ? v : "/studio";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const next = safeNext((await searchParams).next);
  if (await currentUser()) redirect(next);
  return <LoginForm bonusKop={WELCOME_BONUS_KOP} next={next} />;
}
