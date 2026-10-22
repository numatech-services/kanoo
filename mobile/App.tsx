import React, { useEffect, useState } from "react";
import { NavigationContainer, DefaultTheme, DarkTheme } from "@react-navigation/native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { LoginScreen } from "./src/screens/LoginScreen";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { restoreSession, onSessionChange } from "./src/api/client";

export default function App() {
  const scheme = useColorScheme();
  // null tant que le trousseau n'a pas été lu : rien n'est affiché.
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    restoreSession().then(ok => { if (live) setSignedIn(ok); });
    // Connexion, déconnexion, ou jeton expiré (401) : l'écran suit.
    const off = onSessionChange(setSignedIn);
    return () => { live = false; off(); };
  }, []);

  if (signedIn === null) return null;
  return (
    <SafeAreaProvider>
      <NavigationContainer theme={scheme === "dark" ? DarkTheme : DefaultTheme}>
        <StatusBar style="auto" />
        {signedIn ? <AppNavigator /> : <LoginScreen />}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
