import React, { useState, useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import { LoginScreen } from "./src/screens/LoginScreen";
import { AppNavigator } from "./src/navigation/AppNavigator";

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("auth_token").then(token => {
      setIsAuthenticated(!!token);
      setLoading(false);
    });
  }, []);

  if (loading) return null;

  return (
    <NavigationContainer>
      <StatusBar style="light" backgroundColor="#2F3E46"/>
      {isAuthenticated
        ? <AppNavigator />
        : <LoginScreen onLogin={() => setIsAuthenticated(true)}/>
      }
    </NavigationContainer>
  );
}
