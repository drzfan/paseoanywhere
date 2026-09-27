# src/protocol

Daemon 客户端层（P3 已实现）。纯 TS，不 import react-native（bun 可 headless 跑通，见 `scripts/e2e-probe.ts`）。

## 文件

- **`connection.ts`** — `ConnectionManager`（单例 `connection`）：包 `DaemonClient` 的连接生命周期。
  - 公开状态机 `idle | connecting | connected | reconnecting | disconnected`（`useSyncExternalStore` 可直接订阅）
  - 重连：指数退避 1s 起、上限 60s、±25% 抖动（SDK 内建重连无抖动，故 `reconnect: { enabled: false }` 由本层自驱）
  - 密码：走 `Authorization: Bearer` 头 + `paseo.bearer.<pw>` 子协议（SDK 内部处理，hello 不带密码）
  - 心跳：`client_heartbeat` 每 15s（对齐官方 app 的 ClientActivityTracker），`setFocusedAgentId` / `notifyAppVisible` 注入焦点与可见性
  - `testConnection()`：设置页一次性探测（对齐官方 `connectAndProbe`）
  - `subscribeDaemonClient(cb)`：连接变绿时把活 client 交给消费者（directory / P4 语音层用）
- **`rn-websocket.ts`** — `webSocketFactory` 适配器：RN 全局 `WebSocket`（`new WebSocket(url, protocols, { headers })`），抹平与 Node `ws` 的差异；对齐官方 app 的 `nativeWebSocketFactory`
- **`agents.ts`** —
  - `AgentDirectory`（单例 `directory`）：`fetchAgents({ subscribe: {} })` 拉取+订阅 agent 列表，`agent_update`（upsert/remove）增量维护；owned subscription 断线自动恢复
  - `AgentChat` + `openChat()`：单 agent 时间线——tail 拉取、`before` 方向翻页（loadOlder）、`subscribeAgentTimeline` 增量流、`sendMessage` 发送（乐观行 + messageId 回显去重）；处理 `replacement`（epoch 变）/`subscription_restored`（补 gap）
- **`id.ts`** — `randomId()`：Hermes 无 `crypto.randomUUID` 时的兜底 id

## 时序（照官方 app 姿势）

```
connect() → ws 打开 → SDK 发 hello{clientId, clientType:"mobile", protocolVersion:1}
        ← daemon 回 status(server_info) → SDK 置 connected + 恢复 owned subscriptions
        → fetchAgents / fetchAgentTimeline / set_subscription.request(subscribe:{})
        ← agent_update / agent_stream(timeline, seq) / timeline.replacement
```

核心卖点：这条线上**只跑文字**——语音都在端侧处理，见 `docs/ARCHITECTURE.md`。

P4 语音层约定：`connection.subscribeDaemonClient(cb)` 拿活 client；`connection.subscribe/getSnapshot` 看连接状态；`directory` 拿 agent 列表；`openChat(agentId, client)` 拿对话状态（含 agentRunning）。
