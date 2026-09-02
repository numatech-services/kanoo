import React, { useState, useEffect } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, Alert } from "react-native";
import { api } from "../lib/api";

interface KPIs { totalCA?: number; facInRetard?: number; tauxRecouvrement?: number; clientActifs?: number; }

export function DashboardScreen({ navigation }: { navigation: unknown }) {
  const [kpis, setKpis] = useState<KPIs>({});
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    const r = await api.get<{ kpis: KPIs }>("/api/reports/analytics?months=1");
    if (r.data?.kpis) setKpis(r.data.kpis);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, []);

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  const cards = [
    { label: "CA mensuel", value: kpis.totalCA ? `${(kpis.totalCA/1_000_000).toFixed(1)}M` : "—", unit: "XOF" },
    { label: "Taux recouvrement", value: `${kpis.tauxRecouvrement ?? "—"}`, unit: "%" },
    { label: "Factures en retard", value: String(kpis.facInRetard ?? "—"), unit: "", warn: (kpis.facInRetard ?? 0) > 0 },
    { label: "Clients actifs", value: String(kpis.clientActifs ?? "—"), unit: "" },
  ];

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2F3E46"/>}>
      <View style={styles.header}>
        <Text style={styles.greeting}>Bonjour 👋</Text>
        <Text style={styles.subtitle}>Résumé du jour</Text>
      </View>

      <View style={styles.grid}>
        {cards.map(c => (
          <View key={c.label} style={[styles.card, c.warn ? styles.cardWarn : undefined]}>
            <Text style={styles.cardLabel}>{c.label}</Text>
            <Text style={[styles.cardValue, c.warn ? styles.cardValueWarn : undefined]}>{c.value}</Text>
            {c.unit ? <Text style={styles.cardUnit}>{c.unit}</Text> : null}
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Text style={styles.sectionTitle}>Actions rapides</Text>
        {[
          { label: "Nouvelle facture", icon:"🧾", screen:"InvoiceNew" },
          { label: "Nouveau devis",   icon:"📋", screen:"QuoteNew" },
          { label: "Nouveau client",  icon:"👤", screen:"ClientNew" },
          { label: "Mes factures",    icon:"📄", screen:"Invoices" },
        ].map(a => (
          <TouchableOpacity key={a.label} style={styles.actionBtn}
            onPress={() => Alert.alert("Navigation", `→ ${a.screen}`)}>
            <Text style={styles.actionIcon}>{a.icon}</Text>
            <Text style={styles.actionLabel}>{a.label}</Text>
            <Text style={styles.actionChevron}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, backgroundColor:"#F3F1EA" },
  header: { padding:20, paddingTop:16 },
  greeting: { fontSize:22, fontWeight:"700", color:"#0B1020" },
  subtitle: { fontSize:14, color:"#6B705C", marginTop:2 },
  grid: { flexDirection:"row", flexWrap:"wrap", padding:12, gap:10 },
  card: { width:"47%", backgroundColor:"#fff", borderRadius:12, padding:14, borderWidth:0.5, borderColor:"#E5E7EB" },
  cardWarn: { borderColor:"#F09595", backgroundColor:"#FCEBEB" },
  cardLabel: { fontSize:11, color:"#6B705C", textTransform:"uppercase", letterSpacing:0.4 },
  cardValue: { fontSize:26, fontWeight:"600", color:"#0B1020", marginTop:4 },
  cardValueWarn: { color:"#A32D2D" },
  cardUnit: { fontSize:11, color:"#6B705C", marginTop:1 },
  actions: { padding:16, paddingTop:0 },
  sectionTitle: { fontSize:15, fontWeight:"600", color:"#0B1020", marginBottom:10 },
  actionBtn: { backgroundColor:"#fff", borderRadius:10, padding:14, flexDirection:"row", alignItems:"center", marginBottom:8, borderWidth:0.5, borderColor:"#E5E7EB" },
  actionIcon: { fontSize:20, marginRight:12 },
  actionLabel: { flex:1, fontSize:14, color:"#0B1020", fontWeight:"500" },
  actionChevron: { fontSize:20, color:"#9CA3AF" },
});
