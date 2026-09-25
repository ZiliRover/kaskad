"use client";

export type UploadKind = "image" | "video" | "audio";

const ACCEPT_MIME = [
  "image/png", "image/jpeg", "image/webp",
  "video/mp4", "video/webm",
  "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/ogg",
];

/** `accept` attribute for file inputs */
export const ACCEPT_ATTR = ACCEPT_MIME.join(",");

export async function uploadFile(file: File): Promise<{ key: string; url: string; kind: UploadKind }> {
  if (!ACCEPT_MIME.includes(file.type)) {
    throw new Error("Подходят картинки (PNG, JPEG, WebP), видео (MP4, WebM) и аудио (MP3, WAV, M4A, OGG)");
  }
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/uploads", { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Не удалось загрузить файл");
  return data;
}

export const fileUrl = (key: string) => `/api/files/${key}`;

/** Media files from a drop or paste, in order. */
export function mediaFiles(list: FileList | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list).filter((f) => /^(image|video|audio)\//.test(f.type));
}
