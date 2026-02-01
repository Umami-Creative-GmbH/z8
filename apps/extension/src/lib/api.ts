import { storage, type QueuedAction } from "./storage";
import type { ClockStatus, Project, TimeEntry } from "@/types";

export class NetworkError extends Error {
  constructor(message: string = "Network error") {
    super(message);
    this.name = "NetworkError";
  }
}

export class AuthError extends Error {
  constructor(message: string = "Not authenticated") {
    super(message);
    this.name = "AuthError";
  }
}

class ApiClient {
  private baseUrl: string = "";

  async init(): Promise<void> {
    this.baseUrl = await storage.getWebappUrl();
  }

  isOnline(): boolean {
    return navigator.onLine;
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    if (!this.baseUrl) {
      await this.init();
    }

    if (!this.isOnline()) {
      throw new NetworkError("You are offline");
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthError("NOT_AUTHENTICATED");
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API Error: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof AuthError || error instanceof NetworkError) {
        throw error;
      }
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new NetworkError("Failed to connect to server");
      }
      throw error;
    }
  }

  async getClockStatus(): Promise<ClockStatus> {
    return this.fetch<ClockStatus>("/api/time-entries/status");
  }

  async clockIn(timestamp?: string): Promise<{ entry: TimeEntry }> {
    return this.fetch<{ entry: TimeEntry }>("/api/time-entries", {
      method: "POST",
      body: JSON.stringify({
        type: "clock_in",
        ...(timestamp && { timestamp }),
      }),
    });
  }

  async clockOut(projectId?: string, timestamp?: string): Promise<{ entry: TimeEntry }> {
    return this.fetch<{ entry: TimeEntry }>("/api/time-entries", {
      method: "POST",
      body: JSON.stringify({
        type: "clock_out",
        ...(projectId && { projectId }),
        ...(timestamp && { timestamp }),
      }),
    });
  }

  async getProjects(): Promise<{ projects: Project[] }> {
    return this.fetch<{ projects: Project[] }>("/api/extension/projects");
  }

  // Process a single queued action
  async processQueuedAction(action: QueuedAction): Promise<boolean> {
    try {
      if (action.type === "clock_in") {
        await this.clockIn(action.timestamp);
      } else {
        await this.clockOut(action.projectId, action.timestamp);
      }
      return true;
    } catch (error) {
      if (error instanceof NetworkError) {
        return false; // Will retry later
      }
      // For other errors (e.g., already clocked in), remove from queue
      console.error("Failed to process queued action:", error);
      return true; // Remove from queue anyway
    }
  }
}

export const api = new ApiClient();
