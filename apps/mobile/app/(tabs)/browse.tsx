import { useCallback, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";
import { creatorsAPI, callsAPI, walletAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { StatusDot } from "../../src/components/StatusDot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import {
  AppText,
  Avatar,
  Card,
  CreatorRowSkeleton,
  EmptyState,
} from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import Toast from "react-native-toast-message";

export default function BrowseScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isCreator = user?.user_type === "creator";
  const [creators, setCreators] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initial, setInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [dnd, setDnd] = useState(false);
  const [earnings, setEarnings] = useState(0);

  const loadPage = async (reset = false) => {
    if (isCreator) {
      setRefreshing(true);
      try {
        const bal = await walletAPI.balance();
        setEarnings(bal.data.earnings_balance || 0);
        const hist = await callsAPI.history();
        setCreators(hist.data.calls || []);
      } catch (e: any) {
        Toast.show({ type: "error", text1: "Could not load", text2: e.message });
      } finally {
        setRefreshing(false);
        setInitial(false);
      }
      return;
    }

    if (reset) setRefreshing(true);
    else {
      if (!hasMore || loadingMore) return;
      setLoadingMore(true);
    }
    try {
      const res = await creatorsAPI.browse({
        cursor: reset ? undefined : cursor || undefined,
        limit: 20,
      });
      const page = res.data.creators || [];
      setCreators((prev) => (reset ? page : [...prev, ...page]));
      setCursor(res.data.next_cursor || null);
      setHasMore(!!res.data.has_more);
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Could not load", text2: e.message });
    } finally {
      setRefreshing(false);
      setLoadingMore(false);
      setInitial(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadPage(true);
    }, [isCreator])
  );

  if (isCreator) {
    return (
      <View style={styles.wrap}>
        <LinearGradient colors={[...theme.gradients.soft]} style={styles.header}>
          <AppText style={styles.brandDisplay}>Voxora</AppText>
          <AppText variant="subtitle" style={{ marginTop: 8 }}>
            Hi {user?.name || "Creator"}
          </AppText>
          <AppText style={styles.earn}>₹{earnings.toFixed(0)}</AppText>
          <AppText variant="caption">Earnings available</AppText>
          <PrimaryButton
            label={dnd ? "Go Available" : "Enable DND"}
            onPress={async () => {
              const res = await creatorsAPI.toggleDnd();
              setDnd(res.data.is_dnd);
              Toast.show({
                type: "success",
                text1: res.data.is_dnd ? "DND on" : "You're available — followers notified",
              });
            }}
            style={{ marginTop: 16 }}
          />
        </LinearGradient>
        <AppText variant="label" style={{ paddingHorizontal: 16, marginTop: 8 }}>
          Recent calls
        </AppText>
        <FlatList
          data={creators}
          keyExtractor={(item) => item.call_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadPage(true)} />}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <EmptyState
              title="No calls yet"
              subtitle="Stay online to receive instant calls."
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeIn.delay(Math.min(index * 40, 200)).duration(theme.motion.statusFade)}>
              <View style={styles.callRow}>
                <AppText style={styles.callTitle}>
                  {item.call_type} · {item.status}
                </AppText>
                <AppText variant="caption">
                  ₹{(item.total_amount || 0).toFixed(0)} · {item.duration_seconds || 0}s
                </AppText>
              </View>
            </Animated.View>
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerLite}>
        <AppText style={styles.brandDisplay}>Voxora</AppText>
        <AppText variant="subtitle" style={{ marginTop: 4 }}>
          Creators ready for instant calls
        </AppText>
      </View>
      {initial && creators.length === 0 ? (
        <View style={{ padding: 16 }}>
          <CreatorRowSkeleton />
          <CreatorRowSkeleton />
          <CreatorRowSkeleton />
        </View>
      ) : (
        <FlatList
          data={creators}
          keyExtractor={(item) => item.user_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadPage(true)} />}
          onEndReached={() => loadPage(false)}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          ListEmptyComponent={
            <EmptyState title="No creators yet" subtitle="Pull to refresh when creators go live." />
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={theme.colors.brand} style={{ marginVertical: 16 }} /> : null
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeIn.delay(Math.min(index * 35, 210)).duration(theme.motion.statusFade)}>
              <Card onPress={() => router.push(`/creator/${item.user_id}`)}>
                <View style={styles.row}>
                  <Avatar uri={item.picture} name={item.name} size={64} />
                  <View style={{ flex: 1 }}>
                    <AppText style={styles.name}>{item.name || "Creator"}</AppText>
                    <StatusDot status={item.status} />
                    <AppText variant="caption" style={{ marginTop: 4 }}>
                      ₹{item.audio_rate_per_minute}/min audio · ₹{item.video_rate_per_minute}/min video
                    </AppText>
                    {item.avg_rating != null && (
                      <View style={styles.ratingChip}>
                        <AppText style={styles.ratingText}>
                          ★ {item.avg_rating} · {item.review_count}
                        </AppText>
                      </View>
                    )}
                  </View>
                </View>
              </Card>
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 28 },
  headerLite: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 8 },
  brandDisplay: {
    fontFamily: theme.font.display,
    fontSize: 36,
    color: theme.colors.brand,
    letterSpacing: -0.8,
  },
  earn: {
    fontFamily: theme.font.display,
    fontSize: 36,
    color: theme.colors.text,
    marginTop: 8,
  },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  name: {
    fontFamily: theme.font.bodyBold,
    fontSize: 17,
    color: theme.colors.text,
    marginBottom: 4,
  },
  ratingChip: {
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "rgba(217,119,87,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ratingText: {
    fontFamily: theme.font.bodyBold,
    fontSize: 12,
    color: theme.colors.accentDeep,
  },
  callRow: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: theme.radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  callTitle: { fontFamily: theme.font.bodyBold, color: theme.colors.text },
});
