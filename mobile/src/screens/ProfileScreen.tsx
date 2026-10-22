import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Linking } from "react-native";
import { useApi } from "../api/useApi";
import { signOut, BASE_URL } from "../api/client";
import { useTheme } from "../ui/theme";
import { Card, Loading } from "../ui/kit";

interface Me { user: { firstName?: string; lastName?: string; email?: string; role?: string } | null; tenant: { name?: string } | null }

/** Profil : identité, organisation, accès au site complet, déconnexion. */
export function ProfileScreen() {
  const t = useTheme();
  const { data, loading } = useApi<Me>("/api/auth/me");
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, padding: 16, gap: 12 }}>
      {!data && loading ? <Loading /> : (
        <Card>
          <Text style={{ color: t.ink, fontSize: 18, fontWeight: "800" }}>{[data?.user?.firstName, data?.user?.lastName].filter(Boolean).join(" ") || "—"}</Text>
          <Text style={{ color: t.ink2, marginTop: 2 }}>{data?.user?.email}</Text>
          <Text style={{ color: t.ink3, marginTop: 8 }}>{data?.tenant?.name}</Text>
        </Card>
      )}
      <Card>
        <Text style={{ color: t.ink2, lineHeight: 20 }}>
          L'application mobile couvre le suivi au quotidien : tableau de bord, factures, clients. La saisie complète (devis, comptabilité, paie…) se fait sur le site.
        </Text>
        <TouchableOpacity onPress={() => Linking.openURL(`${BASE_URL}/dashboard`)} style={{ marginTop: 10 }} accessibilityRole="link">
          <Text style={{ color: t.accent, fontWeight: "700" }}>Ouvrir Kanoo sur le web</Text>
        </TouchableOpacity>
      </Card>
      <TouchableOpacity onPress={signOut} style={[styles.logout, { borderColor: t.neg }]} accessibilityRole="button">
        <Text style={{ color: t.neg, fontWeight: "700" }}>Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  logout: { borderWidth: 1, borderRadius: 12, padding: 14, alignItems: "center", marginTop: 8 },
});
