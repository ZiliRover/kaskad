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

/** The file really is what the browser says it is: checked by its first bytes. */
function looksLike(mime: string, b: Uint8Array): boolean {
  const ascii = (at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
  switch (mime) {
    case "image/png": return b[0] === 0x89 && ascii(1, "PNG");
    case "image/jpeg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/webp": return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "video/mp4": case "audio/mp4": case "audio/x-m4a": return ascii(4, "ftyp");
    case "video/webm": return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    case "audio/mpeg": return ascii(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
    case "audio/wav": case "audio/x-wav": return ascii(0, "RIFF") && ascii(8, "WAVE");
    case "audio/ogg": return ascii(0, "OggS");
    default: return false;
  }
}

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

  const data = new Uint8Array(await file.arrayBuffer());
  if (!looksLike(file.type, data)) {
    return NextResponse.json({ error: "Файл повреждён или это не тот формат, что указан в названии" }, { status: 415 });
  }
  const key = newKey(`uploads/${user.id}`, file.type);
  await putFile(key, data);
  await recordUpload(user.id, key, file.name, rule.kind);
  return NextResponse.json({ key, url: fileUrl(key), kind: rule.kind });
}
