export const WORK_LOCATION_OPTIONS = [
  { value: "office", label: "Office / On-site" },
  { value: "home", label: "Home" },
  { value: "remote", label: "Remote" },
  { value: "other", label: "Other" },
] as const;

export type WorkLocationType = (typeof WORK_LOCATION_OPTIONS)[number]["value"];

export function isWorkLocationType(value: string | null | undefined): value is WorkLocationType {
  return WORK_LOCATION_OPTIONS.some((option) => option.value === value);
}

export interface ClockStatus {
  hasEmployee: boolean;
  employeeId: string | null;
  isClockedIn: boolean;
  activeWorkPeriod: {
    id: string;
    startTime: string;
  } | null;
}

export interface Settings {
  webappUrl: string;
  alwaysOnTop: boolean;
  autoStartup: boolean;
  version: string;
}

export interface Session {
  token: string | null;
  isAuthenticated: boolean;
}

export interface IdleEvent {
  idleStartTime: string;
  idleDurationMs: number;
}
