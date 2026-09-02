import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, KeyboardAvoidingView, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../lib/api";

export function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email || !password) { Alert.alert("Erreur", "Email et mot de passe requis"); return; }
    setLoading(true);
    const r = await api.post<{ token: string }>("/api/auth/login", { email, password });
    if (r.data?.token) {
      await AsyncStorage.setItem("auth_token", r.data.token);
      onLogin();
    } else {
      Alert.alert("Connexion échouée", r.error || "Identifiants incorrects");
    }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.card}>
        <Text style={styles.logo}>Kanoo</Text>
        <Text style={styles.subtitle}>Niger · Afrique francophone</Text>

        <TextInput style={styles.input} placeholder="Email" placeholderTextColor="#888" value={email}
          onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" returnKeyType="next"/>
        <TextInput style={styles.input} placeholder="Mot de passe" placeholderTextColor="#888" value={password}
          onChangeText={setPassword} secureTextEntry returnKeyType="done" onSubmitEditing={handleLogin}/>

        <TouchableOpacity style={[styles.btn, loading && styles.btnDisabled]} onPress={handleLogin} disabled={loading}>
          <Text style={styles.btnText}>{loading ? "Connexion…" : "Se connecter"}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex:1, justifyContent:"center", padding:24, backgroundColor:"#F3F1EA" },
  card: { backgroundColor:"#fff", borderRadius:16, padding:24, shadowColor:"#000", shadowOpacity:0.08, shadowRadius:12, elevation:4 },
  logo: { fontSize:28, fontWeight:"700", color:"#2F3E46", textAlign:"center", marginBottom:4 },
  subtitle: { fontSize:13, color:"#888", textAlign:"center", marginBottom:28 },
  input: { borderWidth:1, borderColor:"#E5E7EB", borderRadius:10, padding:14, fontSize:14, marginBottom:12, color:"#111" },
  btn: { backgroundColor:"#2F3E46", borderRadius:10, padding:15, alignItems:"center", marginTop:4 },
  btnDisabled: { opacity:0.6 },
  btnText: { color:"#fff", fontSize:15, fontWeight:"600" },
});
