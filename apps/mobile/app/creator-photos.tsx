import { useEffect, useState } from "react";
import { View, StyleSheet, Pressable, ScrollView, ActivityIndicator, Image } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";
import { creatorsAPI } from "../src/services/api";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { OnboardingChrome } from "../src/components/OnboardingChrome";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function CreatorPhotos() {
  const router = useRouter();
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    creatorsAPI
      .onboardingStatus()
      .then((res) => setImages(res.data.images || []))
      .catch(() => Toast.show({ type: "error", text1: "Could not load photos" }))
      .finally(() => setLoading(false));
  }, []);

  const pick = async () => {
    if (images.length >= 6) {
      Toast.show({ type: "error", text1: "You can add up to 6 photos" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.base64) return;
    setUploading(true);
    try {
      const res = await creatorsAPI.addImage(`data:image/jpeg;base64,${result.assets[0].base64}`);
      setImages(res.data.images || []);
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Upload failed", text2: e?.response?.data?.detail });
    } finally {
      setUploading(false);
    }
  };

  const remove = async (url: string) => {
    try {
      const res = await creatorsAPI.deleteImage(url);
      setImages(res.data.images || []);
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Could not remove photo", text2: e?.response?.data?.detail });
    }
  };

  const next = () => {
    if (!images.length) {
      Toast.show({ type: "error", text1: "Add at least one photo" });
      return;
    }
    router.replace("/verification-selfie");
  };

  return (
    <OnboardingChrome
      step={3}
      title="Profile photos"
      subtitle="Add at least one clear photo fans will see on your profile."
      onBack={() => router.replace("/pricing-setup")}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 32 }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <View style={styles.card}>
            <AppText variant="caption" color={theme.colors.textMuted}>
              {images.length} of 6 · at least 1 required
            </AppText>
            {!images.length ? (
              <AppText style={{ marginTop: 8, lineHeight: 22 }}>
                Use a clear photo of you. Fans see these on your profile before they call.
              </AppText>
            ) : null}
            <View style={styles.grid}>
              {images.map((url) => (
                <View key={url} style={styles.tile}>
                  <Image source={{ uri: url }} style={styles.photo} />
                  <Pressable style={styles.remove} onPress={() => remove(url)}>
                    <AppText color="#fff">Remove</AppText>
                  </Pressable>
                </View>
              ))}
              {images.length < 6 ? (
                <Pressable style={[styles.tile, styles.add]} onPress={pick} disabled={uploading}>
                  {uploading ? (
                    <ActivityIndicator color={theme.colors.brandLight} />
                  ) : (
                    <>
                      <AppText style={styles.addPlus}>+</AppText>
                      <AppText color={theme.colors.brandLight}>Add photo</AppText>
                    </>
                  )}
                </Pressable>
              ) : null}
            </View>
          </View>
          <PrimaryButton label="Continue" onPress={next} style={{ marginTop: 20 }} />
        </ScrollView>
      )}
    </OnboardingChrome>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    marginTop: 12,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 16 },
  tile: {
    width: "47%",
    aspectRatio: 1,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: theme.colors.backgroundElevated,
  },
  photo: { width: "100%", height: "100%" },
  add: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    gap: 4,
  },
  addPlus: { fontFamily: theme.font.display, fontSize: 32, color: theme.colors.brandLight },
  remove: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 8,
    alignItems: "center",
    paddingVertical: 6,
  },
});
