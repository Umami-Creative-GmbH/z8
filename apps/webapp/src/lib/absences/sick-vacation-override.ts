import { DateTime } from "luxon";

export type VacationSegment = { startDate: string; endDate: string };

function isoDatePlusDays(date: string, days: number): string {
	return DateTime.fromISO(date).plus({ days }).toISODate() ?? date;
}

export function splitVacationAroundSickRange(input: {
	vacationStartDate: string;
	vacationEndDate: string;
	sickStartDate: string;
	sickEndDate: string;
}): VacationSegment[] {
	if (
		input.sickEndDate < input.vacationStartDate ||
		input.sickStartDate > input.vacationEndDate
	) {
		return [
			{ startDate: input.vacationStartDate, endDate: input.vacationEndDate },
		];
	}

	const segments: VacationSegment[] = [];

	if (input.vacationStartDate < input.sickStartDate) {
		segments.push({
			startDate: input.vacationStartDate,
			endDate: isoDatePlusDays(input.sickStartDate, -1),
		});
	}

	if (input.vacationEndDate > input.sickEndDate) {
		segments.push({
			startDate: isoDatePlusDays(input.sickEndDate, 1),
			endDate: input.vacationEndDate,
		});
	}

	return segments.filter((segment) => segment.startDate <= segment.endDate);
}
