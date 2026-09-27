/**
 * Chat screen body: inverted FlatList timeline + running indicator + composer.
 * Data flows from the module-level active AgentChat (protocol layer).
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import type { ChatRow, ChatState } from "../protocol/agents";
import { colors, spacing } from "./theme";

// ---------------------------------------------------------------------------
// Row renderers
// ---------------------------------------------------------------------------

function UserRow({ row }: { row: ChatRow }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingVertical: spacing.xs }}>
      <View
        style={{
          maxWidth: "78%",
          backgroundColor: row.failed ? colors.error : colors.userBubble,
          opacity: row.pending ? 0.65 : 1,
          borderRadius: 16,
          borderTopRightRadius: 4,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
        }}
      >
        <Text style={{ color: "#ffffff", fontSize: 15, lineHeight: 21 }}>{row.text}</Text>
        {row.failed ? (
          <Text style={{ color: "#ffffff", fontSize: 11, marginTop: 2 }}>发送失败</Text>
        ) : null}
      </View>
    </View>
  );
}

function AssistantRow({ row }: { row: ChatRow }) {
  return (
    <View style={{ flexDirection: "row", paddingVertical: spacing.xs }}>
      <View
        style={{
          maxWidth: "82%",
          backgroundColor: colors.assistantBubble,
          borderRadius: 16,
          borderTopLeftRadius: 4,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>{row.text}</Text>
      </View>
    </View>
  );
}

function ReasoningRow({ row }: { row: ChatRow }) {
  if (!row.text.trim()) return null;
  return (
    <Text
      numberOfLines={4}
      style={{
        color: colors.textDim,
        fontSize: 13,
        fontStyle: "italic",
        paddingVertical: 2,
        paddingLeft: spacing.sm,
      }}
    >
      {row.text}
    </Text>
  );
}

const toolStateLabel = {
  running: "…",
  completed: "✓",
  failed: "✕",
  canceled: "–",
} as const;

const toolStateColor = {
  running: colors.warning,
  completed: colors.success,
  failed: colors.error,
  canceled: colors.textDim,
} as const;

function ToolRow({ row }: { row: ChatRow }) {
  const tool = row.tool;
  if (!tool) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2, paddingLeft: spacing.sm }}>
      <Text style={{ color: toolStateColor[tool.state], fontSize: 12, fontWeight: "700" }}>
        {toolStateLabel[tool.state]}
      </Text>
      <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: 12 }}>
        {tool.name}
      </Text>
    </View>
  );
}

function TodoRow({ row }: { row: ChatRow }) {
  if (!row.todo || row.todo.length === 0) return null;
  return (
    <View style={{ paddingLeft: spacing.sm, paddingVertical: 2, gap: 2 }}>
      {row.todo.map((task, index) => (
        <Text key={`${row.key}-t${index}`} numberOfLines={2} style={{ color: colors.textSecondary, fontSize: 12 }}>
          {task.completed ? "✓" : "○"} {task.text}
        </Text>
      ))}
    </View>
  );
}

function SystemRow({ row }: { row: ChatRow }) {
  return (
    <Text style={{ color: colors.textDim, fontSize: 12, textAlign: "center", paddingVertical: 3 }}>
      {row.text}
    </Text>
  );
}

function ErrorRow({ row }: { row: ChatRow }) {
  return (
    <Text style={{ color: colors.error, fontSize: 12, textAlign: "center", paddingVertical: 3 }}>
      {row.text}
    </Text>
  );
}

function ChatRowView({ row }: { row: ChatRow }) {
  switch (row.kind) {
    case "user":
      return <UserRow row={row} />;
    case "assistant":
      return <AssistantRow row={row} />;
    case "reasoning":
      return <ReasoningRow row={row} />;
    case "tool":
      return <ToolRow row={row} />;
    case "todo":
      return <TodoRow row={row} />;
    case "error":
      return <ErrorRow row={row} />;
    default:
      return <SystemRow row={row} />;
  }
}

// ---------------------------------------------------------------------------
// Chat body
// ---------------------------------------------------------------------------

export interface ChatBodyProps {
  chatState: ChatState;
  onLoadOlder: () => void;
  onSend: (text: string) => void;
}

function ChatList({ chatState, onLoadOlder }: Pick<ChatBodyProps, "chatState" | "onLoadOlder">) {
  // Inverted list: data[0] renders at the visual bottom (newest).
  const data = useMemo(() => chatState.rows.slice().reverse(), [chatState.rows]);
  return (
    <FlatList
      data={data}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => <ChatRowView row={item} />}
      inverted
      onEndReached={onLoadOlder}
      onEndReachedThreshold={0.6}
      maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
      ListFooterComponent={
        chatState.loadingOlder ? (
          <View style={{ padding: spacing.md, alignItems: "center" }}>
            <ActivityIndicator color={colors.textDim} size="small" />
          </View>
        ) : chatState.hasOlder ? null : (
          <Text style={{ color: colors.textDim, fontSize: 11, textAlign: "center", padding: spacing.sm }}>
            · 对话起点 ·
          </Text>
        )
      }
      contentContainerStyle={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}
    />
  );
}

function RunningIndicator({ label }: { label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.md, paddingVertical: 4 }}>
      <ActivityIndicator size="small" color={colors.accent} />
      <Text style={{ color: colors.accent, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Composer({ sending, onSend }: { sending: boolean; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState("");
  const canSend = draft.trim().length > 0 && !sending;
  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    onSend(text);
  }, [draft, sending, onSend]);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-end",
        gap: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingVertical: spacing.sm,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      <TextInput
        value={draft}
        onChangeText={setDraft}
        placeholder="发消息…"
        placeholderTextColor={colors.textDim}
        multiline
        style={{
          flex: 1,
          color: colors.text,
          fontSize: 15,
          backgroundColor: colors.bgInput,
          borderRadius: 18,
          paddingHorizontal: spacing.md,
          paddingTop: Platform.OS === "ios" ? 10 : 8,
          paddingBottom: Platform.OS === "ios" ? 10 : 8,
          maxHeight: 120,
        }}
        keyboardAppearance="dark"
        editable={!sending}
      />
      <Pressable
        onPress={submit}
        disabled={!canSend}
        hitSlop={4}
        style={{
          backgroundColor: canSend ? colors.accent : colors.bgInput,
          borderRadius: 18,
          paddingHorizontal: spacing.lg,
          paddingVertical: 10,
          opacity: canSend ? 1 : 0.5,
        }}
      >
        <Text style={{ color: canSend ? "#ffffff" : colors.textDim, fontSize: 15, fontWeight: "600" }}>
          发送
        </Text>
      </Pressable>
    </View>
  );
}

export function ChatBody({ chatState, onLoadOlder, onSend }: ChatBodyProps) {
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <ChatList chatState={chatState} onLoadOlder={onLoadOlder} />
      {chatState.agentRunning ? <RunningIndicator label="运行中…" /> : null}
      {chatState.error ? (
        <Text numberOfLines={1} style={{ color: colors.error, fontSize: 11, paddingHorizontal: spacing.md }}>
          {chatState.error}
        </Text>
      ) : null}
      <Composer sending={chatState.sending} onSend={onSend} />
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------------------------
// Store binding helpers
// ---------------------------------------------------------------------------

/** Subscribes to one AgentChat's snapshot (non-null chat only). */
export function useChatSnapshot(
  chat: { subscribe: (l: () => void) => () => void; getSnapshot: () => ChatState } | null,
): ChatState | null {
  const subscribe = useCallback(
    (listener: () => void) => (chat ? chat.subscribe(listener) : () => undefined),
    [chat],
  );
  return useSyncExternalStore(
    subscribe,
    () => chat?.getSnapshot() ?? null,
    () => null,
  );
}
