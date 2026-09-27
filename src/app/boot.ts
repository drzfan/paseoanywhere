/**
 * App-level bootstrap: loads settings once, wires the connection manager to
 * the settings, starts the agent directory when connected, tracks app
 * visibility and focused agent for the presence heartbeat, and remembers the
 * last opened chat.
 */
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { connection } from "../protocol/connection";
import { directory } from "../protocol/agents";
import {
  getOrCreateClientId,
  getSettingsSnapshot,
  loadSettings,
  normalizeDaemonUrl,
  saveSettings,
  setLastAgentId,
  subscribeSettings,
} from "../settings/storage";

let bootPromise: Promise<void> | null = null;

/**
 * Focused-agent source for the presence heartbeat: the chat screen publishes
 * its agentId here; the root layout feeds it into the connection lifecycle.
 */
let focusedAgentId: string | null = null;
const focusListeners = new Set<() => void>();

export function setFocusedAgent(id: string | null): void {
  if (focusedAgentId === id) return;
  focusedAgentId = id;
  for (const listener of focusListeners) listener();
}

export function useFocusedAgentId(): string | null {
  return useSyncExternalStore(
    (listener) => {
      focusListeners.add(listener);
      return () => {
        focusListeners.delete(listener);
      };
    },
    () => focusedAgentId,
  );
}

/** Loads settings and connects (idempotent across mounts). */
export function ensureBoot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const settings = await loadSettings();
      const clientId = await getOrCreateClientId();
      await connection.connect({
        url: normalizeDaemonUrl(settings.url),
        password: settings.password,
        clientId,
      });
    })();
    bootPromise.catch(() => undefined);
  }
  return bootPromise;
}

/** Reconfigure the live connection after a settings save. */
export async function applySettingsAndReconnect(url: string, password: string): Promise<void> {
  await saveSettings({ url, password });
  directory.reset();
  const clientId = await getOrCreateClientId();
  await connection.connect({
    url: normalizeDaemonUrl(url),
    password,
    clientId,
  });
}

/**
 * Mount once in the root layout: drives the directory lifecycle off the
 * connection state and feeds app visibility / focus into the heartbeat.
 */
export function useConnectionLifecycle(focusedAgentId: string | null): void {
  useEffect(() => {
    void ensureBoot();
  }, []);

  // Directory follows the connection.
  useEffect(() => {
    return connection.subscribeDaemonClient((client) => {
      void directory.start(client).catch(() => undefined);
    });
  }, []);

  // App visibility → heartbeat payload (official app semantics).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      connection.notifyAppVisible(state === "active");
      if (state === "active") connection.retryNow();
    });
    return () => sub.remove();
  }, []);

  // Focused agent → heartbeat payload + last-chat persistence.
  useEffect(() => {
    connection.setFocusedAgentId(focusedAgentId);
    void setLastAgentId(focusedAgentId);
  }, [focusedAgentId]);
}

export { getSettingsSnapshot, subscribeSettings };
