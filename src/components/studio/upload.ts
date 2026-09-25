"use client";

const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];

export async function uploadImage(file: File): Promise<{ key: string; url: string }> {
  if (!ACCEPTED.includes(file.type)) throw new Error("Поддерживаются PNG, JPEG и WebP");
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api/uploads", { method: "POST", body: form });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? "Не удалось загрузить файл");
  return data;
}

export const fileUrl = (key: string) => `/api/files/${key}`;

export function firstImageFile(list: FileList | null | undefined): File | null {
  if (!list) return null;
  for (const f of Array.from(list)) if (f.type.startsWith("image/")) return f;
  return null;
}
