/**
 * Hermes on RN has no guaranteed `crypto.randomUUID` (the client SDK calls it
 * for sendAgentMessage messageIds and we need stable client/message ids for
 * optimistic-echo matching), so provide a safe fallback.
 */
export function randomId(prefix = ""): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === "function") {
      return prefix ? `${prefix}-${c.randomUUID()}` : c.randomUUID();
    }
  } catch {
    // fall through to manual id
  }
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}${Date.now().toString(36)}-${rand}`;
}
