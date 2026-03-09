import { createLogger } from "@/lib/logger";

export const logger = createLogger("TimeTrackingActionsEffect");

export const DEFAULT_TIMEZONE = "UTC";
export const ONE_MINUTE_MS = 60_000;
export const BREAK_WARNING_THRESHOLD_MINUTES = 15;
export const BOOKABLE_PROJECT_STATUSES = ["planned", "active", "paused"] as const;

export const EMPTY_BREAK_REMINDER_STATUS = {
	needsBreakSoon: false,
	uninterruptedMinutes: 0,
	maxUninterrupted: null,
	minutesUntilBreakRequired: null,
	breakRequirement: null,
};
