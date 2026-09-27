import { memo } from "react";
import { Text, View } from "react-native";
import { colors, statusColor } from "./theme";
import type { AgentLifecycleStatus } from "../protocol/agents";

function StatusDotBase({ status, size = 8 }: { status: AgentLifecycleStatus; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: statusColor[status] ?? colors.statusIdle,
      }}
    />
  );
}

export const StatusDot = memo(StatusDotBase);

export function ConnectionBadge({
  label,
  tone,
}: {
  label: string;
  tone: "ok" | "warn" | "bad" | "idle";
}) {
  const toneColor =
    tone === "ok" ? colors.success : tone === "warn" ? colors.warning : tone === "bad" ? colors.error : colors.textDim;
  return (
    <View style={{ alignItems: "center", paddingVertical: 6 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: 3,
          borderRadius: 999,
          backgroundColor: colors.bgElevated,
        }}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: toneColor,
          }}
        />
        <Text style={{ color: toneColor, fontSize: 12 }}>{label}</Text>
      </View>
    </View>
  );
}
