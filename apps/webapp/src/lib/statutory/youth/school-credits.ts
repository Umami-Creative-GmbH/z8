/**
 * School and exam time as JArbSchG working time (#1993). For an apprentice under 18, vocational
 * school and exams count toward the daily and weekly limits and make their days working days
 * (§ 9 Abs. 2, § 10 Abs. 2, § 15 JArbSchG):
 *
 * - the week's full school day (more than five lessons) counts 8 h;
 * - a full block-release week counts 40 h, spread over its days;
 * - the exam day and the working day before the written final exam count 8 h;
 * - other school days count their school time including breaks.
 *
 * Work Balance credits releases separately (`release-credits.ts`); this only feeds the youth rules.
 */
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { ApprenticeReleaseDay } from "../apprenticeship/release-credits";
import { loadApprenticeReleaseDays } from "../apprenticeship/release-facts";
import type { YouthCreditedTime } from "./jarbschg-rules";

/** § 9 Abs. 2 Nr. 1, § 10 Abs. 2 JArbSchG. */
const CREDITED_DAY_MINUTES = 8 * 60;
/** § 9 Abs. 2 Nr. 2 JArbSchG. */
const CREDITED_BLOCK_WEEK_MINUTES = 40 * 60;

/** The working time credited on each release day. Pass every day of each release. */
export function youthSchoolCreditsOf(days: readonly ApprenticeReleaseDay[]): YouthCreditedTime[] {
	const daysOfRelease = new Map<string, number>();
	for (const day of days) {
		daysOfRelease.set(day.releaseId, (daysOfRelease.get(day.releaseId) ?? 0) + 1);
	}
	return days.map((day) => ({
		ref: `release:${day.releaseId}`,
		date: day.date,
		minutes:
			day.credit === "school_minutes"
				? (day.minutes ?? 0)
				: day.releaseKind === "vocational_school_block_week"
					? Math.round(CREDITED_BLOCK_WEEK_MINUTES / (daysOfRelease.get(day.releaseId) ?? 1))
					: CREDITED_DAY_MINUTES,
	}));
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
