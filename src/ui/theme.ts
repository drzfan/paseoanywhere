/** Dark theme palette — single source of truth for the P3 UI. */
export const colors = {
  bg: "#0e1116",
  bgElevated: "#171c23",
  bgInput: "#1f2630",
  border: "#2a323d",
  text: "#e6eaf0",
  textSecondary: "#8b96a5",
  textDim: "#5c6675",
  accent: "#4f9cf9",
  accentMuted: "#2b5f9e",
  userBubble: "#2b5f9e",
  assistantBubble: "#1f2630",
  error: "#f16a6a",
  warning: "#e8b04b",
  success: "#54c08a",
  statusIdle: "#8b96a5",
  statusRunning: "#54c08a",
  statusInitializing: "#e8b04b",
  statusError: "#f16a6a",
  statusClosed: "#5c6675",
} as const;

export const statusColor = {
  initializing: colors.statusInitializing,
  idle: colors.statusIdle,
  running: colors.statusRunning,
  error: colors.statusError,
  closed: colors.statusClosed,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/** Compact relative time for list rows (zh-aware numerals not needed). */
export function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
