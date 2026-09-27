/**
 * Settings storage (AsyncStorage).
 *
 * SECURITY NOTE: the daemon password is stored in plain text in AsyncStorage.
 * Acceptable for P3 (device-local, non-rooted threat model); P6 should move
 * it to a secure store (expo-secure-store / Keychain / Keystore).
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomId } from "../protocol/id";

/** Default daemon address (task spec). WebSocket endpoint lives at /ws. */
export const DEFAULT_DAEMON_URL = "ws://107.174.26.52:6767";

const KEY_SETTINGS = "paseoanywhere.settings.v1";
const KEY_CLIENT_ID = "paseoanywhere.clientId";
const KEY_LAST_AGENT = "paseoanywhere.lastAgentId";

export interface DaemonSettings {
  /** User-entered daemon address (host[:port], ws://…, or full ws URL). */
  url: string;
  password: string;
}

export const DEFAULT_SETTINGS: DaemonSettings = {
  url: DEFAULT_DAEMON_URL,
  password: "",
};

/**
 * Normalizes a user-entered daemon address into a full WebSocket URL:
 *  - bare host / host:port           → ws://host:port/ws
 *  - ws:// or wss:// without path    → append /ws
 *  - anything with an explicit path  → kept as-is (power-user override)
 * Mirrors buildDaemonWebSocketUrl()/validateWsUrl in @getpaseo/protocol
 * (daemon-endpoints.ts): the daemon's WS endpoint is /ws.
 */
export function normalizeDaemonUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return normalizeDaemonUrl(DEFAULT_DAEMON_URL);
  const withScheme = /^wss?:\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/ws";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed; // let the caller surface the connect error
  }
}

/** True when the stored/entered URL already points at a WebSocket endpoint. */
export function isWebSocketUrl(input: string): boolean {
  try {
    const url = new URL(input.trim());
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
}

let cachedSettings: DaemonSettings | null = null;
let loaded = false;

const settingsListeners = new Set<() => void>();

export interface SettingsState {
  settings: DaemonSettings;
  loaded: boolean;
}

let settingsSnapshot: SettingsState = {
  settings: DEFAULT_SETTINGS,
  loaded: false,
};

function commitSettingsSnapshot(): void {
  settingsSnapshot = {
    settings: cachedSettings ?? DEFAULT_SETTINGS,
    loaded,
  };
  for (const listener of settingsListeners) listener();
}

export function subscribeSettings(listener: () => void): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

export function getSettingsSnapshot(): SettingsState {
  return settingsSnapshot;
}

/** Loads persisted settings once at app start. */
export async function loadSettings(): Promise<DaemonSettings> {
  if (loaded) return cachedSettings ?? DEFAULT_SETTINGS;
  try {
    const raw = await AsyncStorage.getItem(KEY_SETTINGS);
    cachedSettings = raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as DaemonSettings) } : DEFAULT_SETTINGS;
  } catch {
    cachedSettings = DEFAULT_SETTINGS;
  }
  loaded = true;
  commitSettingsSnapshot();
  return cachedSettings;
}

export async function saveSettings(next: DaemonSettings): Promise<void> {
  cachedSettings = { url: next.url.trim(), password: next.password };
  loaded = true;
  await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(cachedSettings));
  commitSettingsSnapshot();
}

/** Stable per-install client id used in the daemon hello. */
export async function getOrCreateClientId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(KEY_CLIENT_ID);
    if (existing) return existing;
    const created = randomId("client");
    await AsyncStorage.setItem(KEY_CLIENT_ID, created);
    return created;
  } catch {
    // Storage unavailable (should not happen in practice); fall back to a
    // per-process id — the daemon just sees a fresh client.
    return randomId("client");
  }
}

export async function getLastAgentId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY_LAST_AGENT);
  } catch {
    return null;
  }
}

export async function setLastAgentId(agentId: string | null): Promise<void> {
  try {
    if (agentId === null) {
      await AsyncStorage.removeItem(KEY_LAST_AGENT);
    } else {
      await AsyncStorage.setItem(KEY_LAST_AGENT, agentId);
    }
  } catch {
    // best-effort persistence
  }
}
