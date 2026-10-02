import { useCallback, useEffect, useState } from "react";
import { View, FlatList, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { reviewsAPI } from "../src/services/api";
import { AppText, EmptyState } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function ReviewsScreen() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [reviews, setReviews] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([
        reviewsAPI.list(String(id)),
        reviewsAPI.stats(String(id)),
      ]);
      setReviews(r.data.reviews || []);
      setStats(s.data);
    } catch {
      /* ignore */
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
        </Pressable>
        <View>
          <AppText style={styles.title}>Reviews</AppText>
          {name ? <AppText variant="caption">{name}</AppText> : null}
        </View>
      </View>

      {stats ? (
        <View style={styles.stats}>
          <AppText style={styles.avg}>★ {stats.average_rating || 0}</AppText>
          <AppText variant="caption">{stats.total_reviews || 0} reviews</AppText>
        </View>
      ) : null}

      <FlatList
        data={reviews}
        keyExtractor={(r, i) => String(r.review_id || r.call_id || i)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListEmptyComponent={<EmptyState title="No reviews yet" subtitle="Be the first to review." />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <AppText style={styles.stars}>{"★".repeat(item.rating || 0)}</AppText>
            <AppText variant="caption" style={{ marginTop: 4 }}>
              {item.comment || "No comment"}
            </AppText>
            <AppText variant="caption" color={theme.colors.textMuted} style={{ marginTop: 6 }}>
              {item.reviewer_name || "Anonymous"}
            </AppText>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 56 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16 },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.backgroundElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontFamily: theme.font.display, fontSize: 28, color: theme.colors.brand },
  stats: { paddingHorizontal: 20, marginTop: 8, flexDirection: "row", alignItems: "baseline", gap: 10 },
  avg: { fontFamily: theme.font.display, fontSize: 26, color: theme.colors.accentDeep },
  row: {
    backgroundColor: theme.colors.backgroundElevated,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  stars: { color: theme.colors.accent },
});
