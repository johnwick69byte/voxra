import { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  Alert,
  Dimensions,
  ScrollView,
  FlatList,
  Pressable,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, { FadeInDown } from "react-native-reanimated";
import Toast from "react-native-toast-message";
import { creatorsAPI, callsAPI, favoritesAPI } from "../../src/services/api";
import { StatusDot } from "../../src/components/StatusDot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import { ensureCallPermissions } from "../../src/services/permissions";
import { ensureCallDisclaimer } from "../../src/services/callDisclaimer";

const LAST_RATE_KEY = "last_viewed_audio_rate";
const H = Dimensions.get("window").height;
const W = Dimensions.get("window").width;

export default function CreatorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [creator, setCreator] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [isFavorite, setIsFavorite] = useState(false);

  useEffect(() => {
    creatorsAPI.get(String(id)).then((r) => {
      const c = r.data.creator;
      setCreator(c);
      if (c?.audio_rate_per_minute) {
        AsyncStorage.setItem(LAST_RATE_KEY, String(c.audio_rate_per_minute));
      }
    });
    favoritesAPI
      .check(String(id))
      .then((r) => setIsFavorite(!!r.data.is_favorite))
      .catch(() => {});
  }, [id]);

  const toggleFavorite = async () => {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      if (next) await favoritesAPI.add(String(id));
      else await favoritesAPI.remove(String(id));
    } catch {
      setIsFavorite(!next);
      Toast.show({ type: "error", text1: "Could not update favorites" });
    }
  };

  const photos = useMemo(() => {
    if (!creator) return [];
    const imgs = [...(creator.images || [])];
    if (creator.picture && !imgs.includes(creator.picture)) imgs.unshift(creator.picture);
    if (!imgs.length) imgs.push(`https://i.pravatar.cc/800?u=${creator.user_id}`);
    return imgs;
  }, [creator]);

  const unavailable = creator && ["DND", "BUSY"].includes(creator.status);
  const offline = creator?.status === "OFFLINE";

  const startCall = async (call_type: "AUDIO" | "VIDEO") => {
    if (unavailable) return;
    const agreed = await ensureCallDisclaimer();
    if (!agreed) return;
    const ok = await ensureCallPermissions(call_type === "VIDEO");
    if (!ok) return;
    setLoading(true);
    try {
      const status = await creatorsAPI.status(String(id));
      if (!status.data.available || ["DND", "BUSY"].includes(status.data.status)) {
        Alert.alert("Unavailable", status.data.reason || "Creator is not available");
        return;
      }
      const res = await callsAPI.initiate(String(id), call_type);
      router.push({
        pathname: "/call-screen",
        params: {
          callId: res.data.call_id,
          channelName: res.data.channel_name,
          callType: call_type,
          role: "caller",
          peerName: creator?.name || "Creator",
          peerId: String(id),
        },
      });
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Cannot start call",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  if (!creator) {
    return (
      <View style={styles.wrap}>
        <AppText color={theme.colors.textMuted}>Loading…</AppText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => router.back()} style={styles.backFab} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Pressable>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
        <FlatList
          data={photos}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(uri, i) => `${uri}-${i}`}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / W);
            setPhotoIdx(idx);
          }}
          renderItem={({ item }) => <Image source={{ uri: item }} style={styles.hero} />}
          style={{ height: Math.min(H * 0.48, 420) }}
        />
        {photos.length > 1 ? (
          <View style={styles.dots}>
            {photos.map((_, i) => (
              <View key={i} style={[styles.dot, i === photoIdx && styles.dotOn]} />
            ))}
          </View>
        ) : null}

        <Animated.View entering={FadeInDown.duration(380)} style={styles.body}>
          <View style={styles.nameRow}>
            <AppText style={styles.name}>{creator.name}</AppText>
            <StatusDot status={creator.status} />
          </View>
          {creator.avg_rating != null && (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={16} color={theme.colors.accent} />
              <AppText style={styles.rating}>
                {creator.avg_rating} · {creator.review_count} reviews
              </AppText>
            </View>
          )}
          <AppText variant="subtitle" style={{ marginTop: 12 }}>
            {creator.bio || "Instant audio & video calls."}
          </AppText>

          <View style={styles.rates}>
            <View style={styles.rateCard}>
              <Ionicons name="call" size={18} color={theme.colors.brandLight} />
              <AppText style={styles.rateVal}>₹{creator.audio_rate_per_minute}</AppText>
              <AppText variant="caption">Audio / min</AppText>
            </View>
            <View style={styles.rateCard}>
              <Ionicons name="videocam" size={18} color={theme.colors.accent} />
              <AppText style={styles.rateVal}>₹{creator.video_rate_per_minute}</AppText>
              <AppText variant="caption">Video / min</AppText>
            </View>
          </View>
          <AppText variant="caption" style={{ marginTop: 8 }}>
            Creator receives ~85% after the platform fee
          </AppText>

          <View style={styles.secondaryRow}>
            <PrimaryButton
              label={creator.is_following ? "Following" : "Follow"}
              variant="ghost"
              onPress={async () => {
                if (creator.is_following) await creatorsAPI.unfollow(creator.user_id);
                else await creatorsAPI.follow(creator.user_id);
                const r = await creatorsAPI.get(String(id));
                setCreator(r.data.creator);
              }}
              style={{ flex: 1 }}
            />
            <PrimaryButton
              label={isFavorite ? "♥ Saved" : "♡ Save"}
              variant="ghost"
              onPress={toggleFavorite}
              style={{ flex: 1 }}
            />
          </View>

          {(creator.recent_reviews || []).length > 0 ? (
            <View style={{ marginTop: 24 }}>
              <View style={styles.reviewHead}>
                <AppText variant="label">Recent reviews</AppText>
                <Pressable
                  onPress={() =>
                    router.push({
                      pathname: "/reviews",
                      params: { id: String(id), name: creator.name || "" },
                    })
                  }
                >
                  <AppText variant="caption" color={theme.colors.brandLight}>
                    See all
                  </AppText>
                </Pressable>
              </View>
              {(creator.recent_reviews || []).slice(0, 5).map((r: any, i: number) => (
                <View key={r.call_id || i} style={styles.reviewRow}>
                  <AppText style={styles.reviewStars}>{"★".repeat(r.rating || 0)}</AppText>
                  <AppText variant="caption">{r.comment || "No comment"}</AppText>
                </View>
              ))}
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>

      <View style={styles.sticky}>
        {unavailable ? (
          <AppText style={styles.unavail}>
            {creator.status === "BUSY" ? "Creator is on another call" : "Do not disturb"}
          </AppText>
        ) : offline ? (
          <AppText style={styles.unavail}>Offline — they will get a call notification</AppText>
        ) : null}
        <View style={styles.actions}>
          <PrimaryButton
            label={`Audio · ₹${creator.audio_rate_per_minute}`}
            onPress={() => startCall("AUDIO")}
            loading={loading}
            disabled={!!unavailable}
            style={{ flex: 1, opacity: unavailable ? 0.45 : 1 }}
          />
          <PrimaryButton
            label={`Video · ₹${creator.video_rate_per_minute}`}
            onPress={() => startCall("VIDEO")}
            loading={loading}
            disabled={!!unavailable}
            style={{ flex: 1, opacity: unavailable ? 0.45 : 1 }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  backFab: {
    position: "absolute",
    top: 48,
    left: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(7,13,12,0.7)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  hero: {
    width: W,
    height: Math.min(H * 0.48, 420),
    backgroundColor: theme.colors.brandDark,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: -18,
    marginBottom: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.45)",
  },
  dotOn: { backgroundColor: theme.colors.onBrand },
  body: {
    padding: 24,
    marginTop: -20,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  name: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.text,
    letterSpacing: -0.6,
  },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  rating: {
    fontFamily: theme.font.bodyBold,
    color: theme.colors.accentDeep,
  },
  rates: { flexDirection: "row", gap: 10, marginTop: 16 },
  rateCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 4,
  },
  rateVal: {
    fontFamily: theme.font.display,
    fontSize: 22,
    color: theme.colors.text,
    marginTop: 4,
  },
  rateLine: {
    fontFamily: theme.font.bodySemi,
    color: theme.colors.text,
    fontSize: 16,
  },
  secondaryRow: { flexDirection: "row", gap: 10, marginTop: 20 },
  reviewHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  reviewRow: {
    marginTop: 10,
    padding: 12,
    backgroundColor: theme.colors.backgroundElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  reviewStars: { color: theme.colors.accent, marginBottom: 4 },
  sticky: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: 28,
    backgroundColor: "rgba(7,13,12,0.94)",
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  unavail: {
    textAlign: "center",
    marginBottom: 8,
    fontFamily: theme.font.bodySemi,
    color: theme.colors.warning,
  },
  actions: { flexDirection: "row", gap: 10 },
});
