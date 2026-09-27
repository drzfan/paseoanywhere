# src/voice

语音管线（P4 填充），全部在端侧完成：

- 麦克风采集 → Silero VAD（@runanywhere/onnx）→ 端侧 STT（@runanywhere/core）
- 回复文字 → 端侧 TTS 合成播放
- 不向网络发送任何音频数据
