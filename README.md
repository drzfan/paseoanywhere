# paseoanywhere

paseo daemon 的语音优先瘦客户端：**语音识别与合成全部在端侧完成（RunAnywhere SDK），与 daemon 之间的 WebSocket 线路上只跑文字**（`@getpaseo/client`）。

隐私、省流、弱网可用，daemon 零适配——它看到的就是一个普通文字客户端。

## 架构

```
🎤 麦克风
  → Silero VAD（端侧，@runanywhere/onnx）
  → 端侧 STT（@runanywhere/core）
  → 文字 ──wss（@getpaseo/client）──→ paseo daemon 0.9.x
  ← 回复文字 ←───────────────────────┘
  → 端侧 TTS（@runanywhere/core）
  → 🔊 扬声器
```

线路上只跑文字，音频永不离开设备。详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 阶段规划

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P1** | Expo CNG 脚手架 + 依赖锚定 + 本机 JS 层验收 | ✅ 本仓库 |
| **P2** | GitHub Actions：push 检查 + 手动 APK 构建（arm64-v8a 单 ABI） | ✅ `feat/ci`（[CI 文档](docs/CI.md)） |
| **P3** | daemon 对话（`src/protocol`，ws 客户端） | ✅ feat/chat |
| **P4** | 语音管线（`src/voice` + `src/models`：VAD/STT/TTS） | 待做 |

## 目录

```
src/app/        expo-router 路由页面（会话列表/聊天/设置 + boot）
src/ui/         界面组件（聊天视图、会话列表、主题）
src/protocol/   daemon ws 客户端（连接管理 + agent 目录 + 对话，P3 已实现）
src/voice/      语音管线：VAD/STT/TTS（P4）
src/models/     端侧模型管理（P4）
src/settings/   设置存储（daemon 地址/密码/上次会话，P3 已实现）
docs/           架构文档
```

## 本机开发（无原生编译，VPS 友好）

包管理器：**bun**。本机禁止 gradle / pod install / prebuild（那是 CI 的事）。

```bash
bun install          # 装依赖（@runanywhere 含预编译原生库，体积大耗时长属正常）
bun run typecheck    # tsc --noEmit
bun run lint         # expo lint
bun run export:web   # expo export --platform web，纯 JS bundle 验证
```

协议层 headless 联调（本 VPS 上对着真 daemon 跑）：

```bash
PA_URL=ws://127.0.0.1:6767/ws PA_PASSWORD=… bun run scripts/e2e-probe.ts
```

## CI（P2 将加）

- push 检查：typecheck + lint
- 手动触发（workflow_dispatch）：`expo prebuild` + gradle 构建 release APK，仅 `arm64-v8a` 单 ABI，artifact 上传

## 版本锚点（踩坑后定死，勿随手升级）

| 依赖 | 版本 | 说明 |
|---|---|---|
| expo | ~56.0.22 | SDK 56 ↔ RN 0.85 配对 |
| react-native | 0.85.3 | runanywhere 要求 ≥0.83 |
| react | 19.2.3 | RN 0.85.3 peer |
| @runanywhere/core | 0.20.27 | 锁精确 |
| @runanywhere/onnx | 0.20.27 | 锁精确 |
| react-native-nitro-modules | ^0.33.9 | runanywhere 原生桥 |
| @getpaseo/client | 0.9.2 | 锁精确，对齐 daemon 0.9.2 |
| @getpaseo/protocol | 0.9.2 | client 的同仓同版协议包，直接 import 其类型（官方 app 同样用法） |
| @react-native-async-storage/async-storage | 2.2.0 | expo 56 配对版本；密码明文存储 P6 换 secure store |
| metro.config.js | — | 给 `@getpaseo/*` 的 exports 加 `node` condition（其 import/default 指向未发布的 src/*.ts） |
| expo-notifications | ~56.0.25 | expo install 自动配对 |
