import { subscribe, type InboxEvent } from "@/lib/realtime";
import { getUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events: หน้าจอเปิด EventSource("/api/events") เพื่อรับข้อความใหม่แบบ realtime
export async function GET(req: Request) {
  if (!(await getUser())) return new Response("unauthorized", { status: 401 });
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (ev: InboxEvent | { type: "ping" }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const unsub = subscribe(send);
      const ping = setInterval(() => send({ type: "ping" }), 25_000);
      cleanup = () => {
        clearInterval(ping);
        unsub();
      };
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
      send({ type: "ping" });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
