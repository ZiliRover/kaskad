import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { BRAND } from "@/config/brand";
import { currentUser } from "@/server/auth";
import { WELCOME_BONUS_KOP } from "@/server/billing";

export const metadata: Metadata = { title: `Вход · ${BRAND.name}` };

export default async function LoginPage() {
  await connection();
  if (await currentUser()) redirect("/studio");
  return <LoginForm bonusKop={WELCOME_BONUS_KOP} />;
}
