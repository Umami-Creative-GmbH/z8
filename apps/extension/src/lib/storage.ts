const DEFAULT_WEBAPP_URL = "http://localhost:3000";

export interface QueuedAction {
  id: string;
  type: "clock_in" | "clock_out";
  projectId?: string;
  timestamp: string;
  createdAt: string;
}

export interface ExtensionSettings {
  webappUrl: string;
  notificationsEnabled: boolean;
  notifyOnClockIn: boolean;
  notifyOnClockOut: boolean;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  webappUrl: DEFAULT_WEBAPP_URL,
  notificationsEnabled: true,
  notifyOnClockIn: true,
  notifyOnClockOut: true,
};

export const storage = {
  // Settings
  async getSettings(): Promise<ExtensionSettings> {
    try {
      const result = await chrome.storage.sync.get([
        "webappUrl",
        "notificationsEnabled",
        "notifyOnClockIn",
        "notifyOnClockOut",
      ]);
      return {
        webappUrl: result.webappUrl || DEFAULT_SETTINGS.webappUrl,
        notificationsEnabled: result.notificationsEnabled ?? DEFAULT_SETTINGS.notificationsEnabled,
        notifyOnClockIn: result.notifyOnClockIn ?? DEFAULT_SETTINGS.notifyOnClockIn,
        notifyOnClockOut: result.notifyOnClockOut ?? DEFAULT_SETTINGS.notifyOnClockOut,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  async saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
    const toSave: Record<string, unknown> = {};
    if (settings.webappUrl !== undefined) {
      toSave.webappUrl = settings.webappUrl.replace(/\/$/, "");
    }
    if (settings.notificationsEnabled !== undefined) {
      toSave.notificationsEnabled = settings.notificationsEnabled;
    }
    if (settings.notifyOnClockIn !== undefined) {
      toSave.notifyOnClockIn = settings.notifyOnClockIn;
    }
    if (settings.notifyOnClockOut !== undefined) {
      toSave.notifyOnClockOut = settings.notifyOnClockOut;
    }
    await chrome.storage.sync.set(toSave);
  },

  async getWebappUrl(): Promise<string> {
    const settings = await this.getSettings();
    return settings.webappUrl;
  },

  async setWebappUrl(url: string): Promise<void> {
    await this.saveSettings({ webappUrl: url });
  },

  // Offline Queue
  async getQueuedActions(): Promise<QueuedAction[]> {
    try {
      const result = await chrome.storage.local.get(["actionQueue"]);
      return result.actionQueue || [];
    } catch {
      return [];
    }
  },

  async addToQueue(action: Omit<QueuedAction, "id" | "createdAt">): Promise<QueuedAction> {
    const queue = await this.getQueuedActions();
    const newAction: QueuedAction = {
      ...action,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    queue.push(newAction);
    await chrome.storage.local.set({ actionQueue: queue });
    return newAction;
  },

  async removeFromQueue(actionId: string): Promise<void> {
    const queue = await this.getQueuedActions();
    const filtered = queue.filter((a) => a.id !== actionId);
    await chrome.storage.local.set({ actionQueue: filtered });
  },

  async clearQueue(): Promise<void> {
    await chrome.storage.local.set({ actionQueue: [] });
  },

  // Optimistic state for offline mode
  async getOptimisticState(): Promise<{ isClockedIn: boolean; startTime: string | null } | null> {
    try {
      const result = await chrome.storage.local.get(["optimisticState"]);
      return result.optimisticState || null;
    } catch {
      return null;
    }
  },

  async setOptimisticState(state: { isClockedIn: boolean; startTime: string | null } | null): Promise<void> {
    if (state === null) {
      await chrome.storage.local.remove(["optimisticState"]);
    } else {
      await chrome.storage.local.set({ optimisticState: state });
    }
  },
};
