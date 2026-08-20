import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { appAPI } from "../src/services/api";
import { theme } from "../src/theme/tokens";

export default function NotificationsScreen() {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    appAPI.notifications().then((r) => setItems(r.data.notifications || []));
  }, []);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Updates</Text>
      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          <Text style={{ color: theme.colors.textMuted, textAlign: "center", marginTop: 40 }}>
            No notifications yet.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.t}>{item.title}</Text>
            <Text style={styles.b}>{item.body}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 64 },
  title: { fontSize: 28, fontWeight: "800", color: theme.colors.brand, paddingHorizontal: 24 },
  row: {
    backgroundColor: theme.colors.backgroundElevated,
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  t: { fontWeight: "700", color: theme.colors.text },
  b: { color: theme.colors.textSecondary, marginTop: 4 },
});
