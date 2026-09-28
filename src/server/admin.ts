import type { UserRow } from "./db";

/**
 * Operators of the service: see what the provider account holds, etc.
 * ADMIN_EMAILS="a@x.ru,b@y.ru". Unset outside production, whoever runs it locally is the operator.
 */
export function isAdmin(user: Pick<UserRow, "email">): boolean {
  const list = process.env.ADMIN_EMAILS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  if (!list.length) return process.env.NODE_ENV !== "production";
  return list.includes(user.email);
}
