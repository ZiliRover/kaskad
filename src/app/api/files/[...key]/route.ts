import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { canReadFile } from "@/server/access";
import { currentUser } from "@/server/auth";
import { checkSignature, isValidKey, mimeForKey, statStored, storagePath } from "@/server/storage";

// Files never change under their random key, but they are personal: browser cache only.
const CACHE = "private, max-age=31536000, immutable";

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!isValidKey(key)) return new Response("Not found", { status: 404 });
  // provider links carry a signature; everyone else must be the file's owner
  const q = new URL(req.url).searchParams;
  if (q.has("sig") || q.has("exp")) {
    if (!checkSignature(key, q.get("exp"), q.get("sig"))) return new Response("Link expired", { status: 403 });
  } else {
    const user = await currentUser();
    // someone else's file is indistinguishable from a missing one
    if (!user || !(await canReadFile(key, user.id))) return new Response("Not found", { status: 404 });
  }
  const st = await statStored(key);
  if (!st) return new Response("Not found", { status: 404 });

  const type = mimeForKey(key);
  const download = new URL(req.url).searchParams.has("download");
  const base: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": CACHE,
    "Accept-Ranges": "bytes",
    // SVG from generators is served inert
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) base["Content-Disposition"] = `attachment; filename="${key.split("/").pop()}"`;

  // range requests: video seeking
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (!(start >= 0 && start <= end)) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${st.size}` } });
    }
    const stream = Readable.toWeb(createReadStream(storagePath(key), { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const stream = Readable.toWeb(createReadStream(storagePath(key))) as ReadableStream;
  return new Response(stream, { headers: { ...base, "Content-Length": String(st.size) } });
}
