import { useCallback, useState } from "react";
import { View, FlatList, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { favoritesAPI } from "../../src/services/api";
import { AppText, Avatar, EmptyState } from "../../src/components/ui";
import { StatusDot } from "../../src/components/StatusDot";
import { theme } from "../../src/theme/tokens";

export default function FavoritesScreen() {
  const router = useRouter();
  const [models, setModels] = useState<any[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await favoritesAPI.list();
      setModels(res.data.models || []);
    } catch {
      /* ignore */
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const remove = async (id: string) => {
    setModels((prev) => prev.filter((m) => m.user_id !== id));
    try {
      await favoritesAPI.remove(id);
    } catch {
      Toast.show({ type: "error", text1: "Could not remove" });
      load();
    }
  };

  return (
    <View style={styles.wrap}>
      <AppText style={styles.title}>Favorites</AppText>
      <FlatList
        data={models}
        keyExtractor={(m) => m.user_id}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={
          <EmptyState title="No favorites yet" subtitle="Tap the heart on a creator to save them here." />
        }
        renderItem={({ item }) => {
          const p = item.model_profile || {};
          return (
            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: "/creator/[id]", params: { id: item.user_id } })}
            >
              <Avatar uri={item.picture || (p.images || [])[0]} name={item.name || "Creator"} size={52} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <AppText style={styles.name}>{item.name || "Creator"}</AppText>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                  <StatusDot status={item.status || p.status} />
                  <AppText variant="caption">
                    ₹{p.audio_rate_per_minute ?? "—"}/min audio
                  </AppText>
                </View>
              </View>
              <Pressable onPress={() => remove(item.user_id)} hitSlop={10} style={styles.remove}>
                <Ionicons name="heart-dislike" size={20} color={theme.colors.error} />
              </Pressable>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 64 },
  title: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.brand,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  name: { fontFamily: theme.font.bodyBold, color: theme.colors.text, fontSize: 16 },
  remove: { padding: 8 },
});
