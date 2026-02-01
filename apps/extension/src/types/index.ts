export interface ClockStatus {
  hasEmployee: boolean;
  employeeId: string | null;
  isClockedIn: boolean;
  activeWorkPeriod: {
    id: string;
    startTime: string;
  } | null;
}

export interface Project {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

export interface TimeEntry {
  id: string;
  employeeId: string;
  type: "clock_in" | "clock_out";
  timestamp: string;
}

export interface ApiError {
  error: string;
}

// Re-export storage types
export type { QueuedAction, ExtensionSettings } from "@/lib/storage";
