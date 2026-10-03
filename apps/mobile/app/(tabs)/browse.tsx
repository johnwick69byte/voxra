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
import Animated, { FadeIn } from "react-native-reanimated";
import { creatorsAPI, walletAPI, authAPI } from "../../src/services/api";
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
import { APP_NAME } from "../../src/theme/brand";
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
      // Never show yourself in the browse list
      page = page.filter((c: any) => c.user_id !== user?.user_id);
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

  const loadCreatorBanner = async () => {
    try {
      const [bal, me] = await Promise.all([walletAPI.balance(), authAPI.me()]);
      setEarnings(bal.data.earnings_balance || 0);
      setDnd(!!me.data?.creator_profile?.is_dnd);
    } catch {
      /* banner is non-critical */
    }
  };

  useFocusEffect(
    useCallback(() => {
      setCursor(null);
      loadPage(true);
      if (isCreator) loadCreatorBanner();
    }, [isCreator, sort, debouncedQ, statusFilter])
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.headerLite, isCreator && styles.headerLiteCreator]}>
        <AppText style={styles.brandDisplay}>{APP_NAME}</AppText>
        {isCreator ? (
          <View style={styles.creatorBanner}>
            <View style={{ flex: 1 }}>
              <AppText variant="caption">Creator earnings (after ~15% fee)</AppText>
              <AppText style={styles.earnSmall}>₹{earnings.toFixed(0)}</AppText>
            </View>
            <PrimaryButton
              label={dnd ? "DND on" : "Available"}
              onPress={async () => {
                const res = await creatorsAPI.toggleDnd();
                setDnd(res.data.is_dnd);
                Toast.show({
                  type: "success",
                  text1: res.data.is_dnd ? "DND on" : "You're available",
                });
              }}
              style={{
                minWidth: 120,
                height: 44,
                backgroundColor: dnd ? theme.colors.dnd : theme.colors.brand,
              }}
            />
          </View>
        ) : (
          <AppText variant="subtitle" style={{ marginTop: 4 }}>
            Creators ready for instant calls
          </AppText>
        )}
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
  headerLite: { paddingTop: 64, paddingHorizontal: 24, paddingBottom: 8 },
  headerLiteCreator: { paddingTop: 60 },
  creatorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 14,
    padding: 16,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  earnSmall: {
    fontFamily: theme.font.display,
    fontSize: 26,
    color: theme.colors.text,
    marginTop: 2,
  },
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
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
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
});
