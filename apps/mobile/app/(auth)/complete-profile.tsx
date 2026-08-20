import { useState } from "react";
import { View, StyleSheet, Image, Pressable, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";
import { authAPI } from "../../src/services/api";
import { useAuthStore } from "../../src/store/authStore";
import { PrimaryButton } from "../../src/components/PrimaryButton";
import { AppText, Input } from "../../src/components/ui";
import { theme } from "../../src/theme/tokens";

export default function CompleteProfile() {
  const router = useRouter();
  const { user, setSession, token, refreshMe } = useAuthStore();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [referral, setReferral] = useState("");
  const [bio, setBio] = useState("");
  const [picture, setPicture] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const isCreator = user?.user_type === "creator";

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
    if (asset.base64) {
      setPicture(`data:image/jpeg;base64,${asset.base64}`);
    } else if (asset.uri) {
      setPicture(asset.uri);
    }
  };

  const submit = async () => {
    if (name.trim().length < 2) {
      Toast.show({ type: "error", text1: "Enter your display name" });
      return;
    }
    setLoading(true);
    try {
      const userType = user?.user_type || "user";
      const res = await authAPI.completeProfile({
        name: name.trim(),
        username: username.trim() || undefined,
        referral_code: referral.trim() || undefined,
        user_type: userType,
        picture,
        bio: isCreator ? bio.trim() || undefined : undefined,
      });
      const updated = res.data.user;
      if (token && updated) {
        await setSession(token, updated);
      } else {
        await refreshMe();
      }
      if (updated?.user_type === "creator" || userType === "creator") {
        router.replace("/pricing-setup");
      } else {
        router.replace("/");
      }
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not save profile",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      <AppText style={styles.brand}>Voxora</AppText>
      <AppText variant="title" style={{ marginTop: 8 }}>
        Almost there
      </AppText>
      <AppText variant="subtitle" style={{ marginTop: 6, marginBottom: 20 }}>
        A short profile so creators and fans know who you are.
      </AppText>

      <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
        {picture ? (
          <Image source={{ uri: picture }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <AppText color={theme.colors.onBrand} style={{ fontFamily: theme.font.bodySemi }}>
              Add photo
            </AppText>
          </View>
        )}
      </Pressable>

      <Input label="Display name" value={name} onChangeText={setName} placeholder="Your name" />
      <Input
        label="Username (optional)"
        autoCapitalize="none"
        value={username}
        onChangeText={setUsername}
        placeholder="unique_handle"
      />
      {isCreator ? (
        <Input
          label="Bio (optional)"
          value={bio}
          onChangeText={setBio}
          placeholder="Tell fans about yourself"
          multiline
          style={{ height: 88, textAlignVertical: "top", paddingTop: 12 }}
        />
      ) : null}
      <Input
        label="Referral code (optional)"
        autoCapitalize="characters"
        value={referral}
        onChangeText={setReferral}
        placeholder="ABCD1234"
      />
      <PrimaryButton label="Continue" onPress={submit} loading={loading} style={{ marginTop: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: 24,
    paddingTop: 72,
    backgroundColor: theme.colors.background,
  },
  brand: {
    fontFamily: theme.font.display,
    fontSize: 32,
    color: theme.colors.brand,
  },
  avatarWrap: { alignSelf: "center", marginBottom: 8 },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 32,
    backgroundColor: theme.colors.surface,
  },
  avatarEmpty: {
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
