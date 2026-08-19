import { useCallback, useState } from "react";
import { View, Text, FlatList, StyleSheet, Pressable, Image, RefreshControl } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { creatorsAPI } from "../../src/services/api";
import { StatusDot } from "../../src/components/StatusDot";
import { theme } from "../../src/theme/tokens";

export default function FollowingScreen() {
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await creatorsAPI.following();
      setItems(res.data.creators || []);
    } finally {
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Following</Text>
      <FlatList
        data={items}
        keyExtractor={(i) => i.user_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
        contentContainerStyle={{ padding: 16, gap: 10 }}
        ListEmptyComponent={<Text style={styles.empty}>Follow creators to see them here.</Text>}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/creator/${item.user_id}`)}>
            <Image source={{ uri: item.picture || "https://i.pravatar.cc/100?u=" + item.user_id }} style={styles.av} />
            <View>
              <Text style={styles.name}>{item.name}</Text>
              <StatusDot status={item.status} />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 64 },
  title: { fontSize: 28, fontWeight: "800", color: theme.colors.brand, paddingHorizontal: 24 },
  empty: { textAlign: "center", color: theme.colors.textMuted, marginTop: 40 },
  row: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "#fff", padding: 12, borderRadius: 14, borderWidth: 1, borderColor: theme.colors.border },
  av: { width: 48, height: 48, borderRadius: 14 },
  name: { fontWeight: "700", color: theme.colors.text, marginBottom: 4 },
});
