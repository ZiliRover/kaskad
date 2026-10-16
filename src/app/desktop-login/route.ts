import { NextResponse } from "next/server";
import { DESKTOP_COOKIE, desktopTokenOk, isDesktop } from "@/server/desktop";

/**
 * The desktop launcher opens the browser here with its secret token; the token becomes a
 * cookie for this local address, so bookmarks keep working while the app runs.
 * Redirects are relative: the server's own idea of its URL says "localhost", and a cookie
 * set for 127.0.0.1 would not follow the browser there.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!isDesktop() || !desktopTokenOk(token)) return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  const res = new NextResponse(null, { status: 303, headers: { Location: "/studio" } });
  res.cookies.set(DESKTOP_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400,
  });
  return res;
}
