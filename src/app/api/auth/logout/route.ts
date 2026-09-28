import { NextResponse } from "next/server";
import { endSession } from "@/server/auth";

export async function POST() {
  await endSession();
  return NextResponse.json({ ok: true });
}
