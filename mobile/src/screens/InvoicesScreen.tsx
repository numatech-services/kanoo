import React, { useState } from "react";
import { View, Text, TextInput, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from "react-native";
import { useApi } from "../api/useApi";
import { useTheme, fcfa, dateFr } from "../ui/theme";
import { Loading, Empty, ErrorBox, StatusPill } from "../ui/kit";

interface Invoice {
  _id: string; number: string; status: string; issueDate: string; dueDate?: string;
  totalTTC: number; paidAmount?: number; clientId?: { name?: string } | string | null;
}
const FILTERS = [["", "Toutes"], ["unpaid", "À encaisser"], ["overdue", "En retard"], ["paid", "Payées"]] as const;

/** Factures (lecture) : recherche, filtre par état, reste dû. */
export function InvoicesScreen() {
  const t = useTheme();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const qs = new URLSearchParams({ limit: "50", ...(status ? { status } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
  const { data, loading, error, reload } = useApi<{ items: Invoice[] }>(`/api/invoices?${qs}`);
  const items = data?.items ?? [];
  const now = Date.now();

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.bar}>
        <TextInput style={[styles.search, { backgroundColor: t.surface, borderColor: t.line, color: t.ink }]} placeholder="N° de facture, client…"
          placeholderTextColor={t.ink3} value={search} onChangeText={setSearch} returnKeyType="search" clearButtonMode="while-editing" />
        <View style={styles.filters}>
          {FILTERS.map(([k, l]) => (
            <TouchableOpacity key={k} onPress={() => setStatus(k)} accessibilityRole="button" accessibilityState={{ selected: status === k }}
              style={[styles.chip, { borderColor: status === k ? t.accent : t.line, backgroundColor: status === k ? t.accent : t.surface }]}>
              <Text style={{ color: status === k ? t.onAccent : t.ink2, fontWeight: "600", fontSize: 13 }}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {error ? <ErrorBox text={error} /> : null}
      {!data && loading ? <Loading /> : (
        <FlatList data={items} keyExtractor={i => i._id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={t.accent} />}
          ListEmptyComponent={<Empty text="Aucune facture." />}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 10 }}
          renderItem={({ item }) => {
            const client = typeof item.clientId === "object" && item.clientId ? item.clientId.name : "";
            const rest = Math.max(0, item.totalTTC - (item.paidAmount ?? 0));
            const late = !!item.dueDate && new Date(item.dueDate).getTime() < now && ["sent", "partial", "overdue"].includes(item.status);
            return (
              <View style={[styles.row, { backgroundColor: t.surface, borderColor: t.line }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: t.ink, fontWeight: "700" }} numberOfLines={1}>{item.number}</Text>
                  <Text style={{ color: t.ink2 }} numberOfLines={1}>{client || "—"}</Text>
                  <Text style={{ color: t.ink3, fontSize: 12 }}>Émise le {dateFr(item.issueDate)}{item.dueDate ? ` · échéance ${dateFr(item.dueDate)}` : ""}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={{ color: t.ink, fontWeight: "700" }}>{fcfa(item.totalTTC)}</Text>
                  {rest > 0 && rest < item.totalTTC ? <Text style={{ color: t.warn, fontSize: 12 }}>reste {fcfa(rest)}</Text> : null}
                  <StatusPill status={item.status} overdue={late} />
                </View>
              </View>
            );
          }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { padding: 16, paddingBottom: 8, gap: 10 },
  search: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  row: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", gap: 12 },
});
