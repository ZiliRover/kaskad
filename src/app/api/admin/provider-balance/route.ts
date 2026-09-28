import { NextResponse } from "next/server";
import { isAdmin } from "@/server/admin";
import { requireUser } from "@/server/auth";
import { accountBalanceUsd } from "@/server/providers/openrouter";

export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  if (!isAdmin(user)) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ usd: await accountBalanceUsd() });
}
