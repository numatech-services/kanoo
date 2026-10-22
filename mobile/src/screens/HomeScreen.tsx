import React from "react";
import { ScrollView, View, Text, StyleSheet, RefreshControl } from "react-native";
import { useApi } from "../api/useApi";
import { useTheme, fcfa, compact } from "../ui/theme";
import { Card, Loading, ErrorBox } from "../ui/kit";

interface BriefItem { title: string; why: string; tone: "neg" | "warn" | "info" }
interface Home {
  limited: boolean;
  greeting?: { salut: string; firstName: string; tenantName: string };
  kpis?: { revenue?: { value: number }; toCollect?: { value: number; count: number }; overdue?: { value: number; count: number }; collected?: { value: number } };
  treasury?: { balance: number; forecast: Array<{ label: string; balance: number }> } | null;
  brief: BriefItem[];
}

/** Accueil : le même tableau de bord que l'application web (GET /api/dashboard/home). */
export function HomeScreen() {
  const t = useTheme();
  const { data, loading, error, reload } = useApi<Home>("/api/dashboard/home");
  if (!data && loading) return <Loading />;
  if (!data) return <ErrorBox text={error || "Tableau de bord indisponible."} />;

  const tiles = data.limited ? [] : [
    { label: "Chiffre d'affaires (année)", value: data.kpis?.revenue?.value },
    { label: "À encaisser", value: data.kpis?.toCollect?.value, sub: `${data.kpis?.toCollect?.count ?? 0} facture(s)` },
    { label: "En retard", value: data.kpis?.overdue?.value, sub: `${data.kpis?.overdue?.count ?? 0} facture(s)`, warn: (data.kpis?.overdue?.value ?? 0) > 0 },
    { label: "Encaissé (mois)", value: data.kpis?.collected?.value },
  ];

  return (
    <ScrollView style={{ backgroundColor: t.bg }} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={t.accent} />}>
      {data.greeting ? (
        <View style={styles.header}>
          <Text style={[styles.hello, { color: t.ink }]}>{data.greeting.salut}{data.greeting.firstName ? `, ${data.greeting.firstName}` : ""}</Text>
          <Text style={{ color: t.ink3 }}>{data.greeting.tenantName}</Text>
        </View>
      ) : null}

      {data.treasury ? (
        <Card style={{ backgroundColor: t.accent, borderColor: t.accent }}>
          <Text style={{ color: t.onAccent, opacity: 0.85, fontSize: 13 }}>Trésorerie disponible</Text>
          <Text style={[styles.big, { color: t.onAccent }]}>{fcfa(data.treasury.balance)}</Text>
          <View style={styles.row}>
            {data.treasury.forecast.map(f => (
              <View key={f.label} style={{ flex: 1 }}>
                <Text style={{ color: t.onAccent, opacity: 0.8, fontSize: 11 }}>{f.label}</Text>
                <Text style={{ color: t.onAccent, fontWeight: "700" }}>{compact(f.balance)}</Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {tiles.length ? (
        <View style={styles.grid}>
          {tiles.map(k => (
            <Card key={k.label} style={{ width: "48%", ...(k.warn ? { backgroundColor: t.negSoft, borderColor: t.negSoft } : {}) }}>
              <Text style={{ color: t.ink3, fontSize: 12 }}>{k.label}</Text>
              <Text style={[styles.tile, { color: k.warn ? t.neg : t.ink }]}>{compact(k.value ?? 0)}</Text>
              {k.sub ? <Text style={{ color: t.ink3, fontSize: 11 }}>{k.sub}</Text> : null}
            </Card>
          ))}
        </View>
      ) : null}

      <Text style={[styles.section, { color: t.ink }]}>Priorités du jour</Text>
      {data.brief.length === 0 ? <Text style={{ color: t.ink3 }}>Rien d'urgent aujourd'hui.</Text> : data.brief.map((b, i) => (
        <Card key={i} style={{ marginBottom: 10, borderLeftWidth: 4, borderLeftColor: b.tone === "neg" ? t.neg : b.tone === "warn" ? t.warn : t.accent }}>
          <Text style={{ color: t.ink, fontWeight: "700" }}>{b.title}</Text>
          <Text style={{ color: t.ink2, marginTop: 4, lineHeight: 19 }}>{b.why}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  header: { marginBottom: 4 },
  hello: { fontSize: 24, fontWeight: "800", letterSpacing: -0.6 },
  big: { fontSize: 28, fontWeight: "800", marginTop: 4, marginBottom: 12 },
  row: { flexDirection: "row", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  tile: { fontSize: 22, fontWeight: "800", marginTop: 6 },
  section: { fontSize: 17, fontWeight: "700", marginTop: 8 },
});
