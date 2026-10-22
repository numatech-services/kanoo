import React, { useState } from "react";
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, RefreshControl, Linking } from "react-native";
import { useApi } from "../api/useApi";
import { useTheme } from "../ui/theme";
import { Loading, Empty, ErrorBox } from "../ui/kit";

interface Client { _id: string; code?: string; name: string; email?: string; phone?: string; nif?: string }

/** Clients : recherche, appel ou e-mail en un geste. */
export function ClientsScreen() {
  const t = useTheme();
  const [search, setSearch] = useState("");
  const qs = new URLSearchParams({ limit: "50", ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, loading, error, reload } = useApi<{ items: Client[] }>(`/api/clients?${qs}`);
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <TextInput style={[styles.search, { backgroundColor: t.surface, borderColor: t.line, color: t.ink }]} placeholder="Nom, code, NIF, e-mail…"
          placeholderTextColor={t.ink3} value={search} onChangeText={setSearch} returnKeyType="search" clearButtonMode="while-editing" />
      </View>
      {error ? <ErrorBox text={error} /> : null}
      {!data && loading ? <Loading /> : (
        <FlatList data={items} keyExtractor={i => i._id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={t.accent} />}
          ListEmptyComponent={<Empty text="Aucun client." />}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }}
          renderItem={({ item }) => (
            <View style={[styles.row, { backgroundColor: t.surface, borderColor: t.line }]}>
              <Text style={{ color: t.ink, fontWeight: "700" }}>{item.name}</Text>
              <Text style={{ color: t.ink3, fontSize: 12 }}>{[item.code, item.nif && `NIF ${item.nif}`].filter(Boolean).join(" · ")}</Text>
              <View style={styles.actions}>
                {item.phone ? (
                  <TouchableOpacity onPress={() => Linking.openURL(`tel:${item.phone}`)} accessibilityRole="button">
                    <Text style={{ color: t.accent, fontWeight: "600" }}>Appeler {item.phone}</Text>
                  </TouchableOpacity>
                ) : null}
                {item.email ? (
                  <TouchableOpacity onPress={() => Linking.openURL(`mailto:${item.email}`)} accessibilityRole="button">
                    <Text style={{ color: t.accent, fontWeight: "600" }}>Écrire</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          )} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  actions: { flexDirection: "row", gap: 18, marginTop: 6 },
});
