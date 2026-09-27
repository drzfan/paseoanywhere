# src/ui

界面层（P3 已实现）：深色主题、rn 自带组件、无大 UI 库。

- **`theme.ts`** — 深色配色 / 间距 / 相对时间
- **`AgentList.tsx`** — 会话列表（`AgentListScreen`）+ `useConnectionState` / `useDirectoryState` hooks + 连接状态徽标
- **`ChatView.tsx`** — 聊天主体（`ChatBody`）：倒置 FlatList 时间线（上滑加载更早）、用户/助手气泡、reasoning 淡显、工具/todo/系统行、运行中指示、底部输入框
- **`StatusDot.tsx`** — 状态点（idle/running/error 配色）

路由页面在 `src/app/`（expo-router）：`index` 会话列表、`chat/[agentId]` 聊天、`settings` 设置。

语音状态指示（P4）叠加在 `ChatView` 的 Composer 区域。
