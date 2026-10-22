import React from "react";
import { View, Text, ActivityIndicator, StyleSheet, ViewStyle } from "react-native";
import { useTheme } from "./theme";

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }, style]}>{children}</View>;
}

export function Loading() {
  const t = useTheme();
  return <View style={styles.center}><ActivityIndicator color={t.accent} /></View>;
}

export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <View style={styles.center}><Text style={{ color: t.ink3, textAlign: "center" }}>{text}</Text></View>;
}

export function ErrorBox({ text }: { text: string }) {
  const t = useTheme();
  return <View style={[styles.error, { backgroundColor: t.negSoft }]}><Text style={{ color: t.neg }}>{text}</Text></View>;
}

/** Pastille de statut de facture, en clair. */
const STATUS: Record<string, [string, "neg" | "warn" | "pos" | "ink3"]> = {
  draft: ["Brouillon", "ink3"], sent: ["Envoyée", "warn"], partial: ["Partielle", "warn"],
  overdue: ["En retard", "neg"], paid: ["Payée", "pos"], cancelled: ["Annulée", "ink3"],
};
export function StatusPill({ status, overdue }: { status: string; overdue?: boolean }) {
  const t = useTheme();
  const [label, tone] = overdue && status !== "paid" ? STATUS.overdue : STATUS[status] ?? [status, "ink3"];
  return <Text style={[styles.pill, { color: t[tone], borderColor: t[tone] }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16 },
  center: { padding: 40, alignItems: "center", justifyContent: "center" },
  error: { borderRadius: 12, padding: 12, margin: 16 },
  pill: { fontSize: 11, fontWeight: "700", borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
});
