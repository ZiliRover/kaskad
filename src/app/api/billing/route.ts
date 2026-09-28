import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { balanceKop, history, reservedKop } from "@/server/billing";

/** Available balance (holds already subtracted), what running jobs reserve, and history. */
export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const [balance, reserved, entries] = await Promise.all([balanceKop(user.id), reservedKop(user.id), history(user.id)]);
  return NextResponse.json({ balanceKop: balance, reservedKop: reserved, history: entries });
}
