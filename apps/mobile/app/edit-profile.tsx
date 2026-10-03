import { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";
import { authAPI, creatorsAPI } from "../src/services/api";
import { useAuthStore } from "../src/store/authStore";
import { AppText } from "../src/components/ui";
import { theme } from "../src/theme/tokens";
import { CATEGORIES, GENDERS, LANGUAGES } from "../src/constants/creatorProfile";

export default function EditProfile() {
  const router = useRouter();
  const { user, token, setSession } = useAuthStore();
  const isCreator = user?.user_type === "creator";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [picture, setPicture] = useState<string | undefined>(user?.picture || undefined);
  const [bio, setBio] = useState("");
  const [category, setCategory] = useState("");
  const [gender, setGender] = useState<string>("Female");
  const [languages, setLanguages] = useState<string[]>([]);
  const [audioRate, setAudioRate] = useState("");
  const [videoRate, setVideoRate] = useState("");
  const [images, setImages] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await authAPI.me();
        const u = res.data.user;
        const p = res.data.creator_profile || {};
        setName(u?.name || "");
        setUsername(u?.username || "");
        setPicture(u?.picture || undefined);
        if (isCreator) {
          setBio(p.bio || "");
          setCategory(p.category || "");
          setGender(p.gender || "Female");
          setLanguages(p.languages || []);
          setAudioRate(p.audio_rate_per_minute ? String(p.audio_rate_per_minute) : "");
          setVideoRate(p.video_rate_per_minute ? String(p.video_rate_per_minute) : "");
          setImages(p.images || []);
        }
      } catch {
        Toast.show({ type: "error", text1: "Could not load profile" });
      } finally {
        setLoading(false);
      }
    })();
  }, [isCreator]);

  const toggleLanguage = (lang: string) => {
    setLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Toast.show({ type: "error", text1: "Photo permission required" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (asset.base64) setPicture(`data:image/jpeg;base64,${asset.base64}`);
    else if (asset.uri) setPicture(asset.uri);
  };

  const addGalleryImage = async () => {
    if (images.length >= 6) {
      Toast.show({ type: "error", text1: "You can add up to 6 photos" });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
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

  const removeGalleryImage = async (url: string) => {
    if (images.length <= 1) {
      Toast.show({ type: "error", text1: "Keep at least one photo" });
      return;
    }
    try {
      const res = await creatorsAPI.deleteImage(url);
      setImages(res.data.images || []);
    } catch (e: any) {
      Toast.show({ type: "error", text1: "Could not remove photo", text2: e?.response?.data?.detail });
    }
  };

  const save = async () => {
    if (name.trim().length < 2) {
      Toast.show({ type: "error", text1: "Name must be at least 2 characters" });
      return;
    }
    const payload: Record<string, unknown> = {
      name: name.trim(),
      username: username.trim() || undefined,
      picture,
    };
    if (isCreator) {
      const a = Number(audioRate);
      const v = Number(videoRate);
      if (!audioRate.trim() || Number.isNaN(a) || a < 3) {
        Toast.show({ type: "error", text1: "Audio rate must be at least ₹3/min" });
        return;
      }
      if (!videoRate.trim() || Number.isNaN(v) || v < 7) {
        Toast.show({ type: "error", text1: "Video rate must be at least ₹7/min" });
        return;
      }
      if (!category) {
        Toast.show({ type: "error", text1: "Select a category" });
        return;
      }
      if (!languages.length) {
        Toast.show({ type: "error", text1: "Select at least one language" });
        return;
      }
      Object.assign(payload, {
        bio: bio.trim(),
        category,
        gender,
        languages,
        audio_rate_per_minute: a,
        video_rate_per_minute: v,
      });
    }
    setSaving(true);
    try {
      const res = await authAPI.updateProfile(payload);
      if (token && res.data.user) await setSession(token, res.data.user);
      Toast.show({ type: "success", text1: "Profile updated" });
      router.back();
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not update",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={22} color={theme.colors.text} />
        </Pressable>
        <AppText style={styles.headerTitle}>Edit profile</AppText>
        <Pressable onPress={save} disabled={saving} style={styles.saveBtn}>
          {saving ? (
            <ActivityIndicator color={theme.colors.onBrand} size="small" />
          ) : (
            <AppText style={styles.saveText}>Save</AppText>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 48 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar + identity */}
        <View style={styles.section}>
          <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
            {picture ? (
              <Image source={{ uri: picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Ionicons name="camera" size={26} color={theme.colors.onBrand} />
              </View>
            )}
            <View style={styles.avatarEdit}>
              <Ionicons name="pencil" size={14} color="#fff" />
            </View>
          </Pressable>

          <Field label="Display name" value={name} onChangeText={setName} placeholder="Your name" />
          <Field
            label="Username"
            value={username}
            onChangeText={setUsername}
            placeholder="unique_handle"
            autoCapitalize="none"
          />
        </View>

        {isCreator ? (
          <>
            {/* Photo gallery */}
            <View style={styles.section}>
              <AppText style={styles.sectionTitle}>Photo gallery</AppText>
              <AppText variant="caption" style={{ marginBottom: 12 }}>
                {images.length} of 6 · at least 1 required
              </AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {images.map((url) => (
                  <View key={url} style={styles.galleryItem}>
                    <Image source={{ uri: url }} style={styles.galleryImg} />
                    <Pressable style={styles.galleryRemove} onPress={() => removeGalleryImage(url)}>
                      <Ionicons name="close-circle" size={24} color={theme.colors.error} />
                    </Pressable>
                  </View>
                ))}
                {images.length < 6 ? (
                  <Pressable style={styles.galleryAdd} onPress={addGalleryImage} disabled={uploading}>
                    {uploading ? (
                      <ActivityIndicator color={theme.colors.brandLight} />
                    ) : (
                      <>
                        <Ionicons name="add" size={28} color={theme.colors.brandLight} />
                        <AppText variant="caption" color={theme.colors.brandLight}>
                          Add
                        </AppText>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </ScrollView>
            </View>

            {/* Bio */}
            <View style={styles.section}>
              <AppText style={styles.sectionTitle}>About me</AppText>
              <TextInput
                style={[styles.input, styles.bio]}
                value={bio}
                onChangeText={setBio}
                placeholder="Tell your fans about yourself…"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                textAlignVertical="top"
              />
            </View>

            {/* Category */}
            <View style={styles.section}>
              <AppText style={styles.sectionTitle}>Category</AppText>
              <View style={styles.chips}>
                {CATEGORIES.map((c) => (
                  <Chip key={c} label={c} on={category === c} onPress={() => setCategory(c)} />
                ))}
              </View>
            </View>

            {/* Gender */}
            <View style={styles.section}>
              <AppText style={styles.sectionTitle}>Gender</AppText>
              <View style={styles.chips}>
                {GENDERS.map((g) => (
                  <Chip key={g} label={g} on={gender === g} onPress={() => setGender(g)} />
                ))}
              </View>
            </View>

            {/* Languages */}
            <View style={styles.section}>
              <AppText style={styles.sectionTitle}>Languages spoken</AppText>
              <View style={styles.chips}>
                {LANGUAGES.map((l) => (
                  <Chip key={l} label={l} on={languages.includes(l)} onPress={() => toggleLanguage(l)} />
                ))}
              </View>
            </View>

            {/* Rates */}
            <View style={styles.section}>
              <AppText style={styles.sectionTitle}>Call rates</AppText>
              <View style={styles.ratesRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" style={{ marginBottom: 6 }}>
                    Audio (min ₹3)
                  </AppText>
                  <View style={styles.rateInputWrap}>
                    <AppText style={styles.rupee}>₹</AppText>
                    <TextInput
                      style={styles.rateInput}
                      value={audioRate}
                      onChangeText={(t) => setAudioRate(t.replace(/[^0-9.]/g, ""))}
                      keyboardType="decimal-pad"
                      placeholder="3"
                      placeholderTextColor={theme.colors.textMuted}
                    />
                    <AppText variant="caption">/min</AppText>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="caption" style={{ marginBottom: 6 }}>
                    Video (min ₹7)
                  </AppText>
                  <View style={styles.rateInputWrap}>
                    <AppText style={styles.rupee}>₹</AppText>
                    <TextInput
                      style={styles.rateInput}
                      value={videoRate}
                      onChangeText={(t) => setVideoRate(t.replace(/[^0-9.]/g, ""))}
                      keyboardType="decimal-pad"
                      placeholder="7"
                      placeholderTextColor={theme.colors.textMuted}
                    />
                    <AppText variant="caption">/min</AppText>
                  </View>
                </View>
              </View>
              <AppText variant="caption" color={theme.colors.accent} style={{ marginTop: 10 }}>
                You keep about 85% after the platform fee.
              </AppText>
            </View>
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ marginTop: 14 }}>
      <AppText variant="label" style={{ marginBottom: 6 }}>
        {label}
      </AppText>
      <TextInput
        style={styles.input}
        placeholderTextColor={theme.colors.textMuted}
        {...props}
      />
    </View>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      <AppText style={{ color: on ? theme.colors.onBrand : theme.colors.text, fontSize: 13 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: theme.colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 56,
    paddingBottom: 14,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.backgroundElevated,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface,
  },
  headerTitle: { fontFamily: theme.font.displayMedium, fontSize: 20, color: theme.colors.text },
  saveBtn: {
    minWidth: 68,
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { fontFamily: theme.font.bodyBold, color: theme.colors.onBrand },
  section: {
    backgroundColor: theme.colors.surface,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 18,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTitle: {
    fontFamily: theme.font.bodyBold,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 4,
  },
  avatarWrap: { alignSelf: "center", marginBottom: 8 },
  avatar: { width: 104, height: 104, borderRadius: 32, backgroundColor: theme.colors.backgroundElevated },
  avatarEmpty: { backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" },
  avatarEdit: {
    position: "absolute",
    right: -4,
    bottom: -4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.brandDark,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: theme.colors.surface,
  },
  input: {
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 16,
    height: 52,
    fontSize: 16,
    color: theme.colors.text,
    fontFamily: theme.font.body,
  },
  bio: { height: 120, paddingTop: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  galleryItem: { marginRight: 12, position: "relative" },
  galleryImg: { width: 96, height: 96, borderRadius: 14, backgroundColor: theme.colors.backgroundElevated },
  galleryRemove: { position: "absolute", top: -8, right: -8 },
  galleryAdd: {
    width: 96,
    height: 96,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.colors.brandLight,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: theme.colors.backgroundElevated,
  },
  ratesRow: { flexDirection: "row", gap: 12, marginTop: 10 },
  rateInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.backgroundElevated,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 12,
    height: 52,
  },
  rupee: { fontFamily: theme.font.bodyBold, color: theme.colors.brandLight, marginRight: 4 },
  rateInput: { flex: 1, color: theme.colors.text, fontFamily: theme.font.body, fontSize: 16 },
});
