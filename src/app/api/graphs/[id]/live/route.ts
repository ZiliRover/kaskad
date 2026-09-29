import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth";
import { publish, subscribe } from "@/server/live";
import { graphAccess } from "@/server/sharing";

type Ctx = { params: Promise<{ id: string }> };

/** The project's live stream (Server-Sent Events). */
export async function GET(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  if (!(await graphAccess(id, user.id))) return new Response("Not found", { status: 404 });
  const client = new URL(req.url).searchParams.get("client")?.slice(0, 64) ?? "";
  const enc = new TextEncoder();

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (data: string) => { try { ctrl.enqueue(enc.encode(data)); } catch { cleanup(); } };
      const unsubscribe = await subscribe(id, (msg) => {
        if ("from" in msg && msg.from === client) return; // your own edits come back only as silence
        send(`data: ${JSON.stringify(msg)}\n\n`);
      });
      const ping = setInterval(() => send(": ping\n\n"), 20_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
        void publish(id, { t: "leave", from: client }).catch(() => {});
        try { ctrl.close(); } catch { /* already closed */ }
      };
      req.signal.addEventListener("abort", () => cleanup());
      send(": open\n\n");
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}

const presence = z.object({
  client: z.string().min(1).max(64),
  cursor: z.object({ x: z.number(), y: z.number() }).nullable(),
  selection: z.array(z.string().max(64)).max(50),
});

// cursor updates come several times a second: remember recent access checks
const allowed = new Map<string, number>();

/** Where I am on the canvas: sent every few seconds and on cursor moves. */
export async function POST(req: Request, { params }: Ctx) {
  const { user, deny } = await requireUser();
  if (deny) return deny;
  const { id } = await params;
  const parsed = presence.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  const key = `${user.id}:${id}`;
  if ((allowed.get(key) ?? 0) < Date.now() - 30_000) {
    if (!(await graphAccess(id, user.id))) return NextResponse.json({ ok: false }, { status: 404 });
    allowed.set(key, Date.now());
  }
  await publish(id, { t: "presence", from: parsed.data.client, user: { id: user.id, email: user.email }, cursor: parsed.data.cursor, selection: parsed.data.selection });
  return NextResponse.json({ ok: true });
}
