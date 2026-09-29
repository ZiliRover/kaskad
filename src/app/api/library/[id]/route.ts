import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { deleteItem, libraryInput, LibraryError, updateItem } from "@/server/library";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const parsed = libraryInput.safeParse(await req.json().catch(() => null));
  if (!UUID.test(id) || !parsed.success) return NextResponse.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const item = await updateItem(id, user.id, parsed.data);
    return item ? NextResponse.json(item) : NextResponse.json({ error: "Не найдено" }, { status: 404 });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!UUID.test(id) || !(await deleteItem(id, user.id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
