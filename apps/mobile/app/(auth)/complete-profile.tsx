import { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";
import { authAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { OnboardingChrome } from "../../src/components/OnboardingChrome";
import { AppText, Input } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";
import { CATEGORIES, GENDERS, LANGUAGES } from "../../src/constants/creatorProfile";

type Errors = Record<string, string>;

export default function CompleteProfile() {
  const router = useRouter();
  const { setSession, token, refreshMe } = useAuthStore();
  const [userType, setUserType] = useState<"user" | "creator">("user");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [referral, setReferral] = useState("");
  const [bio, setBio] = useState("");
  const [gender, setGender] = useState<string>("Female");
  const [category, setCategory] = useState("");
  const [languages, setLanguages] = useState<string[]>([]);
  const [social, setSocial] = useState("");
  const [picture, setPicture] = useState<string | undefined>();
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(false);
  const isCreator = userType === "creator";

  useEffect(() => {
    const value = username.trim().toLowerCase();
    if (!isCreator || value.length < 3) {
      setUsernameAvailable(null);
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(value)) {
      setUsernameAvailable(false);
      setErrors((prev) => ({ ...prev, username: "Only letters, numbers, _ and - allowed" }));
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await authAPI.checkUsername(value);
        setUsernameAvailable(!!res.data.available);
        setErrors((prev) => ({
          ...prev,
          username: res.data.available ? "" : "Username already taken",
        }));
      } catch {
        setUsernameAvailable(null);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [username, isCreator]);

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
    if (result.canceled || !result.assets?.[0]?.base64) return;
    setPicture(`data:image/jpeg;base64,${result.assets[0].base64}`);
  };

  const toggleLanguage = (lang: string) => {
    setLanguages((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]));
    setErrors((prev) => ({ ...prev, languages: "" }));
  };

  const validate = () => {
    const next: Errors = {};
    if (name.trim().length < 2) next.name = "Name must be at least 2 characters";
    if (isCreator) {
      if (username.trim().length < 3) next.username = "Username must be at least 3 characters";
      else if (usernameAvailable === false) next.username = "Username not available";
      if (!category) next.category = "Select a category";
      if (!languages.length) next.languages = "Select at least one language";
      if (social.trim()) {
        const ok =
          /^https?:\/\/.+/i.test(social.trim()) &&
          /(instagram\.com|youtu\.be|youtube\.com)/i.test(social.trim());
        if (!ok) next.social = "Enter a valid Instagram or YouTube link";
      }
    }
    setErrors(next);
    return Object.keys(next).filter((k) => next[k]).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await authAPI.completeProfile({
        name: name.trim(),
        username: isCreator ? username.trim().toLowerCase() : username.trim() || undefined,
        referral_code: referral.trim() || undefined,
        user_type: userType,
        picture,
        bio: isCreator ? bio.trim() || undefined : undefined,
        gender: isCreator ? gender : undefined,
        category: isCreator ? category : undefined,
        languages: isCreator ? languages : undefined,
        famous_profile_link: isCreator ? social.trim() || undefined : undefined,
      });
      const updated = res.data.user;
      const nextToken = res.data.token || token;
      if (nextToken && updated) await setSession(nextToken, updated);
      else await refreshMe();
      if (updated?.user_type === "creator") router.replace("/pricing-setup");
      else router.replace("/");
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const text = typeof detail === "string" ? detail : "Could not save profile";
      const referralHit = /referral/i.test(text);
      if (referralHit) setErrors((prev) => ({ ...prev, referral: text }));
      else if (/username/i.test(text)) setErrors((prev) => ({ ...prev, username: text }));
      else Toast.show({ type: "error", text1: text });
    } finally {
      setLoading(false);
    }
  };

  return (
    <OnboardingChrome
      step={isCreator ? 1 : undefined}
      title="Your profile"
      subtitle={
        isCreator
          ? "Fans see this before they call you."
          : "A name is enough to start calling."
      }
      onBack={() => router.replace("/(auth)/login")}
      footer={<PrimaryButton label={isCreator ? "Continue to rates" : "Start calling"} onPress={submit} loading={loading} />}
    >
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={styles.roleRow}>
            <Pressable onPress={() => setUserType("user")} style={[styles.roleCard, !isCreator && styles.roleOn]}>
              <Ionicons name="call-outline" size={22} color={!isCreator ? theme.colors.onBrand : theme.colors.brandLight} />
              <AppText style={[styles.roleTitle, !isCreator && styles.roleTitleOn]}>Fan</AppText>
              <AppText variant="caption" style={{ color: !isCreator ? theme.colors.onBrand : theme.colors.textMuted }}>
                Call creators instantly
              </AppText>
            </Pressable>
            <Pressable onPress={() => setUserType("creator")} style={[styles.roleCard, isCreator && styles.roleOn]}>
              <Ionicons name="sparkles-outline" size={22} color={isCreator ? theme.colors.onBrand : theme.colors.accent} />
              <AppText style={[styles.roleTitle, isCreator && styles.roleTitleOn]}>Creator</AppText>
              <AppText variant="caption" style={{ color: isCreator ? theme.colors.onBrand : theme.colors.textMuted }}>
                Earn per minute
              </AppText>
            </Pressable>
          </View>

          <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
            {picture ? (
              <Image source={{ uri: picture }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <AppText color={theme.colors.onBrand}>Add photo</AppText>
              </View>
            )}
          </Pressable>

          <Input label="Display name" value={name} onChangeText={setName} placeholder="Your name" />
          {errors.name ? <FieldError text={errors.name} /> : null}

          {isCreator ? (
            <>
              <Input
                label="Username"
                autoCapitalize="none"
                value={username}
                onChangeText={setUsername}
                placeholder="unique_handle"
              />
              {errors.username ? <FieldError text={errors.username} /> : null}
              {usernameAvailable ? (
                <AppText variant="caption" color={theme.colors.success} style={{ marginTop: 4 }}>
                  Username is available
                </AppText>
              ) : null}

              <AppText variant="label" style={styles.section}>
                Gender
              </AppText>
              <View style={styles.chips}>
                {GENDERS.map((g) => (
                  <Pressable key={g} onPress={() => setGender(g)} style={[styles.chip, gender === g && styles.chipOn]}>
                    <AppText style={{ color: gender === g ? theme.colors.onBrand : theme.colors.text }}>{g}</AppText>
                  </Pressable>
                ))}
              </View>

              <AppText variant="label" style={styles.section}>
                Category
              </AppText>
              <View style={styles.chips}>
                {CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      setCategory(c);
                      setErrors((prev) => ({ ...prev, category: "" }));
                    }}
                    style={[styles.chip, category === c && styles.chipOn]}
                  >
                    <AppText style={{ color: category === c ? theme.colors.onBrand : theme.colors.text }}>{c}</AppText>
                  </Pressable>
                ))}
              </View>
              {errors.category ? <FieldError text={errors.category} /> : null}

              <AppText variant="label" style={styles.section}>
                Languages
              </AppText>
              <View style={styles.chips}>
                {LANGUAGES.map((lang) => {
                  const on = languages.includes(lang);
                  return (
                    <Pressable key={lang} onPress={() => toggleLanguage(lang)} style={[styles.chip, on && styles.chipOn]}>
                      <AppText style={{ color: on ? theme.colors.onBrand : theme.colors.text }}>{lang}</AppText>
                    </Pressable>
                  );
                })}
              </View>
              {errors.languages ? <FieldError text={errors.languages} /> : null}

              <Input
                label="Bio (optional)"
                value={bio}
                onChangeText={setBio}
                placeholder="Tell fans about yourself"
                multiline
                style={{ height: 88, textAlignVertical: "top", paddingTop: 12 }}
              />
              <Input
                label="Instagram or YouTube (optional)"
                autoCapitalize="none"
                value={social}
                onChangeText={setSocial}
                placeholder="https://instagram.com/you"
              />
              {errors.social ? <FieldError text={errors.social} /> : null}
            </>
          ) : null}

          <Input
            label="Referral code (optional)"
            autoCapitalize="characters"
            value={referral}
            onChangeText={setReferral}
            placeholder="ABCD1234"
          />
          {errors.referral ? <FieldError text={errors.referral} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </OnboardingChrome>
  );
}

function FieldError({ text }: { text: string }) {
  if (!text) return null;
  return (
    <AppText variant="caption" color={theme.colors.error} style={{ marginTop: 4 }}>
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  roleRow: { flexDirection: "row", gap: 10, marginTop: 16 },
  roleCard: {
    flex: 1,
    padding: 14,
    borderRadius: 16,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 4,
    minHeight: 108,
  },
  roleOn: { backgroundColor: theme.colors.brand, borderColor: theme.colors.brand },
  roleTitle: { fontFamily: theme.font.bodyBold, fontSize: 16, marginTop: 6 },
  roleTitleOn: { color: theme.colors.onBrand },
  avatarWrap: { alignSelf: "center", marginVertical: 16 },
  avatar: { width: 96, height: 96, borderRadius: 32, backgroundColor: theme.colors.surface },
  avatarEmpty: { backgroundColor: theme.colors.brand, alignItems: "center", justifyContent: "center" },
  section: { marginTop: 16, marginBottom: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.full,
    backgroundColor: theme.colors.surface,
  },
  chipOn: { backgroundColor: theme.colors.brand },
});
