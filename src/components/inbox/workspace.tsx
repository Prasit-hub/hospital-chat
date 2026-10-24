"use client";

import { createContext, useContext } from "react";
import type { Agent, Channel, Department, ProfileTagDef, QuickReply, Tag } from "@/lib/types";

export interface Workspace {
  meId: string;
  channels: Channel[];
  agents: Agent[];
  tags: Tag[];
  quickReplies: QuickReply[];
  departments: Department[];
  me: { departmentId?: string; role: "owner" | "admin" | "agent" };
  profileTagDefs: ProfileTagDef[];
  his: { mode: "manual" | "mock" | "live"; allowNationalId: boolean };
  caseSettings: { autoCloseDays: number; reopenDays: number; transferSla: { normal: number; urgent: number; escalateNormal: number; escalateUrgent: number } };
}

const Ctx = createContext<Workspace | null>(null);

export const WorkspaceProvider = Ctx.Provider;

export function useWorkspace() {
  const ws = useContext(Ctx);
  if (!ws) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ws;
}

/** fetch JSON + โยน error ภาษาไทยจาก API */
export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (res.status === 401 && typeof window !== "undefined") {
    window.location.href = "/login?next=" + encodeURIComponent(window.location.pathname);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 502 && data?.status === "failed")) {
    throw Object.assign(new Error(data?.error ?? `เกิดข้อผิดพลาด (${res.status})`), { status: res.status, data });
  }
  return data as T;
}
