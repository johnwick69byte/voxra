import { useEffect, useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { callsAPI } from "../src/services/api";
import { theme } from "../src/theme/tokens";

export default function CallHistory() {
  const [calls, setCalls] = useState<any[]>([]);
  useEffect(() => {
    callsAPI.history().then((r) => setCalls(r.data.calls || []));
  }, []);
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Call history</Text>
      <FlatList
        data={calls}
        keyExtractor={(i) => i.call_id}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.main}>{item.call_type} · {item.status}</Text>
            <Text style={styles.meta}>₹{(item.total_amount || 0).toFixed(0)} · {item.duration_seconds || 0}s</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: theme.colors.background, paddingTop: 64 },
  title: { fontSize: 28, fontWeight: "800", color: theme.colors.brand, paddingHorizontal: 24 },
  row: { backgroundColor: "#fff", padding: 14, borderRadius: 12, marginBottom: 8, borderWidth: 1, borderColor: theme.colors.border },
  main: { fontWeight: "700", color: theme.colors.text },
  meta: { color: theme.colors.textSecondary, marginTop: 4 },
});
