import { useState } from "react";
import { Image, StyleSheet, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
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
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const imageUri = typeof uri === "string" ? uri.trim() : "";
  const showImage = !!imageUri && failedUri !== imageUri;
  const label = name?.trim() || "Profile";

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.32,
          overflow: "hidden",
          backgroundColor: theme.colors.surface,
        },
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: imageUri }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailedUri(imageUri)}
        />
      ) : (
        <View style={[styles.fallback, { width: size, height: size }]}>
          <Ionicons name="person" size={Math.round(size * 0.46)} color={theme.colors.brandLight} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: theme.colors.backgroundElevated,
    alignItems: "center",
    justifyContent: "center",
  },
});
