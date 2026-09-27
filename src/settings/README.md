# src/settings

设置存储（P3 已实现）：`storage.ts`，基于 AsyncStorage。

- **daemon 地址**（默认 `ws://107.174.26.52:6767`）：`normalizeDaemonUrl()` 归一成 `…/ws` 端点（daemon 的 WebSocket 路径是 `/ws`，对齐 `@getpaseo/protocol` 的 `buildDaemonWebSocketUrl`）；已有路径则保留（手工覆盖）
- **daemon 密码**：⚠️ 明文存 AsyncStorage（设备本地），P6 换 secure store
- **clientId**：`getOrCreateClientId()` 每安装一份、稳定持久（hello 用）
- **lastAgentId**：记住上次会话，冷启动直达该聊天页

键：`paseoanywhere.settings.v1` / `paseoanywhere.clientId` / `paseoanywhere.lastAgentId`。

语音参数（TTS 音色、VAD 灵敏度等）P4 再加。
