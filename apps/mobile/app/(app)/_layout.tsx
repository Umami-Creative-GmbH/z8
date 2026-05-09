import { Tabs } from "expo-router";

export default function AppLayout() {
  return (
    <Tabs>
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="schedule" options={{ title: "Schedule" }} />
      <Tabs.Screen name="my-requests" options={{ title: "My Requests" }} />
      <Tabs.Screen name="absences/index" options={{ title: "Absences" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
