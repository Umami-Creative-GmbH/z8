import type { SubmissionCadence } from "./cadence";

/** Days after a period ends before the second reminder to submit it. */
export const DEFAULT_SECOND_REMINDER_DELAY_DAYS = 3;
export const MIN_SECOND_REMINDER_DELAY_DAYS = 1;
export const MAX_SECOND_REMINDER_DELAY_DAYS = 30;

/**
 * An organization's period submission settings as the settings page shows them. Plain data, so
 * it crosses the server/client boundary. Dates are `YYYY-MM-DD` in the organization's timezone;
 * each employee's periods follow their own.
 */
export interface PeriodSubmissionSettings {
	/** The cadence last saved: off when the organization never saved one. */
	cadence: SubmissionCadence;
	/** The cadence in effect today. */
	inEffect: SubmissionCadence;
	/** A saved change that has not taken effect yet, with the day it does. */
	upcoming: { cadence: SubmissionCadence; fromDate: string } | null;
	secondReminderDelayDays: number;
	/** 0 when the organization never saved settings. */
	revision: number;
}
