import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { createItem, libraryInput, LibraryError, listLibrary } from "@/server/library";

export async function GET() {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  return NextResponse.json(await listLibrary(user.id));
}

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const parsed = libraryInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Нужны название и хотя бы описание или фото" }, { status: 400 });
  try {
    return NextResponse.json(await createItem(user.id, parsed.data));
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
