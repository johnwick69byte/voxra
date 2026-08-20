/**
 * Dark cinematic tokens — forest teal + warm copper (not purple-on-dark).
 * Fonts: Fraunces (display) + Manrope (body).
 */
export const theme = {
  colors: {
    brand: "#0F766E",
    brandDark: "#0B4F4A",
    brandLight: "#2DD4BF",
    accent: "#E8A87C",
    accentDeep: "#D97757",
    background: "#070D0C",
    backgroundElevated: "#101A18",
    surface: "#162320",
    text: "#F3EFE8",
    textSecondary: "#A8B5B0",
    textMuted: "#8A9A94",
    border: "rgba(255,255,255,0.08)",
    success: "#22C55E",
    warning: "#D97706",
    error: "#EF4444",
    online: "#22C55E",
    busy: "#D97706",
    offline: "#64748B",
    dnd: "#EF4444",
    callGreen: "#22C55E",
    callRed: "#EF4444",
    overlay: "rgba(7, 13, 12, 0.72)",
    glass: "rgba(16, 26, 24, 0.72)",
    onBrand: "#F3EFE8",
  },
  gradients: {
    hero: ["#0B1F1A", "#0F766E"] as const,
    soft: ["#070D0C", "#0B1F1A"] as const,
    call: ["#0B4F4A", "#070D0C"] as const,
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
    sheetSpring: 420,
    glowPulse: 2400,
    cardPress: 0.98,
  },
  shadow: {
    glow: {
      shadowColor: "#2DD4BF",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.28,
      shadowRadius: 16,
      elevation: 8,
    },
  },
} as const;

export type Theme = typeof theme;
