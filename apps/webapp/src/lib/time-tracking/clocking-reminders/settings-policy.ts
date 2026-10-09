/** `employee.role` values an organization can target with clocking reminders. */
export const CLOCKING_REMINDER_ROLES = ["admin", "manager", "employee"] as const;
export type ClockingReminderRole = (typeof CLOCKING_REMINDER_ROLES)[number];

export const MAX_CLOCKING_REMINDER_MINUTES = 1440;

/** One reminder type's switch and its minutes after the expected start or end. */
export interface ClockingReminderGrace {
	enabled: boolean;
	graceMinutes: number;
}

/**
 * An organization's clocking reminder settings. Each reminder type owns its own entry, so later
 * reminder types (break due: `{ enabled, leadMinutes }`) add a key without reshaping the others.
 */
export interface ClockingReminderSettings {
	missedClockIn: ClockingReminderGrace;
	forgottenClockOut: ClockingReminderGrace;
	roles: ClockingReminderRole[];
	/** 0 when the organization never saved settings. */
	revision: number;
}

/** What an organization without a settings row gets: every reminder off. */
export const DEFAULT_CLOCKING_REMINDER_SETTINGS: Readonly<ClockingReminderSettings> = Object.freeze(
	{
		missedClockIn: { enabled: false, graceMinutes: 15 },
		forgottenClockOut: { enabled: false, graceMinutes: 30 },
		roles: [...CLOCKING_REMINDER_ROLES],
		revision: 0,
	},
);
