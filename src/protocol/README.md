# src/protocol

Daemon 客户端层（P3 填充）。

- 基于 `@getpaseo/client` 的 WebSocket 连接管理：认证、心跳、重连
- 消息类型定义与收发封装
- 核心卖点：这条线上**只跑文字**——语音都在端侧处理，见 `docs/ARCHITECTURE.md`
