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
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Animated, { FadeInDown } from "react-native-reanimated";
import Toast from "react-native-toast-message";
import { creatorsAPI, callsAPI, moderationAPI } from "../../src/services/api";
import { StatusDot } from "../../src/components/StatusDot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import { ensureCallPermissions } from "../../src/services/permissions";
import { ensureCallDisclaimer } from "../../src/services/callDisclaimer";

const LAST_RATE_KEY = "last_viewed_audio_rate";
const H = Dimensions.get("window").height;
const W = Dimensions.get("window").width;

const REPORT_REASONS = [
  "Inappropriate content",
  "Fake profile",
  "Harassment",
  "Spam",
  "Other",
];

export default function CreatorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [creator, setCreator] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [followBusy, setFollowBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const load = async () => {
    const r = await creatorsAPI.get(String(id));
    const c = r.data.creator;
    setCreator(c);
    if (c?.audio_rate_per_minute) {
      AsyncStorage.setItem(LAST_RATE_KEY, String(c.audio_rate_per_minute));
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, [id]);

  const photos = useMemo(() => {
    if (!creator) return [];
    const imgs = [...(creator.images || [])];
    if (creator.picture && !imgs.includes(creator.picture)) imgs.unshift(creator.picture);
    if (!imgs.length) imgs.push(`https://i.pravatar.cc/800?u=${creator.user_id}`);
    return imgs;
  }, [creator]);

  const unavailable = creator && ["DND", "BUSY"].includes(creator.status);
  const offline = creator?.status === "OFFLINE";
  const isFollowing = !!creator?.is_following;

  const toggleFollow = async () => {
    if (!creator || followBusy) return;
    setFollowBusy(true);
    const next = !isFollowing;
    setCreator((c: any) => ({ ...c, is_following: next }));
    try {
      if (next) await creatorsAPI.follow(creator.user_id);
      else await creatorsAPI.unfollow(creator.user_id);
      Toast.show({
        type: "success",
        text1: next ? "Following!" : "Unfollowed",
        text2: next ? "You'll be notified when they come online" : undefined,
      });
    } catch {
      setCreator((c: any) => ({ ...c, is_following: !next }));
      Toast.show({ type: "error", text1: "Could not update follow" });
    } finally {
      setFollowBusy(false);
    }
  };

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

  const block = () => {
    setMenuOpen(false);
    Alert.alert(`Block ${creator?.name}?`, "They won't be able to call you or view your profile.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await moderationAPI.blockUser(String(id));
            Toast.show({ type: "success", text1: "User blocked" });
            router.back();
          } catch {
            Toast.show({ type: "error", text1: "Could not block" });
          }
        },
      },
    ]);
  };

  const submitReport = async (reason: string) => {
    setReportOpen(false);
    try {
      await moderationAPI.reportUser(String(id), reason);
      Toast.show({ type: "success", text1: "Report submitted", text2: "We'll review it within 24 hours." });
    } catch {
      Toast.show({ type: "error", text1: "Could not report" });
    }
  };

  if (!creator) {
    return (
      <View style={styles.wrap}>
        <AppText color={theme.colors.textMuted} style={{ margin: 24 }}>
          Loading…
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => router.back()} style={styles.backFab} hitSlop={8}>
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </Pressable>
      <Pressable onPress={() => setMenuOpen(true)} style={styles.menuFab} hitSlop={8}>
        <Ionicons name="ellipsis-vertical" size={20} color="#fff" />
      </Pressable>

      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
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
          style={{ height: Math.min(H * 0.5, 440) }}
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
            <View style={{ flex: 1 }}>
              <AppText style={styles.name}>{creator.name}</AppText>
              {creator.username ? (
                <AppText variant="caption">@{creator.username}</AppText>
              ) : null}
            </View>
            <Pressable
              onPress={toggleFollow}
              disabled={followBusy}
              style={[styles.followBtn, isFollowing && styles.followingBtn]}
            >
              <Ionicons
                name={isFollowing ? "heart" : "heart-outline"}
                size={16}
                color={isFollowing ? theme.colors.error : "#fff"}
              />
              <AppText style={[styles.followText, isFollowing && { color: theme.colors.error }]}>
                {isFollowing ? "Following" : "Follow"}
              </AppText>
            </Pressable>
          </View>

          <View style={styles.badgeRow}>
            <StatusDot status={creator.status} />
            {creator.is_approved ? (
              <View style={styles.verified}>
                <Ionicons name="checkmark-circle" size={13} color="#fff" />
                <AppText style={styles.verifiedText}>Verified</AppText>
              </View>
            ) : null}
          </View>

          {!isFollowing ? (
            <View style={styles.followHint}>
              <Ionicons name="notifications-outline" size={15} color={theme.colors.brandLight} />
              <AppText variant="caption" color={theme.colors.brandLight}>
                Follow to get notified when they come online
              </AppText>
            </View>
          ) : null}

          {creator.bio ? (
            <AppText variant="subtitle" style={{ marginTop: 14 }}>
              {creator.bio}
            </AppText>
          ) : null}

          {/* Tags: category, gender, languages */}
          <View style={styles.tags}>
            {creator.category ? (
              <View style={[styles.tag, styles.tagCategory]}>
                <Ionicons name="pricetag" size={12} color={theme.colors.brandLight} />
                <AppText style={[styles.tagText, { color: theme.colors.brandLight }]}>
                  {creator.category}
                </AppText>
              </View>
            ) : null}
            {creator.gender ? (
              <View style={styles.tag}>
                <Ionicons name="person" size={12} color={theme.colors.textSecondary} />
                <AppText style={styles.tagText}>{creator.gender}</AppText>
              </View>
            ) : null}
            {(creator.languages || []).map((lang: string) => (
              <View key={lang} style={styles.tag}>
                <Ionicons name="language" size={12} color={theme.colors.textSecondary} />
                <AppText style={styles.tagText}>{lang}</AppText>
              </View>
            ))}
          </View>

          {/* Rating */}
          {creator.avg_rating != null ? (
            <View style={styles.ratingRow}>
              <Ionicons name="star" size={16} color="#FFD700" />
              <AppText style={styles.rating}>
                {creator.avg_rating} · {creator.review_count}{" "}
                {creator.review_count === 1 ? "review" : "reviews"}
              </AppText>
            </View>
          ) : null}

          {/* Gallery thumbnails */}
          {photos.length > 1 ? (
            <View style={styles.galleryCard}>
              <AppText variant="label">Gallery</AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, marginTop: 10 }}>
                {photos.map((img, index) => (
                  <Pressable
                    key={`${img}-${index}`}
                    onPress={() => setPhotoIdx(index)}
                    style={[styles.thumbWrap, photoIdx === index && styles.thumbWrapOn]}
                  >
                    <Image source={{ uri: img }} style={styles.thumb} />
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Call rates */}
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

          {/* Policy disclaimer */}
          <View style={styles.disclaimer}>
            <Ionicons name="warning" size={16} color={theme.colors.warning} />
            <AppText variant="caption" style={{ flex: 1, lineHeight: 18 }}>
              Abuse, nudity, or illegal activity is strictly prohibited. Violations result in a ban.
            </AppText>
          </View>

          {/* Reviews */}
          {(creator.recent_reviews || []).length > 0 ? (
            <View style={{ marginTop: 24 }}>
              <View style={styles.reviewHead}>
                <AppText variant="label">Recent reviews</AppText>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: "/reviews", params: { id: String(id), name: creator.name || "" } })
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

      {/* Moderation options */}
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Pressable
              style={styles.sheetOption}
              onPress={() => {
                setMenuOpen(false);
                setTimeout(() => setReportOpen(true), 250);
              }}
            >
              <Ionicons name="flag-outline" size={22} color={theme.colors.warning} />
              <AppText style={[styles.sheetOptionText, { color: theme.colors.warning }]}>Report user</AppText>
            </Pressable>
            <Pressable style={styles.sheetOption} onPress={block}>
              <Ionicons name="ban-outline" size={22} color={theme.colors.error} />
              <AppText style={[styles.sheetOptionText, { color: theme.colors.error }]}>Block user</AppText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Report reasons */}
      <Modal visible={reportOpen} transparent animationType="slide" onRequestClose={() => setReportOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setReportOpen(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <AppText style={styles.sheetTitle}>Why are you reporting?</AppText>
            <AppText variant="caption" style={{ marginBottom: 12 }}>
              Select a reason to help us review faster.
            </AppText>
            {REPORT_REASONS.map((reason) => (
              <Pressable key={reason} style={styles.sheetOption} onPress={() => submitReport(reason)}>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.textSecondary} />
                <AppText style={styles.sheetOptionText}>{reason}</AppText>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
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
  menuFab: {
    position: "absolute",
    top: 48,
    right: 16,
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
  hero: { width: W, height: Math.min(H * 0.5, 440), backgroundColor: theme.colors.brandDark },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: -18,
    marginBottom: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.45)" },
  dotOn: { backgroundColor: theme.colors.onBrand },
  body: {
    padding: 24,
    marginTop: -20,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  name: {
    fontFamily: theme.font.display,
    fontSize: 30,
    color: theme.colors.text,
    letterSpacing: -0.6,
  },
  followBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.brand,
  },
  followingBtn: { backgroundColor: "rgba(239,68,68,0.12)" },
  followText: { fontFamily: theme.font.bodyBold, color: "#fff", fontSize: 14 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  verified: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: theme.colors.success,
  },
  verifiedText: { color: "#fff", fontFamily: theme.font.bodyBold, fontSize: 11 },
  followHint: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  tagCategory: { borderColor: "rgba(45,212,191,0.4)" },
  tagText: { fontFamily: theme.font.bodySemi, fontSize: 12, color: theme.colors.textSecondary },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 16 },
  rating: { fontFamily: theme.font.bodyBold, color: theme.colors.accentDeep },
  galleryCard: {
    marginTop: 20,
    padding: 16,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  thumbWrap: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "transparent",
    overflow: "hidden",
  },
  thumbWrapOn: { borderColor: theme.colors.brandLight },
  thumb: { width: 84, height: 84, borderRadius: 10, backgroundColor: theme.colors.backgroundElevated },
  rates: { flexDirection: "row", gap: 10, marginTop: 20 },
  rateCard: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 14,
    gap: 4,
  },
  rateVal: { fontFamily: theme.font.display, fontSize: 22, color: theme.colors.text, marginTop: 4 },
  disclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 18,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(217,119,6,0.1)",
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.25)",
  },
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
  sheetTitle: { fontFamily: theme.font.displayMedium, fontSize: 20, color: theme.colors.text },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
  sheetOptionText: { fontFamily: theme.font.bodySemi, fontSize: 16, color: theme.colors.text },
});
