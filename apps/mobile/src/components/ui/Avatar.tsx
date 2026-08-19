import { Image, StyleSheet, View, ViewStyle } from "react-native";
import { AppText } from "./Text";
import { theme } from "../../theme/tokens";

export function Avatar({
  uri,
  name,
  size = 64,
  style,
}: {
  uri?: string | null;
  name?: string;
  size?: number;
  style?: ViewStyle;
}) {
  const fallback = `https://i.pravatar.cc/${size * 2}?u=${encodeURIComponent(name || "voxora")}`;
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return (
    <View style={[{ width: size, height: size, borderRadius: size * 0.32, overflow: "hidden" }, style]}>
      {uri || name ? (
        <Image source={{ uri: uri || fallback }} style={{ width: size, height: size }} />
      ) : (
        <View style={[styles.fallback, { width: size, height: size }]}>
          <AppText style={{ color: "#fff", fontFamily: theme.font.bodyBold, fontSize: size * 0.36 }}>
            {initial}
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
