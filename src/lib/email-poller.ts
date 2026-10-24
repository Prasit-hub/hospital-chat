import type { Channel } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { credsOf } from "@/lib/channels";
import { emailState, fetchNewEmails, type EmailCreds } from "@/lib/channels/email";
import { ingest } from "@/lib/inbox/service";
import { publish } from "@/lib/realtime";

// ตรวจกล่องจดหมายของช่องทางอีเมลทุกช่อง (เรียกเป็นรอบจาก src/instrumentation-node.ts)

const running = new Set<string>();

export async function pollEmailChannel(channel: Channel) {
  if (running.has(channel.id)) return { skipped: true, received: 0 };
  running.add(channel.id);
  const state = emailState(channel);
  try {
    const { events, state: next } = await fetchNewEmails(credsOf<EmailCreds>(channel), state);
    for (const ev of events) {
      try {
        await ingest(channel, ev);
      } catch (e) {
        console.error("[email] ingest failed", e);
      }
    }
    const hadError = !!state.lastError;
    await prisma.channel.update({
      where: { id: channel.id },
      data: { state: { ...next, lastPolledAt: new Date().toISOString(), lastError: null } },
    });
    if (hadError) publish({ type: "conversation", conversationId: "" });
    return { skipped: false, received: events.length };
  } catch (e) {
    const msg = (e as Error).message?.slice(0, 300) ?? String(e);
    console.warn("[email] poll failed", channel.externalId, msg);
    await prisma.channel.update({
      where: { id: channel.id },
      data: { state: { ...state, lastPolledAt: new Date().toISOString(), lastError: msg } },
    });
    throw e;
  } finally {
    running.delete(channel.id);
  }
}

export async function pollAllEmailChannels() {
  const channels = await prisma.channel.findMany({ where: { type: "email", connected: true } });
  for (const c of channels) await pollEmailChannel(c).catch(() => {});
}
