import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { createProject } from "@/server/graphs";

const TASKS = {
  director: { from: "empty", name: "Ролик по идее", open: "director" },
  animate: { from: "animate", name: "Оживить фото", open: null },
  empty: { from: "empty", name: "Новый проект", open: null },
} as const;

/** A task from the start screen: a fresh project set up for it (plain form post, no script needed). */
export async function POST(req: Request) {
  const user = await currentUser();
  const base = new URL(req.url);
  if (!user) return NextResponse.redirect(new URL("/login", base), 303);
  const form = await req.formData().catch(() => null);
  const task = TASKS[String(form?.get("task")) as keyof typeof TASKS];
  if (!task) return NextResponse.redirect(new URL("/studio", base), 303);
  const project = await createProject(user.id, { name: task.name, from: task.from });
  if (!project) return NextResponse.redirect(new URL("/studio", base), 303);
  return NextResponse.redirect(new URL(`/studio/${project.id}${task.open ? `?open=${task.open}` : ""}`, base), 303);
}
