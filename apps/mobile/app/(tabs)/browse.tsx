import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Pressable,
  ScrollView,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { creatorsAPI, callsAPI, walletAPI, authAPI } from "../../src/services/api";
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

const SORTS = [
  { id: "popular", label: "Popular" },
  { id: "price_asc", label: "Price ↑" },
  { id: "price_desc", label: "Price ↓" },
] as const;

const STATUS_FILTERS = ["ALL", "ACTIVE", "BUSY", "OFFLINE", "DND"] as const;

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
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("popular");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const loadPage = async (reset = false) => {
    if (isCreator) {
      setRefreshing(true);
      try {
        const [bal, hist, me] = await Promise.all([
          walletAPI.balance(),
          callsAPI.history(),
          authAPI.me(),
        ]);
        setEarnings(bal.data.earnings_balance || 0);
        setCreators(hist.data.calls || []);
        setDnd(!!me.data?.creator_profile?.is_dnd);
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
        sort,
        q: debouncedQ || undefined,
      });
      let page = res.data.creators || [];
      if (statusFilter !== "ALL") {
        page = page.filter((c: any) => c.status === statusFilter);
      }
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
      setCursor(null);
      loadPage(true);
    }, [isCreator, sort, debouncedQ, statusFilter])
  );

  if (isCreator) {
    const spark = [0.35, 0.55, 0.4, 0.7, 0.5, 0.85, Math.min(1, earnings / Math.max(earnings, 500) || 0.6)];
    return (
      <View style={styles.wrap}>
        <LinearGradient colors={[...theme.gradients.soft]} style={styles.header}>
          <AppText style={styles.brandDisplay}>Voxora</AppText>
          <AppText variant="subtitle" style={{ marginTop: 8 }}>
            Hi {user?.name || "Creator"}
          </AppText>
          <Animated.View entering={FadeInDown.duration(400)}>
            <AppText style={styles.earn}>₹{earnings.toFixed(0)}</AppText>
            <AppText variant="caption">Creator earnings (after ~15% fee)</AppText>
            <View style={styles.sparkRow}>
              {spark.map((h, i) => (
                <View key={i} style={[styles.sparkBar, { height: 8 + h * 28 }]} />
              ))}
            </View>
          </Animated.View>
          <View style={styles.dndWrap}>
            <PrimaryButton
              label={dnd ? "You're on DND" : "You're Available"}
              onPress={async () => {
                const res = await creatorsAPI.toggleDnd();
                setDnd(res.data.is_dnd);
                Toast.show({
                  type: "success",
                  text1: res.data.is_dnd ? "DND on" : "You're available — followers notified",
                });
              }}
              style={{
                marginTop: 16,
                backgroundColor: dnd ? theme.colors.dnd : theme.colors.brand,
              }}
            />
          </View>
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
            <EmptyState title="No calls yet" subtitle="Stay online to receive instant calls." />
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
        <TextInput
          style={styles.search}
          placeholder="Search creators"
          placeholderTextColor={theme.colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
          {SORTS.map((s) => (
            <Pressable
              key={s.id}
              onPress={() => setSort(s.id)}
              style={[styles.chip, sort === s.id && styles.chipOn]}
            >
              <AppText style={[styles.chipText, sort === s.id && styles.chipTextOn]}>{s.label}</AppText>
            </Pressable>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          {STATUS_FILTERS.map((s) => (
            <Pressable
              key={s}
              onPress={() => setStatusFilter(s)}
              style={[styles.chip, statusFilter === s && styles.chipOn]}
            >
              <AppText style={[styles.chipText, statusFilter === s && styles.chipTextOn]}>
                {s === "ALL" ? "All" : s}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
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
            <EmptyState title="No creators found" subtitle="Try another search or clear filters." />
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={theme.colors.brand} style={{ marginVertical: 16 }} /> : null
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeIn.delay(Math.min(index * 35, 210)).duration(theme.motion.statusFade)}>
              <Card onPress={() => router.push(`/creator/${item.user_id}`)}>
                <View style={styles.row}>
                  <Avatar uri={item.picture} name={item.name} size={72} />
                  <View style={{ flex: 1 }}>
                    <AppText style={styles.name}>{item.name || "Creator"}</AppText>
                    <StatusDot status={item.status} />
                    <AppText variant="caption" style={{ marginTop: 6 }}>
                      ₹{item.audio_rate_per_minute}/min audio
                    </AppText>
                    <AppText variant="caption">₹{item.video_rate_per_minute}/min video</AppText>
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
  search: {
    marginTop: 14,
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    paddingHorizontal: 14,
    fontFamily: theme.font.body,
    color: theme.colors.text,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    marginRight: 8,
  },
  chipOn: { backgroundColor: theme.colors.brand },
  chipText: { fontFamily: theme.font.bodySemi, color: theme.colors.textSecondary, fontSize: 13 },
  chipTextOn: { color: theme.colors.onBrand },
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
    backgroundColor: theme.colors.backgroundElevated,
    padding: 14,
    borderRadius: theme.radius.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  callTitle: { fontFamily: theme.font.bodyBold, color: theme.colors.text },
  dndWrap: { marginTop: 4 },
  sparkRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 14,
    height: 40,
  },
  sparkBar: {
    width: 10,
    borderRadius: 4,
    backgroundColor: theme.colors.brandLight,
    opacity: 0.85,
  },
});
