/**
 * Agent-facing protocol facade over @getpaseo/client.
 *
 * Two modules:
 *
 *  - AgentDirectory: live agent list via `fetchAgents({ subscribe: {} })`
 *    (fetch_agents_request + owned subscription; the SDK re-establishes it
 *    automatically after reconnects and re-delivers the snapshot, mirroring
 *    the official app's agent-directory-sync). Updates arrive as
 *    `agent_update` messages with payload kinds "upsert" | "remove".
 *
 *  - AgentChat: single-agent timeline — initial tail fetch
 *    (`fetchAgentTimeline`, direction "tail"), older-history pagination
 *    (direction "before" with the response's startCursor), live incremental
 *    subscription (`subscribeAgentTimeline` → agent_stream timeline events /
 *    replacement / subscription_restored), and message send
 *    (`sendMessage` = send_agent_message_request with a client messageId for
 *    dedup echo-matching).
 *
 * Renders as plain chat rows; no react-native imports (headless-testable).
 */
import type { OwnedSubscription } from "@getpaseo/client";
import type {
  AgentSnapshotPayload,
  AgentStreamEventPayload,
  SessionOutboundMessage,
} from "@getpaseo/protocol/messages";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { randomId } from "./id";

/** Handler message of DaemonClient.subscribeAgentTimeline (not re-exported by the package). */
type TimelineMessage = Parameters<Parameters<DaemonClient["subscribeAgentTimeline"]>[1]>[0];
/**
 * Shape of the fetchAgents({subscribe:{}}) result. The SDK types it via an
 * overload; restated once here so the directory store stays typed (verified
 * against fetch_agents_response in @getpaseo/protocol and the live daemon).
 */
export interface FetchAgentsPage {
  entries: { agent: AgentSnapshotPayload; project?: unknown }[];
  pageInfo: { nextCursor: string | null; prevCursor: string | null; hasMore: boolean };
}
export type AgentsSubscription = OwnedSubscription<FetchAgentsPage>;
type FetchAgentsSubscribedPage = FetchAgentsPage & { subscription: AgentsSubscription };
/** Payload of DaemonClient.fetchAgentTimeline. */
type FetchAgentTimelinePayload = Awaited<ReturnType<DaemonClient["fetchAgentTimeline"]>>;
type TimelineSubscription = ReturnType<DaemonClient["subscribeAgentTimeline"]>;

// ---------------------------------------------------------------------------
// Agent directory
// ---------------------------------------------------------------------------

export type AgentLifecycleStatus =
  | "initializing"
  | "idle"
  | "running"
  | "error"
  | "closed";

export interface AgentSummary {
  id: string;
  title: string | null;
  status: AgentLifecycleStatus;
  updatedAt: string;
  lastUserMessageAt: string | null;
  cwd: string;
  model: string | null;
  hasActiveTurn: boolean;
  lastError: string | null;
}

function summarize(agent: AgentSnapshotPayload): AgentSummary {
  return {
    id: agent.id,
    title: agent.title,
    status: agent.status,
    updatedAt: agent.updatedAt,
    lastUserMessageAt: agent.lastUserMessageAt,
    cwd: agent.cwd,
    model: agent.model,
    hasActiveTurn: agent.activeTurn != null,
    lastError: agent.lastError ?? null,
  };
}

export interface DirectoryState {
  agents: AgentSummary[];
  loading: boolean;
  error: string | null;
}

export class AgentDirectory {
  private agents = new Map<string, AgentSummary>();
  private subscription: AgentsSubscription | null = null;
  private unsubscribeObserver: (() => void) | null = null;
  private client: DaemonClient | null = null;
  private loading = false;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private snapshotCache: DirectoryState = { agents: [], loading: false, error: null };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DirectoryState => this.snapshotCache;

  private commit(): void {
    const agents = [...this.agents.values()].sort((a, b) => {
      if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
    this.snapshotCache = { agents, loading: this.loading, error: this.error };
    for (const listener of this.listeners) listener();
  }

  /**
   * Starts (or restarts) the live directory. Called when the connection goes
   * green; owned-subscription restore keeps it alive across reconnects.
   */
  async start(client: DaemonClient): Promise<void> {
    if (this.client === client && this.subscription) return;
    this.stop();
    this.client = client;
    this.loading = true;
    this.error = null;
    this.commit();

    try {
      // Bridge cast: fetchAgents' overload types the subscription generically;
      // FetchAgentsPage restates the wire payload the SDK hands back.
      const payload = (await client.fetchAgents({ subscribe: {} })) as unknown as FetchAgentsSubscribedPage;
      this.applySnapshot(payload.entries);
      this.subscription = payload.subscription;
      this.unsubscribeObserver = payload.subscription.subscribe({
        snapshot: (snap) => {
          // Re-delivered after reconnect/restore: full replace.
          this.applySnapshot(snap.entries);
        },
        update: (message: SessionOutboundMessage) => {
          if (message.type === "agent_update") this.applyUpdate(message.payload);
        },
      });
      this.loading = false;
      this.error = null;
      this.commit();
    } catch (error) {
      this.loading = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.commit();
    }
  }

  stop(): void {
    this.unsubscribeObserver?.();
    this.unsubscribeObserver = null;
    if (this.subscription) {
      void this.subscription.release().catch(() => undefined);
      this.subscription = null;
    }
    this.client = null;
  }

  /** Clears cached rows (e.g. settings changed → different daemon). */
  reset(): void {
    this.stop();
    this.agents.clear();
    this.loading = false;
    this.error = null;
    this.commit();
  }

  private applySnapshot(entries: FetchAgentsPage["entries"]): void {
    this.agents.clear();
    for (const entry of entries) {
      this.agents.set(entry.agent.id, summarize(entry.agent));
    }
    this.commit();
  }

  private applyUpdate(
    payload: Extract<SessionOutboundMessage, { type: "agent_update" }>["payload"],
  ): void {
    if (payload.kind === "remove") {
      this.agents.delete(payload.agentId);
    } else {
      this.agents.set(payload.agent.id, summarize(payload.agent));
    }
    this.commit();
  }
}

export const directory = new AgentDirectory();

// ---------------------------------------------------------------------------
// Chat timeline
// ---------------------------------------------------------------------------

export type ChatRowKind =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool"
  | "todo"
  | "system"
  | "error";

export interface ChatRow {
  key: string;
  kind: ChatRowKind;
  text: string;
  /** Daemon timeline seq (entry seqEnd); rows without one are optimistic-only. */
  seq: number | null;
  timestamp: string | null;
  /** Daemon message id (echo/merge identity for user/assistant messages). */
  messageId: string | null;
  /** Our client-generated id (matches the echoed user_message.clientMessageId). */
  clientMessageId: string | null;
  pending: boolean;
  failed: boolean;
  /** Tool display state, kind === "tool" only. */
  tool?: { callId: string; name: string; state: "running" | "completed" | "failed" | "canceled" };
  /** Todo display state, kind === "todo" only. */
  todo?: { text: string; completed: boolean }[];
}

export interface ChatState {
  agentId: string;
  rows: ChatRow[];
  hasOlder: boolean;
  loadingOlder: boolean;
  sending: boolean;
  /** Agent is mid-turn (from turn_started..turn_completed/failed/canceled). */
  agentRunning: boolean;
  error: string | null;
}

const TAIL_LIMIT = 50;
const OLDER_LIMIT = 50;

interface TimelineEntryLike {
  item: AgentTimelineItem;
  timestamp: string;
  seqStart: number;
  seqEnd: number;
  turnId?: string;
}

function rowFromEntry(entry: TimelineEntryLike): ChatRow | null {
  const item = entry.item;
  const base = {
    key: `seq-${entry.seqEnd}`,
    seq: entry.seqEnd,
    timestamp: entry.timestamp,
    messageId: null as string | null,
    clientMessageId: null as string | null,
    pending: false,
    failed: false,
  };
  switch (item.type) {
    case "user_message":
      return {
        ...base,
        kind: "user",
        text: item.text,
        messageId: item.messageId ?? null,
        clientMessageId: item.clientMessageId ?? null,
      };
    case "assistant_message":
      return {
        ...base,
        kind: "assistant",
        text: item.text,
        messageId: item.messageId ?? null,
      };
    case "reasoning":
      return { ...base, kind: "reasoning", text: item.text };
    case "tool_call":
      return {
        ...base,
        kind: "tool",
        text: item.name,
        tool: { callId: item.callId, name: item.name, state: item.status },
      };
    case "todo":
      return {
        ...base,
        kind: "todo",
        text: `${item.items.filter((t) => t.completed).length}/${item.items.length}`,
        todo: item.items.map((t) => ({ text: t.text, completed: t.completed })),
      };
    case "error":
      return { ...base, kind: "error", text: item.message };
    case "notification":
      return { ...base, kind: "system", text: item.message };
    case "compaction":
      return {
        ...base,
        kind: "system",
        text: item.status === "completed" ? "Context compacted" : "Compacting context…",
      };
    case "plugin":
      return null; // plugin payloads are provider-specific; out of scope for P3
    default:
      return null;
  }
}

export class AgentChat {
  readonly agentId: string;
  private client: DaemonClient | null = null;
  private subscription: TimelineSubscription | null = null;

  private rows: ChatRow[] = [];
  private bySeq = new Map<number, string>();
  private byClientMessageId = new Map<string, string>();
  private epoch: string | null = null;
  private startCursor: FetchAgentTimelinePayload["startCursor"] = null;
  private hasOlder = false;
  private loadingOlder = false;
  private sending = false;
  private agentRunning = false;
  private error: string | null = null;

  private listeners = new Set<() => void>();
  private snapshotCache: ChatState;
  private tailRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private tailRetryCount = 0;

  constructor(agentId: string) {
    this.agentId = agentId;
    this.snapshotCache = {
      agentId,
      rows: [],
      hasOlder: false,
      loadingOlder: false,
      sending: false,
      agentRunning: false,
      error: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ChatState => this.snapshotCache;

  private commit(): void {
    this.snapshotCache = {
      agentId: this.agentId,
      rows: this.rows,
      hasOlder: this.hasOlder,
      loadingOlder: this.loadingOlder,
      sending: this.sending,
      agentRunning: this.agentRunning,
      error: this.error,
    };
    for (const listener of this.listeners) listener();
  }

  /**
   * Loads the timeline tail and starts the live subscription. Re-running
   * (e.g. after the chat screen remounts) is a no-op once subscribed.
   */
  async open(client: DaemonClient): Promise<void> {
    if (this.client === client && this.subscription) return;
    this.client = client;
    this.error = null;
    this.tailRetryCount = 0;
    this.commit();

    try {
      await this.refetchTail();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.commit();
      // The live subscription (owned) only surfaces restore events on
      // reconnects, so a transient RPC failure at open needs its own retry.
      this.scheduleTailRetry();
    }

    const subscription = client.subscribeAgentTimeline(this.agentId, (message) => {
      this.onTimelineMessage(message);
    });
    this.subscription = subscription;
    subscription.ready.catch((error: unknown) => {
      this.error = error instanceof Error ? error.message : String(error);
      this.commit();
    });
  }

  private scheduleTailRetry(): void {
    if (this.tailRetryTimer || !this.client || this.tailRetryCount >= 12) return;
    this.tailRetryCount += 1;
    this.tailRetryTimer = setTimeout(() => {
      this.tailRetryTimer = null;
      if (!this.client) return;
      void this.refetchTail()
        .then(() => {
          this.tailRetryCount = 0;
        })
        .catch(() => {
          this.scheduleTailRetry();
        });
    }, 5_000);
  }

  close(): void {
    if (this.tailRetryTimer) {
      clearTimeout(this.tailRetryTimer);
      this.tailRetryTimer = null;
    }
    if (this.subscription) {
      void this.subscription.release().catch(() => undefined);
      this.subscription = null;
    }
    this.client = null;
  }

  /** Full tail reload + rebuild (initial open, restore, epoch replacement). */
  private async refetchTail(): Promise<void> {
    const client = this.client;
    if (!client) return;
    const payload = await client.fetchAgentTimeline(this.agentId, {
      direction: "tail",
      limit: TAIL_LIMIT,
    });
    if (payload.error) throw new Error(payload.error);
    this.rebuildFromPayload(payload);
  }

  private rebuildFromPayload(payload: FetchAgentTimelinePayload): void {
    const sorted = [...payload.entries].sort((a, b) => a.seqStart - b.seqStart);
    this.rows = [];
    this.bySeq.clear();
    this.byClientMessageId.clear();
    for (const entry of sorted) {
      const row = rowFromEntry(entry);
      if (!row) continue;
      this.insertRow(row);
    }
    this.epoch = payload.epoch;
    this.startCursor = payload.startCursor;
    this.hasOlder = payload.hasOlder;
    this.error = null;
    this.commit();
  }

  /**
   * Insert with stream-merge semantics, checked in order:
   *  1. same tool callId → tool lifecycle update in place
   *  2. same messageId → same logical message, replace text
   *  3. same seq → canonical row update in place
   *  4. echo of our optimistic row (clientMessageId) → replace, clear pending
   *  5. otherwise append
   */
  private insertRow(row: ChatRow): void {
    const replaceAt = (index: number, key: string): void => {
      this.rows[index] = { ...row, key };
      if (row.seq != null) this.bySeq.set(row.seq, key);
      if (row.clientMessageId) this.byClientMessageId.set(row.clientMessageId, key);
    };

    if (row.tool) {
      const index = this.rows.findIndex((r) => r.tool?.callId === row.tool?.callId);
      if (index >= 0) {
        replaceAt(index, this.rows[index].key);
        return;
      }
    }
    if (row.messageId) {
      const index = this.rows.findIndex((r) => r.messageId === row.messageId);
      if (index >= 0) {
        replaceAt(index, this.rows[index].key);
        return;
      }
    }
    if (row.seq != null && this.bySeq.has(row.seq)) {
      const key = this.bySeq.get(row.seq)!;
      const index = this.rows.findIndex((r) => r.key === key);
      if (index >= 0) {
        replaceAt(index, key);
        return;
      }
    }
    if (row.clientMessageId && this.byClientMessageId.has(row.clientMessageId)) {
      const key = this.byClientMessageId.get(row.clientMessageId)!;
      const index = this.rows.findIndex((r) => r.key === key);
      if (index >= 0) {
        this.rows[index] = { ...row, key, pending: false };
        if (row.seq != null) this.bySeq.set(row.seq, key);
        return;
      }
    }
    this.rows.push(row);
    if (row.seq != null) this.bySeq.set(row.seq, row.key);
    if (row.clientMessageId) this.byClientMessageId.set(row.clientMessageId, row.key);
  }

  private onTimelineMessage(message: TimelineMessage): void {
    if (message.type === "agent_stream") {
      this.applyStreamEvent(
        message.payload.event,
        message.payload.seq ?? null,
        message.payload.timestamp,
      );
      return;
    }
    if (message.type === "agent.timeline.replacement") {
      // Epoch changed (rewind/fork): rebuild from a fresh tail fetch.
      void this.refetchTail().catch(() => undefined);
      return;
    }
    if (message.type === "agent.timeline.subscription_restored") {
      // Live delivery resumed after a reconnect; history may have been missed.
      void this.refetchTail().catch(() => undefined);
      return;
    }
    if (message.type === "agent.timeline.error") {
      this.error = message.payload.error;
      this.commit();
    }
  }

  private applyStreamEvent(
    event: AgentStreamEventPayload,
    seq: number | null,
    timestamp: string,
  ): void {
    switch (event.type) {
      case "turn_started":
        this.agentRunning = true;
        this.commit();
        return;
      case "turn_completed":
      case "turn_canceled":
        this.agentRunning = false;
        this.commit();
        return;
      case "turn_failed":
        this.agentRunning = false;
        this.error = event.error;
        this.commit();
        return;
      case "timeline": {
        const row = rowFromEntry({
          item: event.item,
          timestamp,
          seqStart: seq ?? 0,
          seqEnd: seq ?? 0,
          turnId: event.turnId,
        });
        if (!row) return;
        if (seq != null) {
          row.key = `seq-${seq}`;
          row.seq = seq;
        } else {
          row.key = `ev-${randomId()}`;
          row.seq = null;
        }
        this.insertRow(row);
        this.commit();
        return;
      }
      default:
        return; // permission/attention events are not rendered in P3
    }
  }

  /** Loads one page of older history (direction "before" from startCursor). */
  async loadOlder(): Promise<void> {
    const client = this.client;
    if (!client || this.loadingOlder || !this.hasOlder || !this.startCursor) return;
    this.loadingOlder = true;
    this.commit();
    try {
      const payload = await client.fetchAgentTimeline(this.agentId, {
        direction: "before",
        cursor: this.startCursor,
        limit: OLDER_LIMIT,
      });
      if (payload.error) throw new Error(payload.error);
      if (payload.epoch !== this.epoch) {
        // Epoch moved under us; a replacement event will rebuild the view.
        this.loadingOlder = false;
        this.commit();
        return;
      }
      const sorted = [...payload.entries].sort((a, b) => a.seqStart - b.seqStart);
      const older: ChatRow[] = [];
      for (const entry of sorted) {
        const row = rowFromEntry(entry);
        if (!row) continue;
        const known =
          (row.seq != null && this.bySeq.has(row.seq)) ||
          this.rows.some((r) => row.messageId != null && r.messageId === row.messageId);
        if (!known) older.push(row);
      }
      this.rows = [...older, ...this.rows];
      for (const row of older) {
        if (row.seq != null) this.bySeq.set(row.seq, row.key);
        if (row.clientMessageId) this.byClientMessageId.set(row.clientMessageId, row.key);
      }
      this.startCursor = payload.startCursor;
      this.hasOlder = payload.hasOlder;
      this.loadingOlder = false;
      this.error = null;
      this.commit();
    } catch (error) {
      this.loadingOlder = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.commit();
    }
  }

  /** Sends a user message; appends an optimistic row, reconciles on echo. */
  async send(text: string): Promise<void> {
    const client = this.client;
    const trimmed = text.trim();
    if (!client || !trimmed || this.sending) return;
    const messageId = randomId("msg");
    const optimistic: ChatRow = {
      key: `opt-${messageId}`,
      kind: "user",
      text: trimmed,
      seq: null,
      timestamp: new Date().toISOString(),
      messageId: null,
      clientMessageId: messageId,
      pending: true,
      failed: false,
    };
    this.rows.push(optimistic);
    this.byClientMessageId.set(messageId, optimistic.key);
    this.sending = true;
    this.commit();

    try {
      // messageId doubles as the client-supplied dedup id; the echoed
      // user_message carries it back (item.messageId / clientMessageId).
      await client.sendMessage(this.agentId, trimmed, { messageId });
      const index = this.rows.findIndex((r) => r.key === optimistic.key);
      if (index >= 0 && this.rows[index].pending) {
        // Echo may lag behind the accept (or arrive via the stream first).
        this.rows[index] = { ...this.rows[index], pending: false };
      }
      this.sending = false;
      this.error = null;
      this.commit();
    } catch (error) {
      this.sending = false;
      const index = this.rows.findIndex((r) => r.key === optimistic.key);
      if (index >= 0) {
        this.rows[index] = { ...this.rows[index], failed: true, pending: false };
      }
      this.error = error instanceof Error ? error.message : String(error);
      this.commit();
    }
  }
}

// ---------------------------------------------------------------------------
// One active chat at a time, module-scoped so remounts keep state.
// ---------------------------------------------------------------------------

let activeChat: AgentChat | null = null;
const activeChatListeners = new Set<() => void>();

function notifyActiveChat(): void {
  for (const listener of activeChatListeners) listener();
}

export function getActiveChat(): AgentChat | null {
  return activeChat;
}

export function subscribeActiveChat(listener: () => void): () => void {
  activeChatListeners.add(listener);
  return () => {
    activeChatListeners.delete(listener);
  };
}

export function getActiveChatSnapshot(): AgentChat | null {
  return activeChat;
}

export function openChat(agentId: string, client: DaemonClient): AgentChat {
  if (activeChat && activeChat.agentId === agentId) {
    void activeChat.open(client);
    return activeChat;
  }
  activeChat?.close();
  activeChat = new AgentChat(agentId);
  notifyActiveChat();
  void activeChat.open(client);
  return activeChat;
}

export function closeActiveChat(): void {
  activeChat?.close();
  activeChat = null;
  notifyActiveChat();
}
