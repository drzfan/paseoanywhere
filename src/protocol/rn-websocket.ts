/**
 * RN WebSocket adapter for @getpaseo/client.
 *
 * The daemon client's default transport expects a Node-style `ws` or a browser
 * WebSocket. React Native provides only the global `WebSocket` whose
 * constructor signature is `new WebSocket(url, protocols, { headers })` and
 * whose close event is a WHATWG-ish `{ code?, reason? }` object (code can be
 * missing on abnormal closes — unlike Node's `ws` which always provides both).
 *
 * This module exposes a `webSocketFactory` compatible with
 * `DaemonClientConfig.webSocketFactory`. The client's transport wrapper
 * (createWebSocketTransportFactory) already normalizes close/error payloads via
 * `describeTransportClose` (reads `event.reason` / `event.code` defensively),
 * so the raw RN socket can be returned as `WebSocketLike` directly — but we
 * still smooth over a few RN quirks here:
 *
 *  - headers are only accepted as a third constructor arg on RN; browsers and
 *    bun silently ignore extra args, so passing them is safe everywhere.
 *  - RN requires `protocols` to be a string[] or undefined; we never pass null.
 *  - RN's `binaryType` setter can throw on very old versions; the transport
 *    wrapper wraps it in try/catch, we double-guard here.
 */
import type { WebSocketLike } from "@getpaseo/client/internal/daemon-client-transport-types";

type RnWebSocketCtor = new (
  url: string,
  protocols?: string[],
  options?: { headers?: Record<string, string> },
) => WebSocketLike;

function getRnWebSocket(): RnWebSocketCtor {
  const ctor = (globalThis as { WebSocket?: RnWebSocketCtor }).WebSocket;
  if (!ctor) {
    throw new Error("WebSocket is not available in this runtime");
  }
  return ctor;
}

/**
 * WebSocket factory backed by the platform's global WebSocket
 * (React Native / bun / browser). Mirrors the official app's
 * `nativeWebSocketFactory` (packages/app/src/runtime/websocket-factory.ts):
 * password auth rides on the `Authorization` header where the platform
 * supports it, and on the `paseo.bearer.<password>` subprotocol everywhere
 * (the daemon client passes both).
 */
export function rnWebSocketFactory(
  url: string,
  options?: { headers?: Record<string, string>; protocols?: string[] },
): WebSocketLike {
  const Ctor = getRnWebSocket();
  const protocols = options?.protocols;
  const headers = options?.headers;
  // RN and bun accept the options object as the third argument; browsers
  // ignore extra constructor arguments per WebIDL.
  const socket = new Ctor(url, protocols && protocols.length > 0 ? protocols : undefined, {
    ...(headers ? { headers } : {}),
  });
  try {
    // "blob" would force async decoding we never need — daemon traffic here is
    // text JSON. RN supports "arraybuffer"; harmless elsewhere.
    (socket as { binaryType?: string }).binaryType = "arraybuffer";
  } catch {
    // Older runtimes may not implement the setter; text frames still work.
  }
  return socket;
}
