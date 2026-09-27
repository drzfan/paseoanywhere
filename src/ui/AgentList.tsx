import { useMemo, useSyncExternalStore } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { connection, type ManagerState } from "../protocol/connection";
import { directory, type DirectoryState } from "../protocol/agents";
import { colors, relativeTime, spacing } from "./theme";
import { ConnectionBadge, StatusDot } from "./StatusDot";

export function useConnectionState(): ManagerState {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}

export function useDirectoryState(): DirectoryState {
  return useSyncExternalStore(directory.subscribe, directory.getSnapshot);
}

function connectionBadge(state: ManagerState): { label: string; tone: "ok" | "warn" | "bad" | "idle" } {
  switch (state.status) {
    case "connected":
      return { label: `已连接 · ${state.serverInfo?.hostname ?? "daemon"}`, tone: "ok" };
    case "connecting":
      return { label: "连接中…", tone: "warn" };
    case "reconnecting":
      return {
        label: `重连中（第 ${state.attempt} 次${state.nextRetryInMs ? `，${Math.ceil(state.nextRetryInMs / 1000)}s` : ""}）`,
        tone: "warn",
      };
    case "disconnected":
      return { label: state.reason ?? "连接断开", tone: "bad" };
    default:
      return { label: "未连接", tone: "idle" };
  }
}

function agentDisplayName(title: string | null, id: string, cwd: string): string {
  if (title && title.trim()) return title;
  const parts = cwd.split("/").filter(Boolean);
  const dir = parts[parts.length - 1];
  return dir && dir.length > 0 ? dir : id.slice(0, 8);
}

function AgentRow({ agent }: { agent: DirectoryState["agents"][number] }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: "/chat/[agentId]", params: { agentId: agent.id } })
      }
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingHorizontal: spacing.lg,
        paddingVertical: spacing.md,
        backgroundColor: pressed ? colors.bgElevated : colors.bg,
      })}
    >
      <StatusDot status={agent.status} size={10} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.text, fontSize: 16, fontWeight: "600" }}
        >
          {agentDisplayName(agent.title, agent.id, agent.cwd)}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
          {agent.status === "running" ? "运行中" : agent.status === "error" ? "出错" : agent.status}
          {agent.model ? ` · ${agent.model}` : ""}
        </Text>
      </View>
      <Text style={{ color: colors.textDim, fontSize: 12 }}>
        {relativeTime(agent.updatedAt)}
      </Text>
    </Pressable>
  );
}

export function AgentListScreen() {
  const dir = useDirectoryState();
  const conn = useConnectionState();
  const badge = useMemo(() => connectionBadge(conn), [conn]);

  const emptyLabel = dir.loading
    ? "加载会话列表…"
    : dir.error
      ? `加载失败：${dir.error}`
      : dir.agents.length === 0 && conn.status === "connected"
        ? "daemon 上没有 agent（用官方 App 创建）"
        : "暂无会话";

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Pressable onPress={() => connection.retryNow()}>{<ConnectionBadge label={badge.label} tone={badge.tone} />}</Pressable>
      {dir.agents.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl }}>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: "center" }}>
            {emptyLabel}
          </Text>
        </View>
      ) : (
        <FlatList
          data={dir.agents}
          keyExtractor={(agent) => agent.id}
          renderItem={({ item }) => <AgentRow agent={item} />}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: colors.border, marginLeft: spacing.lg + 10 + spacing.md }} />
          )}
          contentInsetAdjustmentBehavior="automatic"
        />
      )}
    </View>
  );
}

export function GoToSettings() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/settings")} hitSlop={8}>
      <Text style={{ color: colors.accent, fontSize: 15 }}>设置</Text>
    </Pressable>
  );
}
