import "../polyfills/crypto";
import { Pressable, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { colors } from "../ui/theme";
import { useConnectionLifecycle, useFocusedAgentId } from "./boot";

function SettingsLink() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push("/settings")} hitSlop={8}>
      <Text style={{ color: colors.accent, fontSize: 15 }}>设置</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  const focusedAgent = useFocusedAgentId();
  useConnectionLifecycle(focusedAgent);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgElevated },
          headerTintColor: colors.text,
          headerTitleStyle: { color: colors.text },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen
          name="index"
          options={{ title: "会话", headerRight: SettingsLink }}
        />
        <Stack.Screen
          name="chat/[agentId]"
          options={{ title: "对话", headerRight: SettingsLink }}
        />
        <Stack.Screen name="settings" options={{ title: "设置" }} />
      </Stack>
    </View>
  );
}
