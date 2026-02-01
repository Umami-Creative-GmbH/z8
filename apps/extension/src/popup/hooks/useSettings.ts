import { useEffect, useState } from "react";
import { storage, type ExtensionSettings } from "@/lib/storage";

export function useSettings() {
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    storage.getSettings().then((s) => {
      setSettings(s);
      setIsLoading(false);
    });
  }, []);

  const saveSettings = async (newSettings: Partial<ExtensionSettings>) => {
    await storage.saveSettings(newSettings);
    const updated = await storage.getSettings();
    setSettings(updated);
  };

  return {
    settings,
    isLoading,
    saveSettings,
    // Convenience getters
    webappUrl: settings?.webappUrl ?? "",
    notificationsEnabled: settings?.notificationsEnabled ?? true,
    notifyOnClockIn: settings?.notifyOnClockIn ?? true,
    notifyOnClockOut: settings?.notifyOnClockOut ?? true,
  };
}
