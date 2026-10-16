/**
 * The desktop app (desktop/main.ts) runs this same server on 127.0.0.1 for one person:
 * no sign-in, their own OpenRouter key, prices as the provider charges them.
 *
 * The launcher opens the browser at /desktop-login with a secret token from the person's
 * profile; it becomes a cookie for this local address. Other programs, other devices and web
 * pages can't present it (lax cookie, 127.0.0.1 only), so they can't spend the owner's key.
 */
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, users, type UserRow } from "./db";
import { desktopKey } from "./desktop-key";

export const DESKTOP_COOKIE = "kaskad_desktop";

export const isDesktop = () => process.env.KASKAD_DESKTOP === "1";

/** The one account of a desktop install; it is also in ADMIN_EMAILS (no balance limit). */
export const desktopEmail = () => process.env.KASKAD_DESKTOP_EMAIL?.trim() || "owner@kaskad.local";

export function desktopTokenOk(token: string | undefined): boolean {
  const want = process.env.KASKAD_DESKTOP_TOKEN ?? "";
  if (!token || want.length < 32) return false;
  const a = Buffer.from(token), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function desktopUser(): Promise<UserRow> {
  const email = desktopEmail();
  const [found] = await db.select().from(users).where(eq(users.email, email));
  if (found) return found;
  await db.insert(users).values({ email }).onConflictDoNothing();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
}

/** Pages that generate: without a key nothing works, so the desktop app asks for it first. */
export function requireDesktopKey() {
  if (isDesktop() && !desktopKey()) redirect("/setup");
}
