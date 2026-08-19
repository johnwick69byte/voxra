import { useEffect, useState } from "react";
import { View, StyleSheet, Image, Alert, Dimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Toast from "react-native-toast-message";
import { creatorsAPI, callsAPI } from "../../src/services/api";
import { StatusDot } from "../../src/components/StatusDot";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import { ensureCallPermissions } from "../../src/services/permissions";

const LAST_RATE_KEY = "last_viewed_audio_rate";
const H = Dimensions.get("window").height;

export default function CreatorProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [creator, setCreator] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    creatorsAPI.get(String(id)).then((r) => {
      const c = r.data.creator;
      setCreator(c);
      if (c?.audio_rate_per_minute) {
        AsyncStorage.setItem(LAST_RATE_KEY, String(c.audio_rate_per_minute));
      }
    });
  }, [id]);

  const startCall = async (call_type: "AUDIO" | "VIDEO") => {
    const ok = await ensureCallPermissions(call_type === "VIDEO");
    if (!ok) {
      Toast.show({ type: "error", text1: "Permissions required for calls" });
      return;
    }
    setLoading(true);
    try {
      const status = await creatorsAPI.status(String(id));
      if (status.data.status === "DND" || status.data.status === "BUSY") {
        Alert.alert("Unavailable", status.data.reason || "Creator is busy");
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
      <Image
        source={{ uri: creator.picture || "https://i.pravatar.cc/800?u=" + creator.user_id }}
        style={styles.hero}
      />
      <View style={styles.body}>
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
        </View>
        <View style={styles.actions}>
          <PrimaryButton
            label="Audio call"
            onPress={() => startCall("AUDIO")}
            loading={loading}
            style={{ flex: 1 }}
          />
          <PrimaryButton
            label="Video call"
            onPress={() => startCall("VIDEO")}
            loading={loading}
            style={{ flex: 1 }}
          />
        </View>
        <PrimaryButton
          label={creator.is_following ? "Following" : "Follow"}
          variant="ghost"
          onPress={async () => {
            if (creator.is_following) await creatorsAPI.unfollow(creator.user_id);
            else await creatorsAPI.follow(creator.user_id);
            const r = await creatorsAPI.get(String(id));
            setCreator(r.data.creator);
          }}
          style={{ marginTop: 12 }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background },
  hero: {
    width: "100%",
    height: Math.min(H * 0.48, 420),
    backgroundColor: theme.colors.brandDark,
  },
  body: {
    padding: 24,
    marginTop: -28,
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    flex: 1,
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
  actions: { flexDirection: "row", gap: 10, marginTop: 24 },
});
