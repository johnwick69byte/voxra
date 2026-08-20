import { useEffect, useMemo, useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  Alert,
  Dimensions,
  ScrollView,
  FlatList,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, { FadeInDown } from "react-native-reanimated";
import Toast from "react-native-toast-message";
import { creatorsAPI, callsAPI } from "../../src/services/api";
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

  useEffect(() => {
    creatorsAPI.get(String(id)).then((r) => {
      const c = r.data.creator;
      setCreator(c);
      if (c?.audio_rate_per_minute) {
        AsyncStorage.setItem(LAST_RATE_KEY, String(c.audio_rate_per_minute));
      }
    });
  }, [id]);

  const photos = useMemo(() => {
    if (!creator) return [];
    const imgs = [...(creator.images || [])];
    if (creator.picture && !imgs.includes(creator.picture)) imgs.unshift(creator.picture);
    if (!imgs.length) imgs.push(`https://i.pravatar.cc/800?u=${creator.user_id}`);
    return imgs;
  }, [creator]);

  const unavailable = creator && ["DND", "BUSY", "OFFLINE"].includes(creator.status);

  const startCall = async (call_type: "AUDIO" | "VIDEO") => {
    const agreed = await ensureCallDisclaimer();
    if (!agreed) return;
    const ok = await ensureCallPermissions(call_type === "VIDEO");
    if (!ok) {
      Toast.show({ type: "error", text1: "Permissions required for calls" });
      return;
    }
    setLoading(true);
    try {
      const status = await creatorsAPI.status(String(id));
      if (!status.data.available || ["DND", "BUSY", "OFFLINE"].includes(status.data.status)) {
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
          <AppText style={styles.name}>{creator.name}</AppText>
          <StatusDot status={creator.status} />
          {creator.avg_rating != null && (
            <AppText style={styles.rating}>
              ★ {creator.avg_rating} ({creator.review_count} reviews)
            </AppText>
          )}
          <AppText variant="subtitle" style={{ marginTop: 10 }}>
            {creator.bio || "Instant audio & video calls."}
          </AppText>
          <View style={styles.rates}>
            <AppText style={styles.rateLine}>Audio ₹{creator.audio_rate_per_minute}/min</AppText>
            <AppText style={styles.rateLine}>Video ₹{creator.video_rate_per_minute}/min</AppText>
            <AppText variant="caption" style={{ marginTop: 6 }}>
              Creator receives ~85% after platform fee
            </AppText>
          </View>

          {(creator.recent_reviews || []).length > 0 ? (
            <View style={{ marginTop: 24 }}>
              <AppText variant="label">Recent reviews</AppText>
              {(creator.recent_reviews || []).slice(0, 5).map((r: any, i: number) => (
                <View key={r.call_id || i} style={styles.reviewRow}>
                  <AppText style={styles.reviewStars}>{"★".repeat(r.rating || 0)}</AppText>
                  <AppText variant="caption">{r.comment || "No comment"}</AppText>
                </View>
              ))}
            </View>
          ) : null}

          <PrimaryButton
            label={creator.is_following ? "Following" : "Follow"}
            variant="ghost"
            onPress={async () => {
              if (creator.is_following) await creatorsAPI.unfollow(creator.user_id);
              else await creatorsAPI.follow(creator.user_id);
              const r = await creatorsAPI.get(String(id));
              setCreator(r.data.creator);
            }}
            style={{ marginTop: 20 }}
          />
        </Animated.View>
      </ScrollView>

      <View style={styles.sticky}>
        {unavailable ? (
          <AppText style={styles.unavail}>
            {creator.status === "BUSY"
              ? "Creator is on another call"
              : creator.status === "DND"
                ? "Do not disturb"
                : "Creator is offline"}
          </AppText>
        ) : null}
        <View style={styles.actions}>
          <PrimaryButton
            label={`Audio · ₹${creator.audio_rate_per_minute}`}
            onPress={() => startCall("AUDIO")}
            loading={loading}
            style={{ flex: 1, opacity: unavailable ? 0.45 : 1 }}
          />
          <PrimaryButton
            label={`Video · ₹${creator.video_rate_per_minute}`}
            onPress={() => startCall("VIDEO")}
            loading={loading}
            style={{ flex: 1, opacity: unavailable ? 0.45 : 1 }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
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
  dotOn: { backgroundColor: "#fff" },
  body: {
    padding: 24,
    marginTop: -20,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  name: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.text,
    letterSpacing: -0.6,
  },
  rating: {
    marginTop: 8,
    fontFamily: theme.font.bodyBold,
    color: theme.colors.accentDeep,
  },
  rates: { marginTop: 16, gap: 4 },
  rateLine: {
    fontFamily: theme.font.bodySemi,
    color: theme.colors.text,
    fontSize: 16,
  },
  reviewRow: {
    marginTop: 10,
    padding: 12,
    backgroundColor: "#fff",
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
    backgroundColor: "rgba(247,244,239,0.96)",
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
