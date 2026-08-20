import { useEffect, useState } from "react";
import {
  View,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import Toast from "react-native-toast-message";
import { authAPI } from "../src/services/api";
import { useAuthStore } from "../src/store/authStore";
import { PrimaryButton } from "../src/components/PrimaryButton";
import { AppText, Input } from "../src/components/ui";
import { theme } from "../src/theme/tokens";

export default function EditProfile() {
  const router = useRouter();
  const { user, token, setSession, refreshMe } = useAuthStore();
  const [name, setName] = useState(user?.name || "");
  const [username, setUsername] = useState(user?.username || "");
  const [bio, setBio] = useState("");
  const [picture, setPicture] = useState<string | undefined>(user?.picture || undefined);
  const [loading, setLoading] = useState(false);
  const isCreator = user?.user_type === "creator";

  useEffect(() => {
    if (isCreator) {
      authAPI.me().then((r) => {
        setBio(r.data.creator_profile?.bio || "");
        if (r.data.user?.picture) setPicture(r.data.user.picture);
      });
    }
  }, [isCreator]);

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

  const save = async () => {
    if (name.trim().length < 2) {
      Toast.show({ type: "error", text1: "Name must be at least 2 characters" });
      return;
    }
    setLoading(true);
    try {
      const res = await authAPI.updateProfile({
        name: name.trim(),
        username: username.trim() || undefined,
        picture,
        bio: isCreator ? bio : undefined,
      });
      if (token && res.data.user) await setSession(token, res.data.user);
      else await refreshMe();
      Toast.show({ type: "success", text1: "Profile updated" });
      router.back();
    } catch (e: any) {
      Toast.show({
        type: "error",
        text1: "Could not update",
        text2: e?.response?.data?.detail || e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <AppText style={styles.brand}>Edit profile</AppText>
      <Pressable onPress={pickAvatar} style={styles.avatarWrap}>
        {picture ? (
          <Image source={{ uri: picture }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <AppText color={theme.colors.onBrand}>Photo</AppText>
          </View>
        )}
      </Pressable>
      <Input label="Display name" value={name} onChangeText={setName} />
      <Input label="Username" autoCapitalize="none" value={username} onChangeText={setUsername} />
      {isCreator ? (
        <Input
          label="Bio"
          value={bio}
          onChangeText={setBio}
          multiline
          style={{ height: 100, textAlignVertical: "top", paddingTop: 12 }}
        />
      ) : null}
      <PrimaryButton label="Save" onPress={save} loading={loading} style={{ marginTop: 24 }} />
      <PrimaryButton label="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 10 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, padding: 24, paddingTop: 64 },
  brand: { fontFamily: theme.font.display, fontSize: 32, color: theme.colors.brand, marginBottom: 16 },
  avatarWrap: { alignSelf: "center", marginBottom: 12 },
  avatar: { width: 96, height: 96, borderRadius: 32, backgroundColor: theme.colors.surface },
  avatarEmpty: {
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
