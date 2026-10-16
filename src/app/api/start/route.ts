import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { createProject } from "@/server/graphs";

const TASKS = {
  director: { from: "empty", name: "Ролик по идее", open: "director" },
  animate: { from: "animate", name: "Оживить фото", open: null },
  empty: { from: "empty", name: "Новый проект", open: null },
} as const;

/** Relative: the server's own URL may say "localhost" behind a proxy or in the desktop app. */
const go = (to: string) => new NextResponse(null, { status: 303, headers: { Location: to } });

/** A task from the start screen: a fresh project set up for it (plain form post, no script needed). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return go("/login");
  const form = await req.formData().catch(() => null);
  const task = TASKS[String(form?.get("task")) as keyof typeof TASKS];
  if (!task) return go("/studio");
  const project = await createProject(user.id, { name: task.name, from: task.from });
  if (!project) return go("/studio");
  return go(`/studio/${project.id}${task.open ? `?open=${task.open}` : ""}`);
}
