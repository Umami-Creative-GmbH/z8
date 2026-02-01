import { storage } from "./storage";

export async function showNotification(
  type: "clock_in" | "clock_out" | "sync" | "error",
  message?: string
): Promise<void> {
  const settings = await storage.getSettings();

  if (!settings.notificationsEnabled) {
    return;
  }

  if (type === "clock_in" && !settings.notifyOnClockIn) {
    return;
  }

  if (type === "clock_out" && !settings.notifyOnClockOut) {
    return;
  }

  let notificationMessage = "";

  switch (type) {
    case "clock_in":
      notificationMessage = message || "You have clocked in successfully.";
      break;
    case "clock_out":
      notificationMessage = message || "You have clocked out successfully.";
      break;
    case "sync":
      notificationMessage = message || "Offline actions have been synced.";
      break;
    case "error":
      notificationMessage = message || "An error occurred.";
      break;
  }

  try {
    await chrome.notifications.create(`z8-${type}-${Date.now()}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.svg"),
      title: "Z8 Time Tracker",
      message: notificationMessage,
    });
  } catch (error) {
    console.error("Failed to show notification:", error);
  }
}
