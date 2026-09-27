// Hermes 引擎没有 Web Crypto，而 @getpaseo/client 用 crypto.randomUUID() 生成请求 ID。
// 本模块必须在任何 @getpaseo/client 代码运行前执行（_layout.tsx 首行 import）。
import "react-native-get-random-values";
import * as ExpoCrypto from "expo-crypto";

const g = globalThis as unknown as { crypto?: Partial<Crypto> };
if (!g.crypto) g.crypto = {};
if (!g.crypto.randomUUID) {
  g.crypto.randomUUID = ExpoCrypto.randomUUID as unknown as Crypto["randomUUID"];
}
