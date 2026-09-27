/**
 * Connection manager around @getpaseo/client's DaemonClient.
 *
 * Responsibilities:
 *  - own the DaemonClient instance for the app lifetime (one daemon, one client)
 *  - public connection state machine: idle | connecting | connected |
 *    reconnecting | disconnected, exposed as an external store for React
 *    (useSyncExternalStore) and as a plain event source for P4 voice layer
 *  - reconnect with exponential backoff (1s base, 60s cap, ±25% jitter).
 *    The client SDK has built-in backoff without jitter; we disable it
 *    (`reconnect: { enabled: false }`) and drive retries ourselves so the
 *    public state machine and the retry policy live in one place.
 *  - app-level presence heartbeat (client_heartbeat every 15s while connected),
 *    mirroring the official app's ClientActivityTracker
 *    (packages/app/src/hooks/client-activity-tracker.ts).
 *
 * Protocol behavior (see packages/client/src/daemon-client.ts in the paseo
 * repo): connect() opens the transport, sends `hello` { clientId, clientType,
 * protocolVersion: 1, capabilities }, and the daemon answers with a `status`
 * server_info message — only then does the SDK report "connected" and restore
 * owned subscriptions. The password travels as an Authorization: Bearer header
 * (where the platform supports headers) and as the
 * `paseo.bearer.<password>` WebSocket subprotocol; we never put it in hello.
 *
 * This module must stay free of react-native imports so it can be exercised
 * headlessly with bun (see scripts/e2e-probe.ts). App visibility is injected
 * via notifyAppVisible().
 */
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  ConnectionState,
  DaemonClientConfig,
  DaemonEventHandler,
} from "@getpaseo/client/internal/daemon-client";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";
import { rnWebSocketFactory } from "./rn-websocket";
import { randomId } from "./id";

export type ManagerStatus =
  | "idle" // never configured / after user disconnect
  | "connecting" // first attempt in flight
  | "connected"
  | "reconnecting" // dropped, waiting for the next retry
  | "disconnected"; // gave up is not a thing (infinite retry); only via failure while stopped

export interface ManagerState {
  status: ManagerStatus;
  /** Human-readable last failure reason, if any. */
  reason: string | null;
  /** Retry attempt number since the connection was last healthy. */
  attempt: number;
  /** Milliseconds until the next retry (only meaningful while reconnecting). */
  nextRetryInMs: number | null;
  serverInfo: ServerInfoStatusPayload | null;
}

export interface ConnectionSettings {
  /** Full ws:// or wss:// URL (normalized, including /ws path). */
  url: string;
  password: string;
  clientId: string;
}

// Reconnect policy: exponential backoff with jitter (spec: 1s start, 60s cap).
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 60_000;
const RECONNECT_JITTER = 0.25; // ±25%

// Presence heartbeat cadence (official app: 15s).
const HEARTBEAT_INTERVAL_MS = 15_000;

export class ConnectionManager {
  private client: DaemonClient | null = null;
  private settings: ConnectionSettings | null = null;
  private state: ManagerState = {
    status: "idle",
    reason: null,
    attempt: 0,
    nextRetryInMs: null,
    serverInfo: null,
  };

  /** True once this manager has seen a connected state for the current client. */
  private hadConnection = false;
  private intentionalClose = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeStatus: (() => void) | null = null;
  private unsubscribeEvents: (() => void) | null = null;

  // Heartbeat bookkeeping (official app semantics).
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private focusedAgentId: string | null = null;
  private appVisible = true;
  private lastActivityAt = Date.now();
  private appVisibilityChangedAt = Date.now();

  // External-store plumbing.
  private listeners = new Set<() => void>();
  private snapshotCache: ManagerState = this.state;
  private daemonClientListeners = new Set<(client: DaemonClient) => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): ManagerState => this.snapshotCache;

  onDaemonEvent(handler: DaemonEventHandler): () => void {
    const client = this.requireClient();
    return client.on(handler);
  }

  /**
   * Notified with the live client every time the connection goes green
   * (also immediately when already connected). Used by the agent directory
   * and available to the P4 voice layer for one-shot RPCs.
   */
  subscribeDaemonClient(listener: (client: DaemonClient) => void): () => void {
    this.daemonClientListeners.add(listener);
    if (this.isConnected() && this.client) {
      try {
        listener(this.client);
      } catch {
        // listener errors must not break the manager
      }
    }
    return () => {
      this.daemonClientListeners.delete(listener);
    };
  }

  private setState(patch: Partial<ManagerState>): void {
    this.state = { ...this.state, ...patch };
    this.snapshotCache = this.state;
    for (const listener of this.listeners) listener();
  }

  getState(): ManagerState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state.status === "connected";
  }

  /** The live client for agents.ts / future voice layer. Throws if not configured. */
  getClient(): DaemonClient {
    return this.requireClient();
  }

  /**
   * Applies settings and (re)connects. Safe to call repeatedly (app start,
   * settings change): disposes the previous client cleanly first.
   */
  async connect(settings: ConnectionSettings): Promise<void> {
    this.disposeClient();
    this.settings = settings;
    this.intentionalClose = false;
    this.hadConnection = false;

    const client = new DaemonClient(this.buildConfig(settings));
    this.client = client;
    this.unsubscribeStatus = client.subscribeConnectionStatus((cs) =>
      this.onClientState(cs),
    );
    this.unsubscribeEvents = client.on((event) => {
      if (event.type === "error" && event.message) {
        this.setState({ reason: event.message });
      }
    });

    this.setState({ status: "connecting", reason: null, attempt: 0, nextRetryInMs: null });
    // connect() rejects on failure; retry is state-driven, not promise-driven.
    void client.connect().catch(() => {
      // handled through connection status events
    });
  }

  private buildConfig(settings: ConnectionSettings): DaemonClientConfig {
    return {
      url: settings.url,
      clientId: settings.clientId,
      clientType: "mobile",
      appVersion: "paseoanywhere/0.1.0",
      password: settings.password || undefined,
      suppressSendErrors: true,
      // Retries are driven here (jittered backoff) rather than in the SDK.
      reconnect: { enabled: false },
      connectTimeoutMs: 15_000,
      webSocketFactory: rnWebSocketFactory,
    };
  }

  private onClientState(cs: ConnectionState): void {
    if (cs.status === "disconnected" && typeof cs.reason === "string" && cs.reason) {
      this.setState({ reason: cs.reason });
    }
    if (cs.status === "connected") {
      this.hadConnection = true;
      this.setState({
        status: "connected",
        reason: null,
        attempt: 0,
        nextRetryInMs: null,
        serverInfo: this.client?.getLastServerInfoMessage() ?? null,
      });
      this.startHeartbeat();
      const client = this.client;
      if (client) {
        for (const listener of this.daemonClientListeners) {
          try {
            listener(client);
          } catch {
            // listener errors must not break the manager
          }
        }
      }
      return;
    }
    this.stopHeartbeat();
    if (cs.status === "disconnected" || cs.status === "idle") {
      // First-connect failures and mid-session drops both enter the retry
      // loop; only a user-initiated close (or no configured client) stops it.
      if (!this.intentionalClose && this.client) {
        this.scheduleRetry();
      } else {
        this.setState({ status: this.intentionalClose ? "idle" : "disconnected", nextRetryInMs: null });
      }
      return;
    }
    // cs.status === "connecting": a retry's attemptConnect() supersedes the
    // timer; reflect the in-flight attempt while keeping the retry framing.
    const inRetry = this.hadConnection || this.state.attempt > 0;
    this.setState({ status: inRetry ? "reconnecting" : "connecting" });
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.intentionalClose || !this.client) return;
    const attempt = this.state.attempt + 1;
    const exponential = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1),
      RECONNECT_MAX_DELAY_MS,
    );
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    const delay = Math.round(exponential * jitter);
    this.setState({
      status: "reconnecting",
      attempt,
      nextRetryInMs: delay,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.intentionalClose || !this.client) return;
      void this.client.connect().catch(() => {
        // retried via state events
      });
    }, delay);
  }

  /** User-initiated disconnect: stop retrying, close the transport. */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stopHeartbeat();
    this.disposeClient();
    this.hadConnection = false;
    this.setState({
      status: "idle",
      reason: null,
      attempt: 0,
      nextRetryInMs: null,
      serverInfo: null,
    });
  }

  /** Immediate retry (user tapped a retry affordance). */
  retryNow(): void {
    if (!this.settings || this.intentionalClose) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.client?.connect().catch(() => {
      // retried via state events
    });
  }

  private disposeClient(): void {
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = null;
    this.stopHeartbeat();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.client) {
      void this.client.close().catch(() => undefined);
      this.client = null;
    }
  }

  private requireClient(): DaemonClient {
    if (!this.client) {
      throw new Error("Connection not configured");
    }
    return this.client;
  }

  // ---------------------------------------------------------------------------
  // Presence heartbeat (client_heartbeat), mirroring the official app.
  // ---------------------------------------------------------------------------

  /** Wire AppState (or any visibility source) into the heartbeat payload. */
  notifyAppVisible(visible: boolean): void {
    this.appVisible = visible;
    this.appVisibilityChangedAt = Date.now();
    this.sendHeartbeatIfConnected();
  }

  /** The chat UI calls this when the focused agent changes. */
  setFocusedAgentId(agentId: string | null): void {
    if (this.focusedAgentId === agentId) return;
    this.focusedAgentId = agentId;
    this.recordUserActivity();
    this.sendHeartbeatIfConnected();
  }

  /** Record that the user interacted with the app just now. */
  recordUserActivity(): void {
    this.lastActivityAt = Date.now();
  }

  private sendHeartbeatIfConnected(): void {
    const client = this.client;
    if (!client || !client.isConnected) return;
    client.sendHeartbeat({
      deviceType: "mobile",
      focusedAgentId: this.focusedAgentId,
      focusedTerminalId: null,
      lastActivityAt: new Date(this.lastActivityAt).toISOString(),
      appVisible: this.appVisible,
      appVisibilityChangedAt: new Date(this.appVisibilityChangedAt).toISOString(),
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendHeartbeatIfConnected();
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeatIfConnected(),
      HEARTBEAT_INTERVAL_MS,
    );
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

/**
 * One-shot connection probe for the settings page. Mirrors the official app's
 * connectAndProbe (packages/app/src/utils/test-daemon-connection.ts): fresh
 * DaemonClient, connect with a timeout, read server info, close. Never touches
 * the shared manager state.
 */
export async function testConnection(
  settings: Omit<ConnectionSettings, "clientId">,
  timeoutMs = 8_000,
): Promise<{ ok: true; serverInfo: ServerInfoStatusPayload } | { ok: false; error: string }> {
  const client = new DaemonClient({
    url: settings.url,
    clientId: randomId("probe"),
    clientType: "mobile",
    appVersion: "paseoanywhere/0.1.0",
    password: settings.password || undefined,
    suppressSendErrors: true,
    reconnect: { enabled: false },
    connectTimeoutMs: timeoutMs,
    webSocketFactory: rnWebSocketFactory,
  });
  const timer = setTimeout(() => {
    void client.close().catch(() => undefined);
  }, timeoutMs + 2_000);
  try {
    await client.connect();
    const serverInfo = client.getLastServerInfoMessage();
    if (!serverInfo) {
      return { ok: false, error: "Connected, but the daemon sent no server info" };
    }
    return { ok: true, serverInfo };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason };
  } finally {
    clearTimeout(timer);
    await client.close().catch(() => undefined);
  }
}

/** App-wide singleton (one daemon, one connection for the app lifetime). */
export const connection = new ConnectionManager();
