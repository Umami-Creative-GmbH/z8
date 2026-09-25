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

/** Why a saved clock command has not committed (yet). */
export interface CommandFailure {
  /** transient: resent automatically; paused: waits for a context change; rejected: needs review. */
  class: "transient" | "paused" | "rejected";
  code: string;
  httpStatus: number | null;
  response: unknown;
  atMs: number;
}

export type ClockCommandOutcome =
  | {
      outcome: "committed";
      write: {
        entries: { id: string; employeeId: string; type: string; timestamp: string }[];
        operationId: string | null;
        status: ClockStatus | null;
        statusRefreshFailed: boolean;
        contextChanged: boolean;
      };
    }
  | { outcome: "savedOnDevice"; operationId: string; waiting: CommandFailure | null }
  | { outcome: "needsReview"; operationId: string; failure: CommandFailure | null }
  | { outcome: "retainedForReview"; recoveryId: number };

export interface RecoverySummary {
  total: number;
  malformed: number;
  exhausted: number;
}

export type SavedCommandState = "pending" | "stalled" | "rejected" | "committed" | "archived";

/** A frozen clock command captured for the session's current context. */
export interface SavedClockCommand {
  operationId: string;
  kind: "clock_in" | "clock_out";
  /** Original UTC instant of the action. */
  occurredAt: string;
  /** Device IANA zone at action time. */
  timezone: string;
  state: SavedCommandState;
  attempts: number;
  capturedAtMs: number;
  dependsOn: string | null;
  failure: CommandFailure | null;
  /** Refused without committed work under its identity, so it may be archived. */
  archivable: boolean;
  /** The exact command sent on every attempt. */
  command: string;
  /** The server's original receipt; not current status. */
  receipt: string | null;
}

export interface ClockJournal {
  legacy: RecoverySummary;
  serverReachable: boolean;
  commandsEnabled: boolean;
  commands: SavedClockCommand[];
  /** Unresolved commands captured under another account, organization or server. */
  otherContexts: number;
  projection: { isClockedIn: boolean; since: string | null } | null;
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
