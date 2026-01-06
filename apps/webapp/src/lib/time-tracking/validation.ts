"use server";

import { isHolidayBlockingTimeEntry } from "@/lib/calendar/holiday-service";

export interface TimeEntryValidationResult {
	isValid: boolean;
	error?: string;
	holidayName?: string;
}

/**
 * Validate if a time entry can be created at the given timestamp
 * Checks for holiday blocking and other validation rules
 */
export async function validateTimeEntry(
	organizationId: string,
	timestamp: Date,
): Promise<TimeEntryValidationResult> {
	// Check if the date is a holiday that blocks time entry
	const { isBlocked, holiday } = await isHolidayBlockingTimeEntry(organizationId, timestamp);

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
 */
export async function validateTimeEntryRange(
	organizationId: string,
	startDate: Date,
	endDate: Date,
): Promise<TimeEntryValidationResult> {
	// Check each day in the range
	const currentDate = new Date(startDate);
	const end = new Date(endDate);

	while (currentDate <= end) {
		const result = await validateTimeEntry(organizationId, currentDate);
		if (!result.isValid) {
			return result;
		}
		currentDate.setDate(currentDate.getDate() + 1);
	}

	return {
		isValid: true,
	};
}
