"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessagesSquare, X } from "lucide-react";
import type { Appointment, Case, ChannelType, Contact, Conversation, Message, Patient } from "@/lib/types";
import { cn, nowLocal } from "@/lib/utils";
import { CaseList, transferWait, useNow, waitingMinutes, type CaseRow, type Queue, type SortMode } from "./CaseList";
import { ChatWindow, type CasePatch, type SendPayload, type SimpleAction } from "./ChatWindow";
import { PatientPanel, type HistoryCase } from "./PatientPanel";
import { AppointmentModal, type AppointmentDraft } from "./AppointmentModal";
import { CloseDialog, ReasonDialog, TransferDialog } from "./CaseDialogs";
import type { AddTag } from "./ProfileTags";
import { MergeDialog } from "@/components/MergeDialog";
import { api, WorkspaceProvider, type Workspace } from "./workspace";

// หน้าแชทแบบ "งาน": รายการซ้าย = คิวงาน, กลาง = เส้นเวลาของคนไข้ทุกช่องทาง, ขวา = แฟ้มคนไข้

interface Bootstrap extends Workspace {
  cases: Case[];
  conversations: Conversation[];
  contacts: Contact[];
  patients: Patient[];
  appointments: Appointment[];
  duplicates: Record<string, number>;
}

interface Bundle {
  duplicates: Record<string, number>;
  patient: Patient;
  contacts: Contact[];
  conversations: Conversation[];
  appointments: Appointment[];
  case?: Case;
  requested?: Case;
}

type RealtimeEvent =
  | { type: "ping" }
  | { type: "message"; conversationId: string; messageId: string }
  | { type: "message_status"; conversationId: string; messageId: string; status: string }
  | { type: "conversation"; conversationId: string }
  | { type: "contact"; contactId: string }
  | { type: "patient"; patientId: string }
  | { type: "case"; caseId: string }
  | { type: "patients_changed" };

const upsert = <T extends { id: string }>(list: T[], item: T) =>
  list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];
const upsertMany = <T extends { id: string }>(list: T[], items: T[]) => items.reduce((l, x) => upsert(l, x), list);

type Dialog = { kind: "transfer" } | { kind: "close" } | { kind: "return" } | { kind: "apt" } | { kind: "merge"; base: string; other?: string } | null;

export function InboxView() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [cases, setCases] = useState<Case[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [duplicates, setDuplicates] = useState<Record<string, number>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [history, setHistory] = useState<HistoryCase[] | null>(null);

  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [replyConvId, setReplyConvId] = useState<string | undefined>();
  const selectedRef = useRef<string | undefined>(undefined);
  selectedRef.current = selectedId;
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(true);
  const [insertReply, setInsertReply] = useState<{ text: string; n: number }>();
  const [dialog, setDialog] = useState<Dialog>(null);

  const [queue, setQueue] = useState<Queue>("open");
  const [channelFilter, setChannelFilter] = useState<ChannelType | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const now = useNow();

  const fail = useCallback((e: unknown) => setToast(e instanceof Error ? e.message : String(e)), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (window.innerWidth < 1280) setInfoOpen(false);
  }, []);

  const applyBundle = useCallback((b: Bundle) => {
    setPatients((ps) => upsert(ps, b.patient));
    setContacts((cs) => upsertMany(cs, b.contacts));
    setConversations((cs) => upsertMany(cs, b.conversations));
    setAppointments((as) => [...as.filter((a) => a.patientId !== b.patient.id), ...b.appointments]);
    setDuplicates((d) => ({ ...d, ...b.duplicates }));
    setCases((cs) => upsertMany(cs, [b.case, b.requested].filter(Boolean) as Case[]));
  }, []);

  // ---------- โหลดข้อมูลตั้งต้น ----------
  const bootstrap = useCallback(async (first = false) => {
    const d = await api<Bootstrap>("/api/inbox");
    setWs({
      meId: d.meId,
      channels: d.channels,
      agents: d.agents,
      tags: d.tags,
      quickReplies: d.quickReplies,
      departments: d.departments,
      me: d.me,
      profileTagDefs: d.profileTagDefs,
      caseSettings: d.caseSettings,
      his: d.his ?? { mode: "manual", allowNationalId: false },
    });
    setCases(d.cases);
    setConversations(d.conversations);
    setContacts(d.contacts);
    setPatients(d.patients);
    setAppointments(d.appointments);
    setDuplicates(d.duplicates);
    if (!first) return d;
    // เปิดจาก ⌘K หรือหน้า คนไข้: /inbox?patient=<id>
    const wanted = new URLSearchParams(window.location.search).get("patient");
    const ofPatient = wanted ? d.cases.filter((c) => c.patientId === wanted).sort((a, b) => b.openedAt.localeCompare(a.openedAt)) : [];
    const pick = ofPatient.find((c) => c.status !== "closed") ?? ofPatient[0];
    if (pick) {
      setQueue(pick.status === "closed" ? "closed" : "open");
      setSelectedId(pick.id);
      setMobileChatOpen(true);
    } else if (window.innerWidth >= 768) {
      const open = d.cases.filter((c) => c.status !== "closed");
      setSelectedId((open.find((c) => c.urgent) ?? open[0])?.id);
    }
    return d;
  }, []);

  useEffect(() => {
    bootstrap(true).catch((e) => setLoadError(e.message));
  }, [bootstrap]);

  const selected = cases.find((c) => c.id === selectedId);
  const patient = selected ? patients.find((p) => p.id === selected.patientId) : undefined;
  const patientConvs = useMemo(
    () =>
      selected
        ? conversations
            .filter((c) => c.patientId === selected.patientId)
            .sort((a, b) => (b.lastCustomerMessageAt ?? b.lastMessageAt).localeCompare(a.lastCustomerMessageAt ?? a.lastMessageAt))
        : [],
    [selected, conversations],
  );

  // ห้องที่จะตอบ: ค่าเริ่มต้น = ห้องที่คนไข้ทักมาล่าสุด
  useEffect(() => {
    if (!patientConvs.length) return;
    if (!replyConvId || !patientConvs.some((c) => c.id === replyConvId)) setReplyConvId(patientConvs[0].id);
  }, [patientConvs, replyConvId]);

  const loadMessages = useCallback(
    async (convId: string, quiet = false) => {
      if (!quiet) setLoadingMessages(true);
      try {
        const ms = await api<Message[]>(`/api/conversations/${convId}/messages?scope=patient`);
        setMessages(ms);
      } catch (e) {
        fail(e);
      } finally {
        if (!quiet) setLoadingMessages(false);
      }
    },
    [fail],
  );

  const loadHistory = useCallback(
    async (patientId: string, view = false) => {
      try {
        setHistory(await api<HistoryCase[]>(`/api/patients/${patientId}/cases${view ? "?view=history" : ""}`));
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const markRead = useCallback((convs: Conversation[]) => {
    for (const c of convs.filter((x) => x.unread > 0)) {
      setConversations((cs) => cs.map((x) => (x.id === c.id ? { ...x, unread: 0 } : x)));
      api(`/api/conversations/${c.id}`, { method: "PATCH", json: { read: true } }).catch(() => {});
    }
  }, []);

  // ---------- เปิดงาน → โหลดเส้นเวลาของคนไข้ ----------
  const selectedPatientId = selected?.patientId;
  const firstConvId = patientConvs[0]?.id;
  useEffect(() => {
    if (!selectedPatientId || !firstConvId) return;
    setMessages([]);
    setHistory(null);
    loadMessages(firstConvId);
    loadHistory(selectedPatientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatientId]);
  useEffect(() => {
    if (selectedPatientId) markRead(patientConvs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPatientId, patientConvs.map((c) => c.unread).join()]);

  // ---------- realtime ----------
  const stateRef = useRef({ cases, conversations, selectedPatientId });
  stateRef.current = { cases, conversations, selectedPatientId };
  useEffect(() => {
    if (!ws) return;
    const es = new EventSource("/api/events");
    const touchesSelected = (patientId?: string) => patientId && patientId === stateRef.current.selectedPatientId;
    const refreshTimeline = () => {
      const pid = stateRef.current.selectedPatientId;
      const conv = stateRef.current.conversations.find((c) => c.patientId === pid);
      if (conv) loadMessages(conv.id, true);
      if (pid) loadHistory(pid);
    };
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data) as RealtimeEvent;
      if (ev.type === "ping" || ev.type === "contact") return;
      if (ev.type === "patients_changed") {
        bootstrap().then(refreshTimeline).catch(() => {});
        return;
      }
      if (ev.type === "patient") {
        api<Bundle>(`/api/patients/${ev.patientId}`)
          .then((b) => {
            setPatients((ps) => upsert(ps, b.patient));
            setContacts((cs) => upsertMany(cs, b.contacts));
            setAppointments((as) => [...as.filter((a) => a.patientId !== b.patient.id), ...b.appointments]);
          })
          .catch(() => {});
        return;
      }
      if (ev.type === "case") {
        api<Bundle>(`/api/cases/${ev.caseId}`)
          .then((b) => {
            applyBundle(b);
            if (touchesSelected(b.patient.id)) refreshTimeline();
          })
          .catch((e: Error & { status?: number }) => {
            // เห็นแชทตามแผนก: งานย้ายไปอยู่แผนกอื่นแล้ว → เอาออกจากรายการ
            if (e.status !== 403) return;
            setCases((cs) => cs.filter((c) => c.id !== ev.caseId));
            if (selectedRef.current === ev.caseId) {
              setSelectedId(undefined);
              setToast("งานนี้ย้ายไปอยู่ในความรับผิดชอบของแผนกอื่นแล้ว");
            }
          });
        return;
      }
      api<Bundle & { conversation: Conversation }>(`/api/conversations/${ev.conversationId}`)
        .then((b) => {
          applyBundle(b);
          if (touchesSelected(b.patient.id)) refreshTimeline();
        })
        .catch(() => {});
    };
    return () => es.close();
  }, [ws, bootstrap, applyBundle, loadMessages, loadHistory]);

  // ---------- คิวงาน ----------
  const rows: CaseRow[] = useMemo(() => {
    const out: CaseRow[] = [];
    for (const c of cases) {
      const pt = patients.find((p) => p.id === c.patientId);
      if (!pt) continue;
      const convs = conversations
        .filter((v) => v.patientId === c.patientId)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      if (!convs.length) continue;
      const contact = contacts.find((x) => x.id === convs[0].contactId);
      if (!contact) continue;
      const lastCust = convs.map((v) => v.lastCustomerMessageAt).filter(Boolean).sort().at(-1);
      out.push({
        case: c,
        patient: pt,
        conversations: convs,
        contact,
        unread: c.status === "closed" ? 0 : convs.reduce((a, v) => a + v.unread, 0),
        lastMessage: convs[0].lastMessage,
        lastMessageAt: convs[0].lastMessageAt,
        lastCustomerMessageAt: lastCust,
        channelTypes: [...new Set(convs.map((v) => ws?.channels.find((h) => h.id === v.channelId)?.type).filter(Boolean))] as ChannelType[],
      });
    }
    return out;
  }, [cases, patients, conversations, contacts, ws]);

  const meId = ws?.meId;
  const myDept = ws?.me.departmentId;
  const inQueue = useCallback(
    (r: CaseRow, q: Queue) => {
      const c = r.case;
      switch (q) {
        case "queued":
          return c.status === "queued";
        case "mine":
          return c.ownerId === meId && (c.status === "in_progress" || c.status === "waiting_patient");
        case "dept":
          return c.status === "transfer_pending" && !!myDept && c.pendingTransfer?.toDeptId === myDept;
        case "sent":
          return c.status === "transfer_pending" && c.pendingTransfer?.fromUserId === meId;
        case "waiting":
          return c.status === "waiting_patient";
        case "open":
          return c.status !== "closed";
        case "closed":
          return c.status === "closed";
      }
    },
    [meId, myDept],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => channelFilter === "all" || r.channelTypes.includes(channelFilter))
      .filter(
        (r) =>
          !q ||
          r.patient.name.toLowerCase().includes(q) ||
          (r.patient.hn ?? "").toLowerCase().includes(q) ||
          r.case.code.toLowerCase().includes(q) ||
          r.lastMessage.toLowerCase().includes(q),
      );
  }, [rows, channelFilter, query]);

  const visible = useMemo(
    () =>
      filtered
        .filter((r) => inQueue(r, queue) && (!urgentOnly || r.case.urgent))
        .sort((a, b) => {
          if (queue !== "closed") {
            const ua = a.case.urgent ? 1 : 0;
            const ub = b.case.urgent ? 1 : 0;
            if (ua !== ub) return ub - ua;
          }
          if (queue === "closed") return (b.case.closedAt ?? "").localeCompare(a.case.closedAt ?? "");
          if (sort === "waiting") {
            const wa = waitingMinutes(a, now) ?? -1;
            const wb = waitingMinutes(b, now) ?? -1;
            if (wa !== wb) return wb - wa;
          }
          return b.lastMessageAt.localeCompare(a.lastMessageAt);
        }),
    [filtered, inQueue, queue, urgentOnly, sort, now],
  );

  const counts = Object.fromEntries(
    (["queued", "mine", "dept", "sent", "waiting", "open", "closed"] as Queue[]).map((q) => [q, filtered.filter((r) => inQueue(r, q)).length]),
  ) as Record<Queue, number>;
  const overdueCount = ws
    ? filtered.filter((r) => inQueue(r, "dept") && transferWait(r.case, now, ws.caseSettings.transferSla, ws.departments.find((d) => d.id === myDept)?.slaMinutes)?.overdue).length
    : 0;
  const urgentCount = filtered.filter((r) => r.case.status !== "closed" && r.case.urgent && (queue === "closed" ? false : inQueue(r, queue))).length;

  const replyConv = patientConvs.find((c) => c.id === replyConvId) ?? patientConvs[0];
  const replyContact = replyConv ? contacts.find((c) => c.id === replyConv.contactId) : undefined;
  const replyChannel = replyConv ? ws?.channels.find((c) => c.id === replyConv.channelId) : undefined;
  const siblings = patientConvs
    .map((v) => ({ conversation: v, contact: contacts.find((c) => c.id === v.contactId), channel: ws?.channels.find((h) => h.id === v.channelId) }))
    .filter((x): x is { conversation: Conversation; contact: Contact; channel: NonNullable<typeof x.channel> } => !!x.contact && !!x.channel);

  const caseInfo = useMemo(() => {
    const m: Record<string, { code: string; status: Case["status"]; outcome?: Case["outcome"]; closedAt?: string }> = {};
    for (const c of [...(history ?? []), ...cases]) m[c.id] = { code: c.code, status: c.status, outcome: c.outcome, closedAt: c.closedAt };
    return m;
  }, [history, cases]);

  // ---------- การกระทำ ----------
  function select(id: string) {
    setSelectedId(id);
    setMobileChatOpen(true);
  }

  async function handleSend(payload: SendPayload) {
    if (!replyConv || !ws) return;
    const id = replyConv.id;
    const temp: Message = {
      id: `temp-${Date.now()}`,
      conversationId: id,
      caseId: selected?.status === "closed" ? undefined : selected?.id,
      from: "agent",
      agentId: ws.meId,
      kind: payload.kind,
      text: payload.kind === "image" ? "ส่งรูปภาพ" : payload.kind === "file" ? (payload.fileName ?? "ไฟล์แนบ") : payload.text,
      imageUrl: payload.kind === "image" ? payload.imageUrl : payload.kind === "file" ? payload.fileUrl : undefined,
      at: nowLocal(),
      status: payload.kind === "note" ? "sent" : "sending",
    };
    setMessages((ms) => [...ms, temp]);
    try {
      const m = await api<Message>(`/api/conversations/${id}/messages`, { method: "POST", json: payload });
      setMessages((ms) => upsert(ms.filter((x) => x.id !== temp.id), m).sort((a, b) => a.at.localeCompare(b.at)));
      if (m.status === "failed") setToast(m.error ?? "ส่งข้อความไม่สำเร็จ");
      // ตอบงานที่ปิดแล้ว → ระบบเปิดงานใหม่: ย้ายไปงานใหม่
      if (selected?.status === "closed" && m.caseId && m.caseId !== selected.id) {
        const b = await api<Bundle>(`/api/cases/${m.caseId}`);
        applyBundle(b);
        setSelectedId(m.caseId);
        setQueue("mine");
      }
    } catch (e) {
      setMessages((ms) => ms.map((x) => (x.id === temp.id ? { ...x, status: "failed", error: (e as Error).message } : x)));
    }
  }

  async function caseAction(body: Record<string, unknown>, okText?: string) {
    if (!selected) return false;
    try {
      const c = await api<Case>(`/api/cases/${selected.id}`, { method: "POST", json: body });
      setCases((cs) => upsert(cs, c));
      if (replyConv) loadMessages(replyConv.id, true);
      if (okText) setToast(okText);
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  }

  async function patchCase(patch: CasePatch) {
    if (!selected) return;
    try {
      const c = await api<Case>(`/api/cases/${selected.id}`, { method: "PATCH", json: patch });
      setCases((cs) => upsert(cs, c));
      if (replyConv) loadMessages(replyConv.id, true);
    } catch (e) {
      fail(e);
    }
  }

  async function patchPatient(patch: Partial<Patient>) {
    if (!patient) return;
    const before = patient;
    setPatients((ps) => ps.map((x) => (x.id === patient.id ? { ...x, ...patch } : x)));
    try {
      const p = await api<Patient>(`/api/patients/${patient.id}`, { method: "PATCH", json: patch });
      setPatients((ps) => upsert(ps, { ...p, profileTags: before.profileTags }));
    } catch (e) {
      setPatients((ps) => upsert(ps, before));
      const data = (e as { data?: { conflictPatientId?: string } }).data;
      if (data?.conflictPatientId) setDialog({ kind: "merge", base: patient.id, other: data.conflictPatientId });
      fail(e);
    }
  }

  async function addProfileTag(t: AddTag) {
    if (!patient) return;
    try {
      await api(`/api/patients/${patient.id}/profile-tags`, { method: "POST", json: { ...t, caseId: selected?.id } });
      const b = await api<Bundle>(`/api/patients/${patient.id}`);
      setPatients((ps) => upsert(ps, b.patient));
    } catch (e) {
      fail(e);
    }
  }

  async function removeProfileTag(id: string) {
    if (!patient) return;
    setPatients((ps) => ps.map((x) => (x.id === patient.id ? { ...x, profileTags: x.profileTags.filter((t) => t.id !== id) } : x)));
    try {
      await api(`/api/patients/${patient.id}/profile-tags/${id}`, { method: "DELETE" });
    } catch (e) {
      fail(e);
    }
  }

  async function createAppointment(d: AppointmentDraft) {
    if (!replyConv || !patient) return;
    try {
      await api<Appointment>("/api/appointments", { method: "POST", json: { ...d, patientId: patient.id, conversationId: replyConv.id } });
      setDialog(null);
      const b = await api<Bundle>(`/api/patients/${patient.id}`);
      setAppointments((as) => [...as.filter((a) => a.patientId !== patient.id), ...b.appointments]);
      loadMessages(replyConv.id, true);
    } catch (e) {
      fail(e);
    }
  }

  async function setAppointmentStatus(id: string, s: Appointment["status"]) {
    try {
      const a = await api<Appointment>(`/api/appointments/${id}`, { method: "PATCH", json: { status: s } });
      setAppointments((as) => upsert(as, a));
    } catch (e) {
      fail(e);
    }
  }

  async function split(contactId: string) {
    if (!patient) return;
    const c = contacts.find((x) => x.id === contactId);
    if (!window.confirm(`แยกบัญชี “${c?.name}” ออกเป็นแฟ้มใหม่?\nแชทของบัญชีนี้จะย้ายไปอยู่ในแฟ้มใหม่`)) return;
    try {
      await api(`/api/patients/${patient.id}/split`, { method: "POST", json: { contactId } });
      await bootstrap();
      setToast("แยกบัญชีออกเป็นแฟ้มใหม่แล้ว");
    } catch (e) {
      fail(e);
    }
  }

  function jumpToCase(caseId: string) {
    document.getElementById(`case-${caseId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const actionText: Record<SimpleAction, string> = {
    accept: "รับงานแล้ว",
    wait: "ตั้งเป็นรอคนไข้ตอบแล้ว",
    resume: "กลับมาดำเนินการต่อ",
    recall: "ดึงงานกลับแล้ว",
    reopen: "เปิดงานนี้อีกครั้งแล้ว",
  };

  // ---------- render ----------
  if (loadError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-hot/40 bg-panel p-5 text-sm">
          <div className="font-semibold text-hot">โหลดข้อมูลแชทไม่สำเร็จ</div>
          <p className="mt-1 text-muted">{loadError}</p>
        </div>
      </div>
    );
  }
  if (!ws) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  return (
    <WorkspaceProvider value={ws}>
      <div className="relative flex h-full min-h-0">
        <CaseList
          className={cn(mobileChatOpen && "hidden md:flex")}
          rows={visible}
          counts={counts}
          queue={queue}
          setQueue={(q) => {
            setQueue(q);
            setUrgentOnly(false);
          }}
          hasDept={!!myDept}
          duplicates={duplicates}
          selectedId={selectedId}
          onSelect={select}
          channelFilter={channelFilter}
          setChannelFilter={setChannelFilter}
          sort={sort}
          setSort={setSort}
          query={query}
          setQuery={setQuery}
          urgentCount={urgentCount}
          overdueCount={overdueCount}
          urgentOnly={urgentOnly}
          setUrgentOnly={setUrgentOnly}
          now={now}
        />

        {selected && patient && replyConv && replyContact && replyChannel ? (
          <div className={cn("min-w-0 flex-1", mobileChatOpen ? "flex" : "hidden md:flex")}>
            <ChatWindow
              insertText={insertReply}
              kase={selected}
              conversation={replyConv}
              patient={patient}
              contact={replyContact}
              channel={replyChannel}
              siblings={siblings}
              messages={messages}
              loading={loadingMessages}
              typing={false}
              caseInfo={caseInfo}
              onBack={() => setMobileChatOpen(false)}
              onToggleInfo={() => setInfoOpen((v) => !v)}
              onSend={handleSend}
              onCase={patchCase}
              onAction={(a) => caseAction({ action: a }, actionText[a])}
              onAssign={(userId) => caseAction({ action: "assign", userId }, "มอบงานแล้ว")}
              onTransfer={() => setDialog({ kind: "transfer" })}
              onReturn={() => setDialog({ kind: "return" })}
              onClose={() => setDialog({ kind: "close" })}
              onSwitchConversation={(id) => setReplyConvId(id)}
              onCreateAppointment={() => setDialog({ kind: "apt" })}
            />
            {infoOpen && (
              <PatientPanel
                className="fixed inset-y-0 right-0 z-30 shadow-xl xl:static xl:z-auto xl:shadow-none"
                patient={patient}
                contacts={patient.contactIds
                  .map((id) => contacts.find((c) => c.id === id))
                  .filter((c): c is Contact => !!c)
                  .map((c) => ({ contact: c, channel: ws.channels.find((x) => x.id === c.channelId)!, current: c.id === replyContact.id }))
                  .filter((x) => x.channel)}
                appointments={appointments.filter((a) => a.patientId === patient.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
                conversationCount={patientConvs.length}
                duplicateCount={duplicates[patient.id] ?? 0}
                onChange={patchPatient}
                onCreateAppointment={() => setDialog({ kind: "apt" })}
                onAppointmentStatus={setAppointmentStatus}
                onOpenMerge={() => setDialog({ kind: "merge", base: patient.id })}
                onSplit={split}
                onAddProfileTag={addProfileTag}
                onRemoveProfileTag={removeProfileTag}
                history={history}
                onLoadHistory={() => loadHistory(patient.id, true)}
                onJumpToCase={jumpToCase}
                currentCaseId={selected.id}
                kase={selected}
                onInsertReply={(text) => setInsertReply({ text, n: Date.now() })}
                onClose={() => setInfoOpen(false)}
              />
            )}
          </div>
        ) : (
          <div className="hidden flex-1 flex-col items-center justify-center gap-2 text-muted md:flex">
            <MessagesSquare size={40} strokeWidth={1.4} />
            <p className="text-sm">{cases.length ? "เลือกงานทางซ้ายเพื่อเริ่มตอบคนไข้" : "ยังไม่มีงาน — เชื่อมต่อช่องทางที่หน้า ตั้งค่า แล้วรอคนไข้ทักเข้ามา"}</p>
          </div>
        )}

        {dialog?.kind === "apt" && patient && selected && (
          <AppointmentModal
            patientName={patient.name}
            defaultDepartmentId={selected.departmentId}
            verified={!!selected.verified}
            onClose={() => setDialog(null)}
            onCreate={createAppointment}
          />
        )}
        {dialog?.kind === "transfer" && selected && patient && (
          <TransferDialog
            c={selected}
            patientName={patient.name}
            onClose={() => setDialog(null)}
            onSubmit={async (d) => {
              const ok = await caseAction({ action: "transfer", ...d }, "โอนงานแล้ว — รอแผนกปลายทางกดรับ");
              if (ok) setDialog(null);
              return ok;
            }}
          />
        )}
        {dialog?.kind === "close" && selected && patient && (
          <CloseDialog
            c={selected}
            patientName={patient.name}
            hasAppointment={appointments.some((a) => a.caseId === selected.id && a.status !== "cancelled")}
            onClose={() => setDialog(null)}
            onSubmit={async (d) => {
              const ok = await caseAction({ action: "close", ...d }, "ปิดงานแล้ว");
              if (ok) setDialog(null);
              return ok;
            }}
          />
        )}
        {dialog?.kind === "return" && selected && (
          <ReasonDialog
            title="ตีกลับงาน"
            sub={`${selected.code} — งานจะกลับไปหาผู้ที่โอนมา`}
            label="เหตุผลที่ตีกลับ (บังคับ)"
            action="ตีกลับ"
            onClose={() => setDialog(null)}
            onSubmit={async (reason) => {
              const ok = await caseAction({ action: "return", reason }, "ตีกลับงานแล้ว");
              if (ok) setDialog(null);
              return ok;
            }}
          />
        )}
        {dialog?.kind === "merge" && (
          <MergeDialog
            basePatientId={dialog.base}
            otherPatientId={dialog.other}
            channels={ws.channels}
            onClose={() => setDialog(null)}
            onMerged={async () => {
              setDialog(null);
              await bootstrap();
              if (replyConv) loadMessages(replyConv.id, true);
              setToast("รวมแฟ้มเรียบร้อย — ประวัติทุกช่องทางอยู่ในแฟ้มเดียวแล้ว");
            }}
          />
        )}

        {toast && (
          <div
            role="status"
            className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-brand/40 bg-raised px-4 py-2.5 text-sm text-ink shadow-[0_12px_40px_rgb(var(--shade-rgb)/calc(0.5*var(--shade-k)))] md:bottom-6"
          >
            {toast}
            <button onClick={() => setToast(null)} aria-label="ปิด">
              <X size={15} />
            </button>
          </div>
        )}
      </div>
    </WorkspaceProvider>
  );
}
