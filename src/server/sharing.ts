/**
 * Shared projects. The owner (graphs.owner_id) can invite people by email as editors
 * (change and run, paying for their own runs) or viewers (look only). Invites for
 * emails without an account wait in graph_invites and turn into memberships on sign-in.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Member, Role } from "@/lib/sharing";
import { db, graphInvites, graphMembers, graphs, users, type GraphRow } from "./db";

export type { Member, Role };

/** A graph and what this user may do with it; null when they may not see it at all. */
export async function graphAccess(graphId: string, userId: string): Promise<{ graph: GraphRow; role: Role } | null> {
  const [g] = await db.select().from(graphs).where(eq(graphs.id, graphId));
  if (!g) return null;
  if (g.ownerId === userId) return { graph: g, role: "owner" };
  const [m] = await db.select({ role: graphMembers.role }).from(graphMembers)
    .where(and(eq(graphMembers.graphId, graphId), eq(graphMembers.userId, userId)));
  return m ? { graph: g, role: m.role as Role } : null;
}

export const canEdit = (role: Role | undefined) => role === "owner" || role === "editor";

/** Turn waiting invitations for this email into memberships. */
export async function acceptInvites(userId: string, email: string) {
  const pending = await db.select().from(graphInvites).where(eq(graphInvites.email, email));
  for (const inv of pending) {
    await db.insert(graphMembers).values({ graphId: inv.graphId, userId, role: inv.role }).onConflictDoNothing();
  }
  if (pending.length) await db.delete(graphInvites).where(eq(graphInvites.email, email));
}

export async function listMembers(graphId: string): Promise<Member[]> {
  const rows = await db.execute<{ user_id: string | null; email: string; role: string; pending: boolean }>(sql`
    select u.id as user_id, u.email, 'owner' as role, false as pending from graphs g join users u on u.id::text = g.owner_id where g.id = ${graphId}
    union all
    select u.id, u.email, m.role, false from graph_members m join users u on u.id = m.user_id where m.graph_id = ${graphId}
    union all
    select null, i.email, i.role, true from graph_invites i where i.graph_id = ${graphId}
  `);
  return rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role as Role, pending: r.pending }));
}

export async function invite(graphId: string, email: string, role: "editor" | "viewer"): Promise<"member" | "invited" | "owner"> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  const [g] = await db.select({ ownerId: graphs.ownerId }).from(graphs).where(eq(graphs.id, graphId));
  if (u && g?.ownerId === u.id) return "owner";
  if (u) {
    await db.insert(graphMembers).values({ graphId, userId: u.id, role })
      .onConflictDoUpdate({ target: [graphMembers.graphId, graphMembers.userId], set: { role } });
    return "member";
  }
  await db.insert(graphInvites).values({ graphId, email, role })
    .onConflictDoUpdate({ target: [graphInvites.graphId, graphInvites.email], set: { role } });
  return "invited";
}

export async function removeMember(graphId: string, who: { userId?: string; email?: string }) {
  if (who.userId) await db.delete(graphMembers).where(and(eq(graphMembers.graphId, graphId), eq(graphMembers.userId, who.userId)));
  if (who.email) await db.delete(graphInvites).where(and(eq(graphInvites.graphId, graphId), eq(graphInvites.email, who.email)));
}

/** Two people work on at least one project together (they may see each other's uploads used there). */
export async function shareAProject(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const [r] = await db.execute<{ ok: boolean }>(sql`
    with access as (
      select id as graph_id, owner_id::text as user_id from graphs where owner_id in (${a}, ${b})
      union all
      select graph_id, user_id::text from graph_members where user_id::text in (${a}, ${b})
    )
    select exists (
      select 1 from access x join access y on x.graph_id = y.graph_id where x.user_id = ${a} and y.user_id = ${b}
    ) as ok
  `);
  return !!r?.ok;
}
