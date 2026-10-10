/**
 * Cover duties of a deputy (#802, #1012): the approved absences they are
 * deputy on that are running now or start within the next 14 days, for the
 * "Covering for" dashboard card. Being someone's deputy reveals nothing about
 * the absence beyond what the deputy could already see: the absent person's
 * name and dates, and the category only for a viewer who sees it on the team
 * absence page.
 */

import {
	comparePlainDates,
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { resolvePersonalTimezone } from "@/lib/timezone/resolve-timezone";
import { canSeeAbsenceCategory, type DeputyViewer } from "./deputy-visibility";

/** How many days ahead an absence counts as upcoming cover (inclusive). */
export const UPCOMING_COVER_DAYS = 14;

/** An absence the viewer is deputy on, as loaded for the dashboard. */
export interface CoverDutyAbsence {
	absenceId: string;
	absentEmployeeId: string;
	absentEmployeeName: string;
	/** The absent employee's timezone setting, if any. */
	absentEmployeeTimezone: string | null;
	/** Logical calendar dates (YYYY-MM-DD), inclusive. */
	startDate: string;
	endDate: string;
	status: "pending" | "approved" | "rejected";
	category: { name: string; color: string | null };
}

/** One cover duty as the deputy sees it. */
export interface CoverDuty {
	absenceId: string;
	employeeId: string;
	employeeName: string;
	startDate: string;
	endDate: string;
	/** Null when the viewer could not see the category before. */
	category: { name: string; color: string | null } | null;
}

export interface CoverDuties {
	/** Running today in the absent employee's timezone, soonest end first. */
	running: CoverDuty[];
	/** Starting within the next 14 days, soonest start first. */
	upcoming: CoverDuty[];
}

/**
 * Splits the viewer's deputy absences into running and upcoming cover. Day
 * boundaries use the absent employee's effective timezone (their setting,
 * then the organization's); half days count as whole days. Only approved
 * absences are cover duties.
 */
export function buildCoverDuties(input: {
	absences: readonly CoverDutyAbsence[];
	viewer: DeputyViewer;
	organizationTimezone: string | null;
	now: Instant;
}): CoverDuties {
	const running: Array<{ duty: CoverDuty; end: PlainDate }> = [];
	const upcoming: Array<{ duty: CoverDuty; start: PlainDate }> = [];

	for (const absence of input.absences) {
		if (absence.status !== "approved") continue;
		const timezone = resolvePersonalTimezone({
			userTimezone: absence.absentEmployeeTimezone ?? undefined,
			organizationTimezone: input.organizationTimezone ?? undefined,
		}).timezone;
		const today = plainDateAt(input.now, timezone);
		const start = parsePlainDate(absence.startDate);
		const end = parsePlainDate(absence.endDate);
		const duty: CoverDuty = {
			absenceId: absence.absenceId,
			employeeId: absence.absentEmployeeId,
			employeeName: absence.absentEmployeeName,
			startDate: absence.startDate,
			endDate: absence.endDate,
			category: canSeeAbsenceCategory(input.viewer, absence.absentEmployeeId)
				? { name: absence.category.name, color: absence.category.color }
				: null,
		};

		if (comparePlainDates(start, today) <= 0 && comparePlainDates(end, today) >= 0) {
			running.push({ duty, end });
		} else if (
			comparePlainDates(start, today) > 0 &&
			comparePlainDates(start, today.add({ days: UPCOMING_COVER_DAYS })) <= 0
		) {
			upcoming.push({ duty, start });
		}
	}

	return {
		running: running
			.sort((left, right) => comparePlainDates(left.end, right.end))
			.map(({ duty }) => duty),
		upcoming: upcoming
			.sort((left, right) => comparePlainDates(left.start, right.start))
			.map(({ duty }) => duty),
	};
}
