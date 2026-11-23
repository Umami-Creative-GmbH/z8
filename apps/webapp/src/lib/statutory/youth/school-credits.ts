/**
 * School and exam time as JArbSchG working time (#1993). For an apprentice under 18, vocational
 * school and exams count toward the daily and weekly limits and make their days working days
 * (§ 9 Abs. 2, § 10 Abs. 2, § 15 JArbSchG):
 *
 * - the week's full school day (more than five lessons) counts the average working day;
 * - a full block-release week counts the average working week, spread over its five weekdays;
 * - an exam counts its participation time including breaks, the average working day when it is
 *   recorded without its time;
 * - the working day before the written final exam counts the average working day;
 * - other school days count their school time including breaks.
 *
 * The averages come from the employee's effective terms on each day (`averageWorkingTimeOf`);
 * 8 h a day and 40 h a week only when the terms give no working time. Work Balance credits the
 * same release days (`release-credits.ts`): a full release day frees the day's required time,
 * school time lowers it by the same minutes counted here.
 */
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { type ApprenticeReleaseDay, SCHOOL_DAYS_PER_WEEK } from "../apprenticeship/release-credits";
import { loadApprenticeReleaseDays } from "../apprenticeship/release-facts";
import type { YouthCreditedTime } from "./jarbschg-rules";

/** The average working day when the terms give none: the § 8 Abs. 1 JArbSchG day. */
const FALLBACK_DAY_MINUTES = 8 * 60;
/** The average working week when the terms give none: the § 8 Abs. 1 JArbSchG week. */
const FALLBACK_WEEK_MINUTES = 40 * 60;

/**
 * The working time credited on each release day; each day on its own, so any part of a release
 * is credited as in the whole. A full block week's school days are its five weekdays. A date is
 * credited at most once: of several releases on it, the largest credit counts (a full release
 * absorbs a school day on the same date), as Work Balance releases the day once.
 */
export function youthSchoolCreditsOf(days: readonly ApprenticeReleaseDay[]): YouthCreditedTime[] {
	const byDate = new Map<string, YouthCreditedTime>();
	for (const day of days) {
		const minutes =
			day.credit === "school_minutes"
				? (day.minutes ?? 0)
				: day.releaseKind === "vocational_school_block_week"
					? Math.round(
							(day.averageWorkingTime?.weeklyMinutes ?? FALLBACK_WEEK_MINUTES) /
								SCHOOL_DAYS_PER_WEEK,
						)
					: (day.averageWorkingTime?.dailyMinutes ?? FALLBACK_DAY_MINUTES);
		const earlier = byDate.get(day.date);
		if (!earlier || minutes > earlier.minutes) {
			byDate.set(day.date, { ref: `release:${day.releaseId}`, date: day.date, minutes });
		}
	}
	return [...byDate.values()];
}

/** Credited school and exam time on the local days `[from, until)`, per employee. */
export async function loadYouthSchoolCredits(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly until: string;
	},
): Promise<Map<string, YouthCreditedTime[]>> {
	const releaseDays = await loadApprenticeReleaseDays(db, input);
	return new Map(
		[...releaseDays].map(([employeeId, days]) => [employeeId, youthSchoolCreditsOf(days)]),
	);
}
