import React from "react";
import { Text } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { HomeScreen } from "../screens/HomeScreen";
import { InvoicesScreen } from "../screens/InvoicesScreen";
import { ClientsScreen } from "../screens/ClientsScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { useTheme } from "../ui/theme";

const Tab = createBottomTabNavigator();
const ICONS: Record<string, string> = { Accueil: "⌂", Factures: "▤", Clients: "☺", Profil: "●" };

/** Quatre onglets, quatre écrans réels (les onglets factices de la V1 sont retirés). */
export function AppNavigator() {
  const t = useTheme();
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{ICONS[route.name]}</Text>,
      tabBarActiveTintColor: t.accent,
      tabBarInactiveTintColor: t.ink3,
      tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
      tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      headerStyle: { backgroundColor: t.surface },
      headerTintColor: t.ink,
      headerTitleStyle: { fontWeight: "800" },
      headerShadowVisible: false,
    })}>
      <Tab.Screen name="Accueil" component={HomeScreen} options={{ title: "Kanoo" }} />
      <Tab.Screen name="Factures" component={InvoicesScreen} />
      <Tab.Screen name="Clients" component={ClientsScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
