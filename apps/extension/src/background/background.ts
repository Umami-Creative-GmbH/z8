import { storage } from "@/lib/storage";
import { showNotification } from "@/lib/notifications";

const DEFAULT_WEBAPP_URL = "http://localhost:3000";

async function getWebappUrl(): Promise<string> {
  try {
    const settings = await storage.getSettings();
    return settings.webappUrl || DEFAULT_WEBAPP_URL;
  } catch {
    return DEFAULT_WEBAPP_URL;
  }
}

async function updateBadge(isClockedIn: boolean, hasQueuedActions: boolean = false): Promise<void> {
  if (isClockedIn) {
    await chrome.action.setBadgeText({ text: "●" });
    await chrome.action.setBadgeBackgroundColor({ color: "#22c55e" }); // green
  } else if (hasQueuedActions) {
    await chrome.action.setBadgeText({ text: "!" });
    await chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" }); // amber
  } else {
    await chrome.action.setBadgeText({ text: "" });
  }
}

async function checkStatus(): Promise<void> {
  const queuedActions = await storage.getQueuedActions();
  const hasQueuedActions = queuedActions.length > 0;

  // If offline, check optimistic state
  if (!navigator.onLine) {
    const optimisticState = await storage.getOptimisticState();
    if (optimisticState) {
      await updateBadge(optimisticState.isClockedIn, hasQueuedActions);
    } else {
      await updateBadge(false, hasQueuedActions);
    }
    return;
  }

  try {
    const webappUrl = await getWebappUrl();
    const response = await fetch(`${webappUrl}/api/time-entries/status`, {
      credentials: "include",
    });

    if (response.ok) {
      const data = await response.json();
      if (typeof data.isClockedIn === "boolean") {
        await updateBadge(data.isClockedIn, hasQueuedActions);
        // Clear optimistic state since we have real data
        await storage.setOptimisticState(null);
      } else {
        console.error("Invalid status response:", data);
        await updateBadge(false, hasQueuedActions);
      }
    } else if (response.status === 401) {
      await updateBadge(false, hasQueuedActions);
    }
  } catch (error) {
    console.error("Status check failed:", error);
    // Fall back to optimistic state if available
    const optimisticState = await storage.getOptimisticState();
    if (optimisticState) {
      await updateBadge(optimisticState.isClockedIn, hasQueuedActions);
    }
  }
}

async function processQueue(): Promise<void> {
  if (!navigator.onLine) {
    return;
  }

  const queue = await storage.getQueuedActions();
  if (queue.length === 0) {
    return;
  }

  console.log(`Processing ${queue.length} queued actions...`);
  const webappUrl = await getWebappUrl();
  let processedCount = 0;

  for (const action of queue) {
    try {
      const body: Record<string, string | undefined> = {
        type: action.type,
        timestamp: action.timestamp,
      };
      if (action.projectId) {
        body.projectId = action.projectId;
      }

      const response = await fetch(`${webappUrl}/api/time-entries`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (response.ok || response.status === 400 || response.status === 401) {
        // Success or client error - remove from queue
        await storage.removeFromQueue(action.id);
        processedCount++;

        if (response.ok) {
          // Show notification for successful sync
          const settings = await storage.getSettings();
          if (settings.notificationsEnabled) {
            if (action.type === "clock_in" && settings.notifyOnClockIn) {
              await showNotification("clock_in", "Offline clock-in has been synced.");
            } else if (action.type === "clock_out" && settings.notifyOnClockOut) {
              await showNotification("clock_out", "Offline clock-out has been synced.");
            }
          }
        }
      } else {
        // Server error - stop processing, will retry later
        console.error(`Failed to process action ${action.id}:`, response.status);
        break;
      }
    } catch (error) {
      console.error(`Failed to process action ${action.id}:`, error);
      break; // Network error - stop processing
    }
  }

  if (processedCount > 0) {
    console.log(`Processed ${processedCount} queued actions`);
    // Clear optimistic state and refresh status
    await storage.setOptimisticState(null);
    await checkStatus();
  }
}

// Handle online/offline events
self.addEventListener("online", () => {
  console.log("Back online, processing queue...");
  processQueue();
});

// Periodic status check and queue processing
chrome.alarms.create("status-check", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "status-check") {
    checkStatus();
    processQueue();
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CLOCK_STATUS_CHANGED") {
    checkStatus();
  } else if (message.type === "PROCESS_QUEUE") {
    processQueue().then(() => sendResponse({ success: true }));
    return true; // Keep channel open for async response
  } else if (message.type === "GET_QUEUE_STATUS") {
    storage.getQueuedActions().then((queue) => {
      sendResponse({ queueLength: queue.length });
    });
    return true;
  } else if (message.type === "SHOW_NOTIFICATION") {
    showNotification(message.notificationType, message.message);
  }
});

// Initial check
chrome.runtime.onInstalled.addListener(() => {
  checkStatus();
});

chrome.runtime.onStartup.addListener(() => {
  checkStatus();
  processQueue();
});

checkStatus();
processQueue();
