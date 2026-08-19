import "server-only";

import { Temporal } from "temporal-polyfill";
import { isHolidayBlockingTimeEntry } from "@/lib/calendar/holiday-service";
import { validateTimeCorrectionRange } from "@/lib/time-tracking/time-correction-temporal";

export interface TimeEntryValidationResult {
	isValid: boolean;
	error?: string;
	holidayName?: string;
}

/**
 * Validate if a time entry can be created at the given timestamp
 * Checks for holiday blocking and other validation rules
 * Uses employee's timezone to determine the calendar day for holiday checks
 */
export async function validateTimeEntry(
	organizationId: string,
	timestamp: Date,
	employeeTimezone: string = "UTC",
): Promise<TimeEntryValidationResult> {
	// Check if the date is a holiday that blocks time entry (using employee's timezone)
	const { isBlocked, holiday } = await isHolidayBlockingTimeEntry(
		organizationId,
		timestamp,
		employeeTimezone,
	);

	if (isBlocked && holiday) {
		return {
			isValid: false,
			error: "errors.holiday.blocksTimeEntry",
			holidayName: holiday.holiday.name,
		};
	}

	// Additional validation rules can be added here
	// - Check if timestamp is in the future
	// - Check if timestamp is too far in the past
	// - Check for duplicate entries
	// etc.

	return {
		isValid: true,
	};
}

/**
 * Validate if a time entry can be created for a specific date range
 * Useful for bulk operations or absence requests
 * Uses employee's timezone to determine calendar days for holiday checks
 */
export async function validateTimeEntryRange(
	organizationId: string,
	startDate: Date,
	endDate: Date,
	employeeTimezone: string = "UTC",
): Promise<TimeEntryValidationResult> {
	const startInstant = Temporal.Instant.fromEpochMilliseconds(
		startDate.getTime(),
	);
	const endInstant = Temporal.Instant.fromEpochMilliseconds(endDate.getTime());
	if (Temporal.Instant.compare(startInstant, endInstant) > 0)
		return { isValid: true };
	if (Temporal.Instant.compare(startInstant, endInstant) < 0) {
		try {
			validateTimeCorrectionRange(startInstant, endInstant);
		} catch (error) {
			return {
				isValid: false,
				error:
					error instanceof Error ? error.message : "Invalid work period range",
			};
		}
	}

	const endLocalDate = endInstant
		.toZonedDateTimeISO(employeeTimezone)
		.toPlainDate();
	let currentLocalDate = startInstant
		.toZonedDateTimeISO(employeeTimezone)
		.toPlainDate();
	let date = startDate;
	while (true) {
		const result = await validateTimeEntry(
			organizationId,
			date,
			employeeTimezone,
		);
		if (!result.isValid) return result;
		if (Temporal.PlainDate.compare(currentLocalDate, endLocalDate) >= 0) break;
		currentLocalDate = currentLocalDate.add({ days: 1 });
		date = new Date(
			currentLocalDate.toZonedDateTime(employeeTimezone).epochMilliseconds,
		);
	}

	return {
		isValid: true,
	};
}
