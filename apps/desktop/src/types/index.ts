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
