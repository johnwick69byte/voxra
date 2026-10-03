import { useCallback, useEffect, useState } from "react";
import { View, FlatList, StyleSheet } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { reviewsAPI } from "../src/services/api";
import { AppText, EmptyState, ScreenHeader } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function ReviewsScreen() {
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
      <ScreenHeader title="Reviews" subtitle={name || undefined} />

      {stats ? (
        <View style={styles.stats}>
          <AppText style={styles.avg}>★ {stats.average_rating || 0}</AppText>
          <AppText variant="caption">{stats.total_reviews || 0} reviews</AppText>
        </View>
      ) : null}

      <FlatList
        data={reviews}
        keyExtractor={(r, i) => String(r.review_id || r.call_id || i)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 8 }}
        ListEmptyComponent={<EmptyState title="No reviews yet" subtitle="Be the first to review." />}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <AppText style={styles.stars}>{"★".repeat(item.rating || 0)}</AppText>
            <AppText variant="caption" style={{ marginTop: 4, lineHeight: 20 }}>
              {item.comment || "No comment"}
            </AppText>
            <AppText variant="caption" color={theme.colors.textMuted} style={{ marginTop: 8 }}>
              {item.reviewer_name || "Anonymous"}
            </AppText>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  stats: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  avg: { fontFamily: theme.font.display, fontSize: 28, color: theme.colors.accentDeep },
  row: {
    backgroundColor: theme.colors.surface,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  stars: { color: theme.colors.accent, fontSize: 16 },
});
