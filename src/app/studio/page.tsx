import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentUser } from "@/server/auth";
import { userGraph } from "@/server/graphs";
import { acceptInvites } from "@/server/sharing";

/** /studio opens the canvas the user edited last (created on the first visit). */
export default async function StudioIndex({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const user = await currentUser();
  if (!user) redirect("/login");
  await acceptInvites(user.id, user.email);
  const graph = await userGraph(user.id);
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) if (typeof v === "string") q.set(k, v);
  redirect(`/studio/${graph.id}${q.size ? `?${q}` : ""}`);
}
