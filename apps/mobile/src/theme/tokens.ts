/**
 * Design tokens — forest teal + warm sand (not purple-on-dark).
 * Fonts: Fraunces (display) + Manrope (body) via expo-google-fonts.
 */
export const theme = {
  colors: {
    brand: "#0F766E",
    brandDark: "#0B4F4A",
    brandLight: "#14B8A6",
    accent: "#E8A87C",
    accentDeep: "#D97757",
    background: "#F7F4EF",
    backgroundElevated: "#FFFFFF",
    surface: "#EFEAE2",
    text: "#14201C",
    textSecondary: "#5B6B64",
    textMuted: "#8A968F",
    border: "#D9D2C7",
    success: "#16A34A",
    warning: "#D97706",
    error: "#DC2626",
    online: "#16A34A",
    busy: "#D97706",
    offline: "#94A3B8",
    dnd: "#DC2626",
    callGreen: "#22C55E",
    callRed: "#EF4444",
    overlay: "rgba(11, 31, 26, 0.55)",
  },
  gradients: {
    hero: ["#0B1F1A", "#0F766E"] as const,
    soft: ["#F7F4EF", "#E8F5F2"] as const,
    call: ["#0B4F4A", "#14201C"] as const,
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 },
  radius: { sm: 8, md: 14, lg: 20, xl: 28, full: 999 },
  font: {
    display: "Fraunces_700Bold",
    displayMedium: "Fraunces_600SemiBold",
    body: "Manrope_500Medium",
    bodyBold: "Manrope_700Bold",
    bodySemi: "Manrope_600SemiBold",
    size: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28, hero: 42 },
  },
  motion: {
    callPulse: 1200,
    statusFade: 280,
    rechargeSuccess: 600,
  },
} as const;

export type Theme = typeof theme;
