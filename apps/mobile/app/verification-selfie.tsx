import { useEffect, useRef, useState } from "react";
import { View, StyleSheet, Image, ActivityIndicator, Pressable } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Toast from "react-native-toast-message";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";
import { creatorsAPI } from "../src/services/api";

export default function VerificationSelfie() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const camRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [gestureNumber, setGestureNumber] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);

  useEffect(() => {
    creatorsAPI
      .startVerification()
      .then((res) => {
        setVerificationId(res.data.verification_id);
        setGestureNumber(res.data.gesture_number);
      })
      .catch((e: any) => {
        const detail = e?.response?.data?.detail || "Could not start verification";
        Toast.show({ type: "error", text1: detail });
        if (String(detail).toLowerCase().includes("already verified")) {
          router.replace("/(tabs)/browse");
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const capture = async () => {
    if (!camRef.current) return;
    const shot = await camRef.current.takePictureAsync({ quality: 0.7, base64: true });
    if (shot?.uri) setPreview(shot.uri);
    if (shot?.base64) setBase64(`data:image/jpeg;base64,${shot.base64}`);
  };

  const submit = async () => {
    if (!base64 || !verificationId) {
      Toast.show({ type: "error", text1: "Capture a live selfie first" });
      return;
    }
    setSubmitting(true);
    try {
      await creatorsAPI.submitVerificationSelfie(verificationId, base64);
      Toast.show({ type: "success", text1: "Submitted for review" });
      router.replace("/pending-approval");
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Upload failed", text2: e?.response?.data?.detail });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brandLight} />
        <AppText style={{ marginTop: 12 }}>Setting up verification…</AppText>
      </View>
    );
  }

  if (!permission?.granted) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <AppText variant="title">Camera access needed</AppText>
        <AppText variant="subtitle" style={{ marginTop: 8, textAlign: "center" }}>
          We need the camera for a live selfie that shows your face and fingers.
        </AppText>
        <PrimaryButton label="Grant camera" onPress={requestPermission} style={{ marginTop: 20 }} />
      </View>
    );
  }

  const fingers = `${gestureNumber} finger${gestureNumber === 1 ? "" : "s"}`;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 16) }]}>
      <Pressable onPress={() => router.replace("/creator-photos")} style={styles.back}>
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </Pressable>
      <AppText variant="caption" color={theme.colors.accent} style={{ marginTop: 10 }}>
        Selfie · 4 of 4
      </AppText>
      <AppText variant="title" style={{ marginTop: 4 }}>
        {preview ? "Check the gesture" : `Hold up ${fingers}`}
      </AppText>
      <AppText variant="subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
        Face and fingers both need to be in the frame. This photo is only for review.
      </AppText>

      <View style={styles.stage}>
        {preview ? (
          <Image source={{ uri: preview }} style={styles.preview} />
        ) : (
          <CameraView ref={camRef} style={styles.preview} facing="front" />
        )}
        <View style={styles.overlay} pointerEvents="none">
          <AppText style={styles.overlayNum}>{gestureNumber || "–"}</AppText>
          <AppText style={styles.overlayLabel}>
            {gestureNumber === 1 ? "1 finger" : `${gestureNumber} fingers`}
          </AppText>
        </View>
      </View>

      <View style={styles.row}>
        {preview ? (
          <>
            <PrimaryButton
              label="Retake"
              variant="ghost"
              onPress={() => {
                setPreview(null);
                setBase64(null);
              }}
              style={{ flex: 1 }}
            />
            <PrimaryButton label="Submit" onPress={submit} loading={submitting} style={{ flex: 1 }} />
          </>
        ) : (
          <PrimaryButton label="Take selfie" onPress={capture} disabled={!gestureNumber} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 20 },
  center: { flex: 1, backgroundColor: theme.colors.background, alignItems: "center", justifyContent: "center" },
  back: {
    alignSelf: "flex-start",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stage: { flex: 1, borderRadius: 24, overflow: "hidden", backgroundColor: "#000", minHeight: 320 },
  preview: { flex: 1 },
  overlay: {
    position: "absolute",
    top: 16,
    alignSelf: "center",
    backgroundColor: "rgba(7,13,12,0.72)",
    borderRadius: 20,
    paddingHorizontal: 22,
    paddingVertical: 10,
    alignItems: "center",
  },
  overlayNum: { fontFamily: theme.font.display, fontSize: 56, color: theme.colors.accent, lineHeight: 60 },
  overlayLabel: { color: theme.colors.text, fontFamily: theme.font.bodySemi },
  row: { flexDirection: "row", gap: 12, marginTop: 16 },
});
