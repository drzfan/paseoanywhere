import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { testConnection } from "../protocol/connection";
import { applySettingsAndReconnect, ensureBoot } from "./boot";
import { getSettingsSnapshot, normalizeDaemonUrl, subscribeSettings } from "../settings/storage";
import { colors, spacing } from "../ui/theme";
import { useConnectionState } from "../ui/AgentList";

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; hostname: string | null; version: string | null }
  | { kind: "fail"; error: string };

function useSettingsState() {
  return useSyncExternalStore(subscribeSettings, getSettingsSnapshot);
}

/**
 * Form with local state; remounted (key change) exactly once when persisted
 * settings arrive, so the prefill comes from useState initializers instead
 * of setState-in-effect.
 */
function SettingsForm({ initialUrl, initialPassword }: { initialUrl: string; initialPassword: string }) {
  const [url, setUrl] = useState(initialUrl);
  const [password, setPassword] = useState(initialPassword);
  const [testing, setTesting] = useState<TestResult>({ kind: "idle" });
  const [saved, setSaved] = useState(false);

  const runTest = () => {
    setTesting({ kind: "testing" });
    void testConnection({ url: normalizeDaemonUrl(url), password })
      .then((result) => {
        if (result.ok) {
          setTesting({
            kind: "ok",
            hostname: result.serverInfo.hostname ?? null,
            version: result.serverInfo.version ?? null,
          });
        } else {
          setTesting({ kind: "fail", error: result.error });
        }
      })
      .catch((error: unknown) => {
        setTesting({ kind: "fail", error: error instanceof Error ? error.message : String(error) });
      });
  };

  const save = () => {
    setSaved(false);
    void applySettingsAndReconnect(url, password).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  };

  return (
    <>
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Daemon 地址</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="ws://host:port"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          keyboardAppearance="dark"
          style={{
            color: colors.text,
            backgroundColor: colors.bgInput,
            borderRadius: 10,
            paddingHorizontal: spacing.md,
            paddingVertical: 10,
            fontSize: 15,
          }}
        />
        <Text style={{ color: colors.textDim, fontSize: 11 }}>
          实际连接 {normalizeDaemonUrl(url)}
        </Text>
      </View>

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Daemon 密码</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="（无密码可留空）"
          placeholderTextColor={colors.textDim}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          keyboardAppearance="dark"
          style={{
            color: colors.text,
            backgroundColor: colors.bgInput,
            borderRadius: 10,
            paddingHorizontal: spacing.md,
            paddingVertical: 10,
            fontSize: 15,
          }}
        />
        <Text style={{ color: colors.textDim, fontSize: 11 }}>
          明文保存在本机存储（P6 将换 secure store）
        </Text>
      </View>

      <View style={{ flexDirection: "row", gap: spacing.md }}>
        <Pressable
          onPress={runTest}
          disabled={testing.kind === "testing"}
          style={{
            flex: 1,
            alignItems: "center",
            paddingVertical: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.bgElevated,
          }}
        >
          {testing.kind === "testing" ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text style={{ color: colors.text, fontSize: 15 }}>测试连接</Text>
          )}
        </Pressable>
        <Pressable
          onPress={save}
          style={{
            flex: 1,
            alignItems: "center",
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "600" }}>
            {saved ? "已保存 ✓" : "保存并连接"}
          </Text>
        </Pressable>
      </View>

      {testing.kind === "ok" ? (
        <Text style={{ color: colors.success, fontSize: 13 }}>
          连接成功：{testing.hostname ?? "daemon"}
          {testing.version ? ` · daemon ${testing.version}` : ""}
        </Text>
      ) : null}
      {testing.kind === "fail" ? (
        <Text style={{ color: colors.error, fontSize: 13 }}>连接失败：{testing.error}</Text>
      ) : null}
    </>
  );
}

export default function SettingsScreen() {
  const settingsState = useSettingsState();
  const conn = useConnectionState();
  const loaded = settingsState.loaded;
  const initialUrl = settingsState.settings.url;
  const initialPassword = settingsState.settings.password;

  useEffect(() => {
    void ensureBoot();
  }, []);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Remount once persisted settings land; keeps prefill out of effects. */}
      <SettingsForm
        key={loaded ? "loaded" : "loading"}
        initialUrl={initialUrl}
        initialPassword={initialPassword}
      />

      <View style={{ gap: 4, paddingTop: spacing.sm }}>
        <Text style={{ color: colors.textSecondary, fontSize: 12 }}>当前连接</Text>
        <Text style={{ color: colors.textDim, fontSize: 12 }}>
          状态：{conn.status}
          {conn.attempt > 0 ? `（第 ${conn.attempt} 次尝试）` : ""}
        </Text>
        {conn.reason ? (
          <Text style={{ color: colors.error, fontSize: 12 }}>原因：{conn.reason}</Text>
        ) : null}
        {conn.serverInfo ? (
          <Text style={{ color: colors.textDim, fontSize: 12 }}>
            daemon {conn.serverInfo.version ?? "?"} · server {conn.serverInfo.serverId.slice(0, 12)}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
