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
  Modal,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn } from "react-native-reanimated";
import { creatorsAPI, walletAPI, authAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { useNotificationsStore } from "../../src/store/notificationsStore";
import { socketService } from "../../src/services/socket";
import { StatusDot } from "../../src/components/StatusDot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText, Avatar, Card, CreatorRowSkeleton, EmptyState } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import Toast from "react-native-toast-message";

const SORTS = [
  { id: "recommended", label: "Recommended" },
  { id: "rating", label: "Top rated" },
  { id: "price_asc", label: "Price: low" },
  { id: "price_desc", label: "Price: high" },
  { id: "newest", label: "Newest" },
] as const;

type SortId = (typeof SORTS)[number]["id"];
type Filters = { gender: string; language: string; sort: SortId };

const EMPTY_FILTERS: Filters = { gender: "", language: "", sort: "recommended" };

export default function BrowseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const isCreator = user?.user_type === "creator";
  const unread = useNotificationsStore((s) => s.unread);

  const [creators, setCreators] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [initial, setInitial] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [dnd, setDnd] = useState(false);
  const [earnings, setEarnings] = useState(0);
  // Set when the signed-in user is a creator whose verification is still under
  // review: they can use the app, but cannot receive calls yet.
  const [callsBlocked, setCallsBlocked] = useState(false);

  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [status, setStatus] = useState<"all" | "active">("all");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [genderOptions, setGenderOptions] = useState<string[]>([]);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQ(query.trim()), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  useEffect(() => {
    creatorsAPI
      .filters()
      .then((res) => {
        setGenderOptions(res.data.genders || []);
        setLanguageOptions(res.data.languages || []);
      })
      .catch(() => {});
  }, []);

  const fetchPage = async (pageNum: number) => {
    const seq = ++reqSeq.current;
    const res = await creatorsAPI.browse({
      page: pageNum,
      limit: 20,
      sort: filters.sort,
      status,
      q: debouncedQ || undefined,
      gender: filters.gender || undefined,
      language: filters.language || undefined,
    });
    if (seq !== reqSeq.current) return null; // a newer request superseded this one
    const data = res.data;
    // Defensive: never show the signed-in creator herself, even if the API returns her.
    if (data?.creators && user?.user_id) {
      data.creators = data.creators.filter((c: any) => c.user_id !== user.user_id);
    }
    return data;
  };

  const loadFirst = async () => {
    setRefreshing(true);
    try {
      const data = await fetchPage(1);
      if (!data) return;
      setCreators(data.creators || []);
      setPage(1);
      setHasMore(!!data.has_more);
      setTotal(data.total || 0);
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Could not load", text2: e.message });
    } finally {
      setRefreshing(false);
      setInitial(false);
    }
  };

  const loadMore = async () => {
    if (!hasMore || loadingMore || refreshing) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const data = await fetchPage(next);
      if (!data) return;
      setCreators((prev) => {
        const seen = new Set(prev.map((c) => c.user_id));
        return [...prev, ...(data.creators || []).filter((c: any) => !seen.has(c.user_id))];
      });
      setPage(next);
      setHasMore(!!data.has_more);
    } catch {
      /* keep current list */
    } finally {
      setLoadingMore(false);
    }
  };

  const loadCreatorBanner = async () => {
    try {
      const [bal, me] = await Promise.all([walletAPI.balance(), authAPI.me()]);
      setEarnings(bal.data.earnings_balance || 0);
      setDnd(!!me.data?.creator_profile?.is_dnd);
      setCallsBlocked(
        me.data?.user?.user_type === "creator" && !me.data?.creator_profile?.is_approved
      );
    } catch {
      /* banner is non-critical */
    }
  };

  // Live presence: the server broadcasts creator_status on connect, disconnect,
  // ring, reject and call end. Applying it here keeps the Active filter and the
  // status dots accurate without a manual refresh.
  useEffect(() => {
    const onStatus = (payload: any) => {
      const id = payload?.user_id;
      if (!id) return;
      setCreators((prev) => {
        let changed = false;
        const next = prev.map((c) => {
          if (c.user_id !== id) return c;
          const status = payload.status ?? c.status;
          const isOnline = payload.is_online ?? status === "ACTIVE";
          if (c.status === status && c.is_online === isOnline) return c;
          changed = true;
          return { ...c, status, is_online: isOnline };
        });
        return changed ? next : prev;
      });
    };
    socketService.on("creator_status", onStatus);
    return () => socketService.off("creator_status", onStatus);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadFirst();
      if (isCreator) loadCreatorBanner();
    }, [isCreator, filters.sort, filters.gender, filters.language, status, debouncedQ])
  );

  const activeFilterCount =
    (filters.gender ? 1 : 0) + (filters.language ? 1 : 0) + (filters.sort !== "recommended" ? 1 : 0);

  return (
    <View style={styles.wrap}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={{ flex: 1 }}>
          <AppText style={styles.title}>Discover</AppText>
          <AppText variant="caption">{total} creators</AppText>
        </View>
        <Pressable onPress={() => router.push("/notifications")} style={styles.bell} hitSlop={8}>
          <Ionicons name="notifications-outline" size={22} color={theme.colors.text} />
          {unread > 0 ? (
            <View style={styles.bellBadge}>
              <AppText style={styles.bellBadgeText}>{unread > 9 ? "9+" : unread}</AppText>
            </View>
          ) : null}
        </Pressable>
      </View>

      {isCreator && callsBlocked ? (
        <Pressable
          style={styles.reviewBanner}
          onPress={() => router.push("/pending-approval")}
        >
          <Ionicons name="time-outline" size={18} color={theme.colors.warning} />
          <View style={{ flex: 1 }}>
            <AppText style={styles.reviewTitle}>Verification under review</AppText>
            <AppText variant="caption">
              You can use the app normally, but you cannot receive calls until
              you're approved. Tap for details.
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}

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
              Toast.show({ type: "success", text1: res.data.is_dnd ? "DND on" : "You're available" });
            }}
            style={{
              minWidth: 116,
              height: 44,
              backgroundColor: dnd ? theme.colors.dnd : theme.colors.brand,
            }}
          />
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={theme.colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search name, category, language"
            placeholderTextColor={theme.colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable style={styles.filterBtn} onPress={() => setSheetOpen(true)}>
          <Ionicons name="options-outline" size={20} color={activeFilterCount ? "#fff" : theme.colors.text} />
          {activeFilterCount > 0 ? (
            <View style={styles.filterCount}>
              <AppText style={styles.filterCountText}>{activeFilterCount}</AppText>
            </View>
          ) : null}
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        {(["all", "active"] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => setStatus(s)}
            style={[styles.statusPill, status === s && styles.statusPillOn]}
          >
            {s === "active" ? (
              <View style={styles.liveDot} />
            ) : null}
            <AppText style={[styles.statusText, status === s && styles.statusTextOn]}>
              {s === "all" ? "All" : "Active now"}
            </AppText>
          </Pressable>
        ))}
        {(debouncedQ || activeFilterCount > 0 || status !== "all") && (
          <Pressable
            onPress={() => {
              setQuery("");
              setStatus("all");
              setFilters(EMPTY_FILTERS);
            }}
            style={styles.clearBtn}
          >
            <AppText variant="caption" color={theme.colors.brandLight}>
              Clear
            </AppText>
          </Pressable>
        )}
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
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={loadFirst} tintColor={theme.colors.brandLight} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          ListEmptyComponent={
            <EmptyState title="No creators found" subtitle="Try another search or clear filters." />
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={theme.colors.brand} style={{ marginVertical: 16 }} />
            ) : !hasMore && creators.length > 0 ? (
              <AppText variant="caption" style={{ textAlign: "center", marginTop: 12 }}>
                That's everyone for now
              </AppText>
            ) : null
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeIn.delay(Math.min(index * 30, 180)).duration(theme.motion.statusFade)}>
              <Card onPress={() => router.push(`/creator/${item.user_id}`)}>
                <View style={styles.row}>
                  <Avatar uri={item.picture} name={item.name} size={72} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.nameRow}>
                      <AppText style={styles.name} numberOfLines={1}>
                        {item.name || "Creator"}
                      </AppText>
                      {item.status === "ACTIVE" ? <View style={styles.liveDot} /> : null}
                    </View>
                    <StatusDot status={item.status} />
                    <AppText variant="caption" style={{ marginTop: 6 }}>
                      ₹{item.audio_rate_per_minute}/min audio · ₹{item.video_rate_per_minute}/min video
                    </AppText>
                    {item.avg_rating != null ? (
                      <View style={styles.ratingChip}>
                        <Ionicons name="star" size={12} color={theme.colors.accentDeep} />
                        <AppText style={styles.ratingText}>
                          {item.avg_rating} · {item.review_count}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
                </View>
              </Card>
            </Animated.View>
          )}
        />
      )}

      <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheetOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <AppText style={styles.sheetTitle}>Filters</AppText>

            <AppText variant="label" style={styles.sheetLabel}>Sort by</AppText>
            <View style={styles.chips}>
              {SORTS.map((s) => (
                <Chip
                  key={s.id}
                  label={s.label}
                  on={filters.sort === s.id}
                  onPress={() => setFilters((f) => ({ ...f, sort: s.id }))}
                />
              ))}
            </View>

            <AppText variant="label" style={styles.sheetLabel}>Gender</AppText>
            <View style={styles.chips}>
              <Chip label="Any" on={!filters.gender} onPress={() => setFilters((f) => ({ ...f, gender: "" }))} />
              {genderOptions.map((g) => (
                <Chip
                  key={g}
                  label={g}
                  on={filters.gender === g}
                  onPress={() => setFilters((f) => ({ ...f, gender: f.gender === g ? "" : g }))}
                />
              ))}
            </View>

            <AppText variant="label" style={styles.sheetLabel}>Language</AppText>
            <ScrollView style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false}>
              <View style={styles.chips}>
                <Chip label="Any" on={!filters.language} onPress={() => setFilters((f) => ({ ...f, language: "" }))} />
                {languageOptions.map((l) => (
                  <Chip
                    key={l}
                    label={l}
                    on={filters.language === l}
                    onPress={() => setFilters((f) => ({ ...f, language: f.language === l ? "" : l }))}
                  />
                ))}
              </View>
            </ScrollView>

            <View style={styles.sheetActions}>
              <PrimaryButton
                label="Reset"
                variant="ghost"
                onPress={() => setFilters(EMPTY_FILTERS)}
                style={{ flex: 1 }}
              />
              <PrimaryButton label="Show results" onPress={() => setSheetOpen(false)} style={{ flex: 1 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <AppText style={{ color: on ? theme.colors.onBrand : theme.colors.text, fontSize: 13 }}>{label}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  title: { fontFamily: theme.font.display, fontSize: 30, color: theme.colors.text, letterSpacing: -0.6 },
  bell: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: theme.colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeText: { color: "#fff", fontSize: 10, fontFamily: theme.font.bodyBold },
  creatorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 16,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  earnSmall: { fontFamily: theme.font.display, fontSize: 26, color: theme.colors.text, marginTop: 2 },
  reviewBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 14,
    borderRadius: theme.radius.lg,
    backgroundColor: "rgba(217,119,6,0.12)",
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.35)",
  },
  reviewTitle: { fontFamily: theme.font.bodySemi, color: theme.colors.text, marginBottom: 2 },
  searchRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20 },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.backgroundElevated,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: theme.colors.text, fontFamily: theme.font.body, fontSize: 15 },
  filterBtn: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCount: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: 8,
    backgroundColor: theme.colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  filterCountText: { fontSize: 10, color: theme.colors.background, fontFamily: theme.font.bodyBold },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statusPillOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  statusText: { fontFamily: theme.font.bodySemi, color: theme.colors.textSecondary, fontSize: 13 },
  statusTextOn: { color: theme.colors.onBrand },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.online },
  clearBtn: { marginLeft: "auto", paddingHorizontal: 8, paddingVertical: 6 },
  row: { flexDirection: "row", gap: 14, alignItems: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontFamily: theme.font.bodyBold, fontSize: 17, color: theme.colors.text, marginBottom: 4 },
  ratingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 6,
    backgroundColor: "rgba(217,119,87,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  ratingText: { fontFamily: theme.font.bodyBold, fontSize: 12, color: theme.colors.accentDeep },
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    backgroundColor: theme.colors.backgroundElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
    marginBottom: 16,
  },
  sheetTitle: { fontFamily: theme.font.displayMedium, fontSize: 22, color: theme.colors.text },
  sheetLabel: { marginTop: 20, marginBottom: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 26 },
});
