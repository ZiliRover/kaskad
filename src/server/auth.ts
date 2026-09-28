/**
 * Passwordless sign-in: a 6-digit code by email, then an opaque session cookie.
 * Only hashes of codes and session tokens are stored.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cache } from "react";
import { grantWelcomeBonus } from "./billing";
import { db, loginCodes, sessions, users, type UserRow } from "./db";
import { mailConfigured, sendLoginCode } from "./mail";

export const SESSION_COOKIE = "kaskad_session";
const SESSION_DAYS = 30;
const CODE_TTL_MIN = 10;
const CODE_ATTEMPTS = 5;
const CODES_PER_HOUR = 5;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const codeHash = (email: string, code: string) => sha256(`${email}:${code}:${process.env.FILE_URL_SECRET ?? process.env.DATABASE_URL ?? ""}`);

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254 ? email : null;
}

export type RequestCodeResult = { ok: true; devCode?: string } | { ok: false; error: string; status: number };

export async function requestCode(email: string): Promise<RequestCodeResult> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(loginCodes)
    .where(and(eq(loginCodes.email, email), gt(loginCodes.createdAt, sql`now() - interval '1 hour'`)));
  if (n >= CODES_PER_HOUR) return { ok: false, status: 429, error: "Слишком много кодов за час. Попробуйте позже." };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginCodes).values({
    email, codeHash: codeHash(email, code), expiresAt: sql`now() + make_interval(mins => ${CODE_TTL_MIN})`,
  });
  try {
    await sendLoginCode(email, code);
  } catch (e) {
    console.error("[mail] send failed:", (e as Error).message);
    return { ok: false, status: 502, error: "Не удалось отправить письмо. Попробуйте ещё раз." };
  }
  // local development without SMTP: hand the code back so the form can show it
  const dev = process.env.NODE_ENV !== "production" && !mailConfigured();
  return dev ? { ok: true, devCode: code } : { ok: true };
}

export type VerifyResult = { ok: true; user: UserRow; isNew: boolean } | { ok: false; error: string; status: number };

export async function verifyCode(email: string, code: string): Promise<VerifyResult> {
  const [row] = await db.select().from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.usedAt), gt(loginCodes.expiresAt, sql`now()`)))
    .orderBy(desc(loginCodes.createdAt)).limit(1);
  if (!row) return { ok: false, status: 400, error: "Код устарел. Запросите новый." };
  if (row.attempts >= CODE_ATTEMPTS) return { ok: false, status: 429, error: "Слишком много попыток. Запросите новый код." };

  const a = Buffer.from(row.codeHash), b = Buffer.from(codeHash(email, code.trim()));
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await db.update(loginCodes).set({ attempts: sql`${loginCodes.attempts} + 1` }).where(eq(loginCodes.id, row.id));
    const left = CODE_ATTEMPTS - row.attempts - 1;
    return { ok: false, status: 400, error: left > 0 ? `Неверный код. Осталось попыток: ${left}` : "Неверный код. Запросите новый." };
  }

  return db.transaction(async (tx) => {
    const used = await tx.update(loginCodes).set({ usedAt: sql`now()` })
      .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.usedAt))).returning({ id: loginCodes.id });
    if (!used.length) return { ok: false as const, status: 400, error: "Код уже использован. Запросите новый." };

    const [existing] = await tx.select().from(users).where(eq(users.email, email));
    if (existing) return { ok: true as const, user: existing, isNew: false };

    // serialize sign-ups: the very first account adopts the canvases made before accounts existed
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kaskad:signup'))`);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    const [user] = await tx.insert(users).values({ email }).onConflictDoNothing().returning();
    if (!user) return { ok: true as const, user: (await tx.select().from(users).where(eq(users.email, email)))[0], isNew: false };
    if (n === 0) {
      await tx.execute(sql`update graphs set owner_id = ${user.id} where owner_id is null`);
      await tx.execute(sql`update jobs set user_id = ${user.id} where user_id is null`);
    }
    await grantWelcomeBonus(tx, user.id);
    return { ok: true as const, user, isNew: true };
  });
}

export async function startSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ id: sha256(token), userId, expiresAt: expires });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", path: "/", expires,
    secure: process.env.NODE_ENV === "production",
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. Memoized per request. */
export const currentUser = cache(async (): Promise<UserRow | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const [row] = await db.select({ user: users }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256(token)), gt(sessions.expiresAt, sql`now()`)));
  return row?.user ?? null;
});

/** For route handlers: the user, or a ready 401 response. */
export async function requireUser(): Promise<{ user: UserRow; deny?: never } | { user?: never; deny: NextResponse }> {
  const user = await currentUser();
  if (user) return { user };
  return { deny: NextResponse.json({ error: "Войдите, чтобы продолжить", code: "auth" }, { status: 401 }) };
}
