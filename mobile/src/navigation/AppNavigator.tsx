import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Text } from "react-native";
import { DashboardScreen } from "../screens/DashboardScreen";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const icons: Record<string, string> = { Dashboard:"🏠", Factures:"🧾", Clients:"👥", CRM:"📊", Profil:"👤" };
  return <Text style={{ fontSize:20, opacity: focused ? 1 : 0.5 }}>{icons[name] || "●"}</Text>;
}

export function AppNavigator() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      tabBarIcon: ({ focused }) => <TabIcon name={route.name} focused={focused}/>,
      tabBarActiveTintColor: "#2F3E46",
      tabBarInactiveTintColor: "#9CA3AF",
      tabBarStyle: { borderTopColor: "#E5E7EB", paddingBottom: 8, height: 60 },
      tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
      headerStyle: { backgroundColor: "#2F3E46" },
      headerTintColor: "#fff",
      headerTitleStyle: { fontWeight: "700", fontSize: 16 },
    })}>
      <Tab.Screen name="Dashboard" component={DashboardScreen} options={{ title:"Accueil" }}/>
      <Tab.Screen name="Factures" component={DashboardScreen} options={{ title:"Factures" }}/>
      <Tab.Screen name="Clients" component={DashboardScreen} options={{ title:"Clients" }}/>
      <Tab.Screen name="CRM" component={DashboardScreen} options={{ title:"Pipeline" }}/>
      <Tab.Screen name="Profil" component={DashboardScreen} options={{ title:"Profil" }}/>
    </Tab.Navigator>
  );
}
