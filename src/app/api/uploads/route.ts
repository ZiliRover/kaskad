import { NextResponse } from "next/server";
import { fileUrl, newKey, putFile } from "@/server/storage";

const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: Request) {
  // reject oversized bodies before buffering them (multipart adds a little overhead)
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Файл больше 20 МБ" }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не получен" }, { status: 400 });
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "Поддерживаются PNG, JPEG и WebP" }, { status: 415 });
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Файл больше 20 МБ" }, { status: 413 });

  const key = newKey("uploads", file.type);
  await putFile(key, new Uint8Array(await file.arrayBuffer()));
  return NextResponse.json({ key, url: fileUrl(key) });
}
