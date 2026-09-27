import { useEffect, useSyncExternalStore } from "react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { Text, View } from "react-native";
import {
  getActiveChatSnapshot,
  openChat,
  subscribeActiveChat,
} from "../../protocol/agents";
import { connection } from "../../protocol/connection";
import { ChatBody, useChatSnapshot } from "../../ui/ChatView";
import { useConnectionState, useDirectoryState } from "../../ui/AgentList";
import { colors, spacing } from "../../ui/theme";
import { ensureBoot, setFocusedAgent } from "../boot";

function useActiveChat() {
  return useSyncExternalStore(subscribeActiveChat, getActiveChatSnapshot);
}

function titleFor(agentId: string, title: string | null | undefined, cwd: string | undefined): string {
  if (title && title.trim()) return title;
  if (cwd) {
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return `agent ${agentId.slice(0, 8)}`;
}

export default function ChatScreen() {
  const params = useLocalSearchParams<{ agentId: string }>();
  const agentId = typeof params.agentId === "string" ? params.agentId : "";
  const navigation = useNavigation();
  const conn = useConnectionState();
  const dir = useDirectoryState();
  const chat = useActiveChat();
  const chatState = useChatSnapshot(chat ?? null);

  const agentMeta = dir.agents.find((a) => a.id === agentId);

  useEffect(() => {
    void ensureBoot();
  }, []);

  useEffect(() => {
    if (!agentId) return;
    setFocusedAgent(agentId);
    return () => {
      setFocusedAgent(null);
    };
  }, [agentId]);

  // Open (or re-open) the chat whenever a live client is available.
  const chatMissing = chat === null;
  useEffect(() => {
    if (!agentId || conn.status !== "connected") return;
    try {
      openChat(agentId, connection.getClient());
    } catch {
      // not configured yet; boot reconnects and this effect re-runs
    }
  }, [agentId, conn.status, chatMissing]);

  // Header title follows the directory's latest title for this agent.
  useEffect(() => {
    if (!agentId) return;
    navigation.setOptions({ title: titleFor(agentId, agentMeta?.title, agentMeta?.cwd) });
  }, [agentId, agentMeta?.title, agentMeta?.cwd, navigation]);

  if (!agentId) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <Text style={{ color: colors.textSecondary }}>缺少 agentId</Text>
      </View>
    );
  }

  if (!chat || !chatState) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.bg,
          gap: spacing.sm,
        }}
      >
        <Text style={{ color: colors.textSecondary }}>
          {conn.status === "connected" ? "正在加载时间线…" : "正在连接 daemon…"}
        </Text>
        {conn.status !== "connected" ? (
          <Text style={{ color: colors.textDim, fontSize: 12 }}>
            {conn.reason ?? conn.status}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <ChatBody
      chatState={chatState}
      onLoadOlder={() => void chat.loadOlder()}
      onSend={(text) => void chat.send(text)}
    />
  );
}
