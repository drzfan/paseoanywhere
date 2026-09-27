/**
 * Live integration probe for src/protocol (run with bun; targets the daemon
 * on this VPS). Exercises the exact P3 path the RN app uses:
 *   ConnectionManager (connect + heartbeat) → AgentDirectory (subscribe) →
 *   AgentChat (tail fetch + live subscription + send) → loadOlder.
 *
 * Usage:
 *   PA_URL=ws://127.0.0.1:6767/ws PA_PASSWORD=... bun run scripts/e2e-probe.ts
 */
import { connection, testConnection, type ConnectionSettings } from "../src/protocol/connection";
import { directory, openChat, type AgentChat } from "../src/protocol/agents";

const URL = process.env.PA_URL ?? "ws://127.0.0.1:6767/ws";
const PASSWORD = process.env.PA_PASSWORD ?? "";

function log(...args: unknown[]): void {
  console.log(new Date().toISOString().slice(11, 23), ...args);
}

async function waitFor<T>(
  condition: () => T | null,
  timeoutMs: number,
  what: string,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = condition();
    if (value !== null && value !== undefined) return value;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timeout waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function main(): Promise<void> {
  // 1. one-shot probe (settings page path)
  const probe = await testConnection({ url: URL, password: PASSWORD }, 8000);
  if (!probe.ok) throw new Error(`testConnection failed: ${probe.error}`);
  log("[probe] ok, daemon", probe.serverInfo.version, probe.serverInfo.serverId.slice(0, 10));

  // 2. shared connection manager
  const settings: ConnectionSettings = {
    url: URL,
    password: PASSWORD,
    clientId: `probe-${Date.now()}`,
  };
  await connection.connect(settings);
  await waitFor(() => (connection.getState().status === "connected" ? true : null), 10_000, "connected");
  log("[conn] connected");

  // 3. agent directory
  await directory.start(connection.getClient());
  const dirState = await waitFor(
    () => (directory.getSnapshot().agents.length > 0 ? directory.getSnapshot() : null),
    10_000,
    "agents",
  );
  for (const agent of dirState.agents.slice(0, 5)) {
    log(
      "[dir] ",
      agent.id.slice(0, 8),
      agent.status.padEnd(12),
      (agent.title ?? "").slice(0, 30),
      "hasActiveTurn:", agent.hasActiveTurn,
    );
  }

  // 4. chat: tail + subscribe on the most recently updated idle agent
  const target =
    dirState.agents.find((a) => a.status === "idle") ?? dirState.agents[0];
  log("[chat] opening", target.id.slice(0, 8), `"${target.title?.slice(0, 24) ?? ""}"`);
  const chat: AgentChat = openChat(target.id, connection.getClient());
  const tailState = await waitFor(() => {
    const s = chat.getSnapshot();
    return s.rows.length > 0 || s.error ? s : null;
  }, 10_000, "timeline tail");
  if (tailState.error) throw new Error(`timeline fetch failed: ${tailState.error}`);
  log(
    "[chat] tail rows:", tailState.rows.length,
    "hasOlder:", tailState.hasOlder,
    "sample:", tailState.rows.slice(-3).map((r) => `${r.kind}:${r.text.slice(0, 18)}`).join(" | "),
  );

  // 5. load one page of older history
  if (tailState.hasOlder) {
    await chat.loadOlder();
    const olderState = chat.getSnapshot();
    log("[chat] after loadOlder rows:", olderState.rows.length, "hasOlder:", olderState.hasOlder);
  }

  // 6. send a message and watch the stream echo + (hopefully) a turn
  const marker = `e2e-probe ${new Date().toISOString()}`;
  const statusBefore = directory.getSnapshot().agents.find((a) => a.id === target.id)?.status;
  await chat.send(marker);
  log("[chat] sent marker");
  await waitFor(() => {
    const s = chat.getSnapshot();
    return s.rows.some((r) => r.kind === "user" && r.text === marker && !r.pending) ? s : null;
  }, 10_000, "user echo");
  log("[chat] user echo reconciled (no pending dupes)");

  // directory should flip the agent to running via agent_update (or already be running)
  const dirFlip = await waitFor(() => {
    const a = directory.getSnapshot().agents.find((x) => x.id === target.id);
    return a && (a.status === "running" || statusBefore === "running") ? a : null;
  }, 15_000, "directory running status");
  log("[dir] live status flip:", statusBefore, "→", dirFlip.status);

  // wait a bit to observe turn lifecycle if the agent is live
  const observed = await new Promise<ReturnType<AgentChat["getSnapshot"]>>((resolve) => {
    const started = Date.now();
    let sawRunning = chat.getSnapshot().agentRunning;
    const timer = setInterval(() => {
      const s = chat.getSnapshot();
      if (s.agentRunning) sawRunning = true;
      if (Date.now() - started > 15_000 || (sawRunning && !s.agentRunning)) {
        clearInterval(timer);
        resolve(s);
      }
    }, 250);
  });
  log(
    "[chat] turn observed:", observed.agentRunning ? "still running" : "settled",
    "rows now:", observed.rows.length,
    "last kinds:", observed.rows.slice(-4).map((r) => r.kind).join(","),
  );

  // 7. heartbeat sanity (no throw = accepted by client)
  connection.setFocusedAgentId(target.id);
  connection.notifyAppVisible(true);
  log("[heartbeat] focused agent set");

  connection.disconnect();
  directory.reset();
  log("[done]");
  process.exit(0);
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exit(1);
});
