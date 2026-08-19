import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import Toast from "react-native-toast-message";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { theme } from "../src/theme/tokens";
import { ensureVerificationPermissions } from "../src/services/permissions";
import { creatorsAPI } from "../src/services/api";

export default function VerificationSelfie() {
  const router = useRouter();
  const camRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const ok = await ensureVerificationPermissions();
      if (!ok) return;
      if (!permission?.granted) await requestPermission();
      setReady(true);
    })();
  }, []);

  const capture = async () => {
    if (!camRef.current) return;
    const shot = await camRef.current.takePictureAsync({
      quality: 0.7,
      base64: true,
      skipProcessing: false,
    });
    if (shot?.uri) setPhotoUri(shot.uri);
    if (shot?.base64) setBase64(`data:image/jpeg;base64,${shot.base64}`);
  };

  const submit = async () => {
    if (!base64) {
      Toast.show({ type: "error", text1: "Capture a live selfie first" });
      return;
    }
    setLoading(true);
    try {
      await creatorsAPI.submitVerificationSelfie(base64);
      Toast.show({ type: "success", text1: "Submitted for review" });
      router.replace("/pending-approval");
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Upload failed", text2: e?.response?.data?.detail });
    } finally {
      setLoading(false);
    }
  };

  if (!ready || !permission?.granted) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Camera permission needed</Text>
        <PrimaryButton label="Grant camera" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.brand}>Voxora</Text>
      <Text style={styles.title}>Live verification selfie</Text>
      <Text style={styles.sub}>Hold still and take a clear front-facing photo. Quitting is OK — we'll bring you back here.</Text>
      {photoUri ? (
        <Image source={{ uri: photoUri }} style={styles.preview} />
      ) : (
        <CameraView ref={camRef} style={styles.preview} facing="front" />
      )}
      <View style={styles.row}>
        {photoUri ? (
          <>
            <PrimaryButton label="Retake" variant="ghost" onPress={() => { setPhotoUri(null); setBase64(null); }} style={{ flex: 1 }} />
            <PrimaryButton label="Submit" onPress={submit} loading={loading} style={{ flex: 1 }} />
          </>
        ) : (
          <PrimaryButton label="Capture" onPress={capture} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, padding: 24, paddingTop: 64 },
  brand: { fontSize: 28, fontWeight: "800", color: theme.colors.brand },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.text, marginTop: 8 },
  sub: { color: theme.colors.textSecondary, marginVertical: 12, lineHeight: 20 },
  preview: { flex: 1, borderRadius: 20, overflow: "hidden", backgroundColor: "#000", minHeight: 360 },
  row: { flexDirection: "row", gap: 12, marginTop: 16 },
});
