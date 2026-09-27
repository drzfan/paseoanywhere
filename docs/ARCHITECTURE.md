# Architecture

paseoanywhere 是给 paseo daemon 的**语音优先瘦客户端**。核心设计原则一句话：

> **音频永远不出端侧，网络线路上只跑文字。**

## 端到端数据流

```
┌─────────────────────── 设备（Android，P1 目标平台） ───────────────────────┐
│                                                                          │
│  🎤 麦克风                                                                │
│    │                                                                      │
│    ▼                                                                      │
│  Silero VAD（@runanywhere/onnx，端侧 ONNX 推理）                          │
│    │  只在检测到人声时唤醒后续管线，静音段直接丢弃                          │
│    ▼                                                                      │
│  端侧 STT（@runanywhere/core，本地模型推理）                              │
│    │                                                                      │
│    ▼  文字（transcript）                                                  │
│  📶 网络：仅此一条线 ↑↓ 全是文字                                           │
└────┬──────────────────────────────────────────────────────────────────────┘
     │ WebSocket（@getpaseo/client，wss）
     ▼
┌─────────────────────── 服务端 ───────────────────────┐
│  paseo daemon 0.9.x                                  │
│  agent 编排：执行任务、调用模型、产生回复             │
└────┬─────────────────────────────────────────────────┘
     │ 回复文字（agent message）
     ▼
┌─────────────────────── 设备 ───────────────────────┐
│  端侧 TTS（@runanywhere/core，本地合成）            │
│    │                                                │
│    ▼                                                │
│  🔊 扬声器                                          │
└─────────────────────────────────────────────────────┘
```

## 核心卖点：线路上只跑文字

- **隐私**：语音内容（家里说了什么、环境音）不离开设备，服务端和中间链路只见过转写后的文字。
- **带宽/成本**：文字比音频流小几个数量级，弱网（手机蜂窝、Tailscale 跨洋）下可用；无音频转写 API 费用。
- **离线语义清晰**：断网时 STT/VAD/TTS 全部照常工作，只有 daemon 对话这一段需要网络，恢复后重连即可。
- **服务端零改动**：daemon 看到的就是普通 ws 文字客户端（`@getpaseo/client`），不需要为语音做任何适配。

## 模块分层（对应 `src/` 目录）

| 目录 | 层 | 阶段 | 职责 |
|---|---|---|---|
| `src/app/` | 路由 | P1 | expo-router 页面（占位首页） |
| `src/ui/` | 界面 | P3+ | 聊天视图、语音状态指示、设置页组件 |
| `src/protocol/` | 协议 | P3 | `@getpaseo/client` 封装：认证、心跳、重连、消息类型 |
| `src/voice/` | 语音 | P4 | 麦克风 → VAD → STT 管线；TTS 播放 |
| `src/models/` | 模型 | P4 | 端侧模型（STT/VAD/TTS）下载、校验、版本管理 |
| `src/settings/` | 配置 | P3+ | daemon 地址、token、语音参数的本地持久化 |

依赖方向：`app → ui → { protocol, voice } → { models, settings }`，`protocol` 与 `voice` 互不依赖（文字是它们之间唯一接口）。

## 技术栈与版本锚点

- Expo SDK 56（CNG，`expo ~56.0.22`）+ React Native **0.85.3** + React 19.2.3
- `@runanywhere/core@0.20.27` + `@runanywhere/onnx@0.20.27`（端侧推理，预编译原生库，锁定精确版本）
- `react-native-nitro-modules@^0.33.9`（runanywhere 的原生桥）
- `@getpaseo/client@0.9.2`（对齐 daemon 0.9.2 的 ws 协议）
- `expo-notifications@~56.0.25`（后续推送通知）

## 构建策略

- **本机（VPS）零原生编译**：只做 JS 层（install / typecheck / lint / `expo export`）。不跑 gradle / pod install / prebuild。
- **CI（P2）**：GitHub Actions 上 `expo prebuild` + gradle 构建 APK，仅 `arm64-v8a` 单 ABI。
