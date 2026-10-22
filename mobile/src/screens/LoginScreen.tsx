import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator } from "react-native";
import { signIn, verifyTwoFactor } from "../api/client";
import { useTheme } from "../ui/theme";

/** Connexion, puis code de double authentification si le compte l'a activée. */
export function LoginScreen() {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    if (!challenge && (!email || !password)) { setError("Email et mot de passe requis."); return; }
    if (challenge && !code.trim()) { setError("Saisissez le code à 6 chiffres."); return; }
    setBusy(true);
    const r = challenge ? await verifyTwoFactor(challenge, code.trim()) : await signIn(email.trim(), password);
    setBusy(false);
    if (r.done) return; // la session est ouverte : App bascule sur la navigation
    if ("twoFactor" in r) { setChallenge(r.challenge); return; }
    setError(r.error);
  }

  const input = [styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.surface }];
  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: t.bg }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}>
        <Text style={[styles.logo, { color: t.ink }]}>Kanoo</Text>
        <Text style={[styles.subtitle, { color: t.ink3 }]}>{challenge ? "Double authentification" : "Connexion à votre espace"}</Text>
        {challenge ? (
          <>
            <Text style={[styles.help, { color: t.ink2 }]}>Code à 6 chiffres de votre application d'authentification, ou un code de secours.</Text>
            <TextInput style={input} placeholder="123456" placeholderTextColor={t.ink3} value={code} onChangeText={setCode}
              keyboardType="number-pad" autoFocus textContentType="oneTimeCode" returnKeyType="done" onSubmitEditing={submit} />
          </>
        ) : (
          <>
            <TextInput style={input} placeholder="Adresse e-mail" placeholderTextColor={t.ink3} value={email} onChangeText={setEmail}
              autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" returnKeyType="next" />
            <TextInput style={input} placeholder="Mot de passe" placeholderTextColor={t.ink3} value={password} onChangeText={setPassword}
              secureTextEntry textContentType="password" returnKeyType="done" onSubmitEditing={submit} />
          </>
        )}
        {error ? <Text style={[styles.error, { color: t.neg }]} accessibilityRole="alert">{error}</Text> : null}
        <TouchableOpacity style={[styles.btn, { backgroundColor: t.accent }, busy && { opacity: 0.6 }]} onPress={submit} disabled={busy} accessibilityRole="button">
          {busy ? <ActivityIndicator color={t.onAccent} /> : <Text style={[styles.btnText, { color: t.onAccent }]}>{challenge ? "Valider" : "Se connecter"}</Text>}
        </TouchableOpacity>
        {challenge ? (
          <TouchableOpacity onPress={() => { setChallenge(null); setCode(""); }} style={styles.link}>
            <Text style={{ color: t.accent, fontWeight: "600" }}>Revenir à la connexion</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 20 },
  card: { borderRadius: 20, padding: 24, borderWidth: 1 },
  logo: { fontSize: 30, fontWeight: "800", letterSpacing: -0.8, textAlign: "center" },
  subtitle: { fontSize: 14, textAlign: "center", marginTop: 4, marginBottom: 24 },
  help: { fontSize: 13, marginBottom: 12, lineHeight: 19 },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 15, marginBottom: 12 },
  error: { fontSize: 13, marginBottom: 10 },
  btn: { borderRadius: 12, padding: 15, alignItems: "center", marginTop: 4, minHeight: 50, justifyContent: "center" },
  btnText: { fontSize: 15, fontWeight: "700" },
  link: { alignItems: "center", marginTop: 16 },
});
