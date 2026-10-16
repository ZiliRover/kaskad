import type { UserRow } from "./db";

/**
 * Operators of the service, listed in ADMIN_EMAILS="a@x.ru,b@y.ru". They run generations
 * without a balance limit (the provider account is theirs anyway) and see what is left on it.
 * Nobody else ever sees the provider balance.
 */
export function isAdmin(user: Pick<UserRow, "email">): boolean {
  // the desktop app's only person pays the provider directly: no site balance to limit
  if (process.env.KASKAD_DESKTOP === "1") return true;
  const list = process.env.ADMIN_EMAILS?.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) ?? [];
  return list.includes(user.email.toLowerCase());
}
