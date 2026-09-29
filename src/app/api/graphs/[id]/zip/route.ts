import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { latestRunFiles, ownedGraph } from "@/server/graphs";
import { readStored } from "@/server/storage";
import { zip } from "@/server/zip";

/** Everything a node made in its latest run (variants or batch items) as one archive. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const node = new URL(req.url).searchParams.get("node") ?? "";
  const graph = node && node.length <= 64 ? await ownedGraph(id, user.id) : null;
  if (!graph) return NextResponse.json({ error: "Не найдено" }, { status: 404 });
  const files = await latestRunFiles(id, node);
  if (!files.length) return NextResponse.json({ error: "У ноды ещё нет результатов" }, { status: 404 });
  const width = String(files.length).length;
  const data = zip(await Promise.all(files.map(async (key, i) => ({
    name: `${String(i + 1).padStart(width, "0")}.${key.split(".").pop()}`,
    data: new Uint8Array(await readStored(key)),
  }))));
  const name = encodeURIComponent(`${graph.name}.zip`);
  return new Response(Buffer.from(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="results.zip"; filename*=UTF-8''${name}`,
      "Cache-Control": "private, no-store",
    },
  });
}
