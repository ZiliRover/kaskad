import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { recordUpload } from "@/server/media";
import { fileUrl, newKey, putFile } from "@/server/storage";

const MB = 1024 * 1024;
/** what a user can bring onto the canvas, and how big */
const ACCEPTED: Record<string, { kind: "image" | "video" | "audio"; max: number }> = {
  "image/png": { kind: "image", max: 20 * MB },
  "image/jpeg": { kind: "image", max: 20 * MB },
  "image/webp": { kind: "image", max: 20 * MB },
  "video/mp4": { kind: "video", max: 50 * MB },
  "video/webm": { kind: "video", max: 50 * MB },
  "audio/mpeg": { kind: "audio", max: 20 * MB },
  "audio/wav": { kind: "audio", max: 20 * MB },
  "audio/x-wav": { kind: "audio", max: 20 * MB },
  "audio/mp4": { kind: "audio", max: 20 * MB },
  "audio/x-m4a": { kind: "audio", max: 20 * MB },
  "audio/ogg": { kind: "audio", max: 20 * MB },
};
const LIMIT_TEXT = { image: "20 МБ", video: "50 МБ", audio: "20 МБ" };

export async function POST(req: Request) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  // reject oversized bodies before buffering them (multipart adds a little overhead)
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > 50 * MB + 64 * 1024) {
    return NextResponse.json({ error: "Файл больше 50 МБ" }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Файл не получен" }, { status: 400 });
  const rule = ACCEPTED[file.type];
  if (!rule) {
    return NextResponse.json({ error: "Поддерживаются картинки (PNG, JPEG, WebP), видео (MP4, WebM) и аудио (MP3, WAV, M4A, OGG)" }, { status: 415 });
  }
  if (file.size > rule.max) {
    return NextResponse.json({ error: `Файл больше ${LIMIT_TEXT[rule.kind]}` }, { status: 413 });
  }

  const key = newKey(`uploads/${user.id}`, file.type);
  await putFile(key, new Uint8Array(await file.arrayBuffer()));
  await recordUpload(user.id, key, file.name, rule.kind);
  return NextResponse.json({ key, url: fileUrl(key), kind: rule.kind });
}
