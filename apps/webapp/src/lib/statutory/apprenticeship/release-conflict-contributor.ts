/**
 * Apprentice school and exam release conflicts in Scheduling and Staffing (#1993). A shift with
 * work on a day released in full (credited school day, block-release week, pre-exam day, or an exam
 * day recorded without its time), also a night shift starting the day before, during an exam recorded with its time, during a short school day's
 * lessons recorded with their times, or before such lessons starting before 09:00, is a
 * conflict for every apprentice, and prohibited for one under 18 (§§ 9, 10 JArbSchG): with the
 * organization's `blockJarbschgShiftPublish` on, that shift blocks publication. On the week's full
 * school day (more than five lessons) an apprentice under 18 may not return to the workplace
 * afterwards (§ 9 Abs. 1 Nr. 2 JArbSchG); after a shorter school day they may.
 */
import { Temporal } from "temporal-polyfill";
import type { ApprenticeReleaseKind } from "@/db/schema";
import {
	compareInstants,
	type Instant,
	type PlainDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import { type StatutoryFinding, statutoryFindingId } from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type {
	StatutoryScheduleContext,
	StatutoryScheduleContributor,
} from "../scheduling/contributor";
import { isMinorOn } from "../youth/age";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { proposedShiftSubjectKey } from "../youth/jarbschg-contributor";
import { loadEmployeeBirthdays, loadYouthShifts } from "../youth/youth-facts";
import type { ApprenticeReleaseDay } from "./release-credits";
import { loadApprenticeReleaseDays } from "./release-facts";

export type ApprenticeReleaseFindingKind =
	| "bbig_release_day_shift"
	| "jarbschg_school_day_workplace_return";

const apprenticeReleaseFindingKinds: ReadonlySet<string> = new Set<ApprenticeReleaseFindingKind>([
	"bbig_release_day_shift",
	"jarbschg_school_day_workplace_return",
]);

/**
 * What a release conflict is about: rule, employee and the release day it conflicts with
 * (`periodStart`), whichever shift it is and whichever day that shift starts on. Null for other
 * findings.
 */
export function apprenticeReleaseScopeOf(
	finding: Pick<StatutoryFinding, "kind" | "employeeId" | "periodStart">,
): string | null {
	if (!apprenticeReleaseFindingKinds.has(finding.kind)) return null;
	return JSON.stringify([finding.kind, finding.employeeId, "release", finding.periodStart]);
}

interface PlannedWork {
	readonly employeeId: string;
	readonly date: PlainDate;
	readonly ref: string;
	readonly start: Instant;
	readonly end: Instant;
}

/** The JArbSchG provision that releases an under-18 apprentice on each kind of release day. */
const minorReleaseReference: Record<ApprenticeReleaseKind, string> = {
	vocational_school_day: "§ 9 Abs. 1 Nr. 2 JArbSchG",
	vocational_school_block_week: "§ 9 Abs. 1 Nr. 3 JArbSchG",
	exam_day: "§ 10 Abs. 1 Nr. 1 JArbSchG",
	pre_exam_day: "§ 10 Abs. 1 Nr. 2 JArbSchG",
};

/** Lessons starting before this local time bar any work before them that day. */
const EARLY_LESSONS_BEFORE = Temporal.PlainTime.from("09:00");

/**
 * What planned work conflicts with on a release day:
 * - `release_day`: a day released in full, or the exam itself on an exam day credited with its time;
 * - `lessons`: the lessons of a school day recorded with its lesson times (§ 9 Abs. 1 Satz 1
 *   JArbSchG, § 15 Abs. 1 Satz 2 Nr. 1 BBiG: release for the lessons);
 * - `before_early_lessons`: work before lessons that start before 09:00 (§ 9 Abs. 1 Nr. 1 JArbSchG,
 *   § 15 Abs. 1 Satz 1 BBiG).
 */
type ReleaseConflict = "release_day" | "lessons" | "before_early_lessons";

const adultReference: Record<ReleaseConflict, string> = {
	release_day: "§ 15 Abs. 1 Satz 2 Nr. 2–5 BBiG",
	lessons: "§ 15 Abs. 1 Satz 2 Nr. 1 BBiG",
	before_early_lessons: "§ 15 Abs. 1 Satz 1 BBiG",
};

const minorLessonReference: Record<Exclude<ReleaseConflict, "release_day">, string> = {
	lessons: "§ 9 Abs. 1 Satz 1 JArbSchG",
	before_early_lessons: "§ 9 Abs. 1 Nr. 1 JArbSchG",
};

const overlaps = (work: PlannedWork, start: Instant, end: Instant) =>
	compareInstants(work.start, end) < 0 && compareInstants(start, work.end) < 0;

/** A local wall time on `day` in `timezone`. */
const instantOn = (day: PlainDate, time: string, timezone: string) =>
	day.toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(time) }).toInstant();

/**
 * How planned work conflicts with the release on `day`, resolved in `timezone`, or null.
 *
 * A day released in full conflicts with any work that falls on it, also a night shift that started
 * the day before; on a full school day recorded with its lesson times, work before lessons starting
 * before 09:00 is cited as such. A partly credited school or exam day leaves the rest of the day to
 * work, for minors too; for them the youth rules count its credited time toward the day's limit
 * (`youth/school-credits.ts`). Only work during the exam or the lessons, or before lessons starting
 * before 09:00, conflicts. A short school day recorded without its lesson times cannot be compared
 * with work, as before they were recorded.
 */
function conflictOf(
	work: PlannedWork,
	release: ApprenticeReleaseDay,
	day: PlainDate,
	timezone: string,
): ReleaseConflict | null {
	const startOfDay = day.toZonedDateTime({ timeZone: timezone }).toInstant();
	const beforeEarlyLessons = (schoolTime: { readonly start: string }) => {
		const early =
			Temporal.PlainTime.compare(Temporal.PlainTime.from(schoolTime.start), EARLY_LESSONS_BEFORE) <
			0;
		return early && overlaps(work, startOfDay, instantOn(day, schoolTime.start, timezone));
	};
	if (release.credit === "full_day") {
		if (release.schoolTime && beforeEarlyLessons(release.schoolTime)) {
			return "before_early_lessons";
		}
		const endOfDay = day.add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant();
		return overlaps(work, startOfDay, endOfDay) ? "release_day" : null;
	}
	if (release.examStartTime && release.minutes !== null) {
		const start = instantOn(day, release.examStartTime, timezone);
		return overlaps(work, start, start.add({ minutes: release.minutes })) ? "release_day" : null;
	}
	if (!release.schoolTime) return null;
	const lessonsStart = instantOn(day, release.schoolTime.start, timezone);
	if (overlaps(work, lessonsStart, instantOn(day, release.schoolTime.end, timezone))) {
		return "lessons";
	}
	return beforeEarlyLessons(release.schoolTime) ? "before_early_lessons" : null;
}

/**
 * The release time on `day` that planned work conflicts with, resolved in `timezone`: the whole day
 * when released in full, else the exam, or the lessons together with the time before them when they
 * start before 09:00. Null when nothing of the day can be compared with work.
 */
function releaseTimeOf(
	release: ApprenticeReleaseDay,
	day: PlainDate,
	timezone: string,
): { readonly start: Instant; readonly end: Instant } | null {
	const startOfDay = day.toZonedDateTime({ timeZone: timezone }).toInstant();
	if (release.credit === "full_day") {
		return {
			start: startOfDay,
			end: day.add({ days: 1 }).toZonedDateTime({ timeZone: timezone }).toInstant(),
		};
	}
	if (release.examStartTime && release.minutes !== null) {
		const start = instantOn(day, release.examStartTime, timezone);
		return { start, end: start.add({ minutes: release.minutes }) };
	}
	if (!release.schoolTime) return null;
	const early =
		Temporal.PlainTime.compare(
			Temporal.PlainTime.from(release.schoolTime.start),
			EARLY_LESSONS_BEFORE,
		) < 0;
	return {
		start: early ? startOfDay : instantOn(day, release.schoolTime.start, timezone),
		end: instantOn(day, release.schoolTime.end, timezone),
	};
}

/**
 * The planned work inside the release time, and its minutes: how deep the conflict is. An edit or
 * a move that puts more work there deepens the release day's conflict (`causedBlockingFindings`).
 */
function coverageOf(
	work: PlannedWork,
	release: ApprenticeReleaseDay,
	day: PlainDate,
	timezone: string,
): Pick<StatutoryFinding, "coveredMinutes" | "coveredSpan"> {
	const time = releaseTimeOf(release, day, timezone);
	if (!time) return {};
	const start = compareInstants(work.start, time.start) > 0 ? work.start : time.start;
	const end = compareInstants(work.end, time.end) < 0 ? work.end : time.end;
	if (compareInstants(start, end) >= 0) return {};
	return {
		coveredMinutes: Math.round(start.until(end).total("minutes")),
		coveredSpan: { start: start.toString(), end: end.toString() },
	};
}

async function evaluate(context: StatutoryScheduleContext): Promise<StatutoryFinding[]> {
	const releaseDays = await loadApprenticeReleaseDays(context.db, {
		organizationId: context.organizationId,
		employeeIds: context.employeeIds,
		from: context.window.start,
		// The day after the window too: a night shift may run into a school morning.
		until: parsePlainDate(context.window.endExclusive).add({ days: 1 }).toString(),
	});
	if (releaseDays.size === 0) return [];

	const employeeIds = [...releaseDays.keys()];
	const releaseOn = new Map<string, ApprenticeReleaseDay>();
	for (const [employeeId, days] of releaseDays) {
		for (const day of days) {
			const key = `${employeeId}:${day.date}`;
			const existing = releaseOn.get(key);
			if (!existing || day.credit === "full_day") releaseOn.set(key, day);
		}
	}

	const birthdays = await loadEmployeeBirthdays(context.db, {
		organizationId: context.organizationId,
		employeeIds,
	});
	const shifts = await loadYouthShifts(context.db, {
		organizationId: context.organizationId,
		organizationTimezone: context.timezone,
		employeeIds,
		from: context.window.start,
		until: context.window.endExclusive,
		excludeShiftId: context.replacesShiftId,
		excludeShiftIds: context.excludedShiftIds,
	});
	const planned: PlannedWork[] = [
		...shifts.map((shift) => ({ ...shift, ref: `shift:${shift.id}` })),
		...context.proposedShifts
			.filter((proposal) => releaseDays.has(proposal.employeeId))
			.map((proposal) => {
				const date = parsePlainDate(proposal.date);
				return {
					employeeId: proposal.employeeId,
					date,
					ref: proposedShiftSubjectKey(proposal),
					...shiftInterval(
						{ date, startTime: proposal.startTime, endTime: proposal.endTime },
						context.timezone,
					),
				};
			}),
	];

	const findings: StatutoryFinding<ApprenticeReleaseFindingKind>[] = [];
	for (const work of planned) {
		// Its own day, and the next one when it runs past midnight into a school morning.
		const lastDay = plainDateAt(work.end.subtract({ nanoseconds: 1 }), context.timezone);
		const days = lastDay.equals(work.date) ? [work.date] : [work.date, lastDay];
		let found: {
			release: ApprenticeReleaseDay;
			releaseDay: PlainDate;
			conflict: ReleaseConflict;
		} | null = null;
		for (const day of days) {
			const release = releaseOn.get(`${work.employeeId}:${day}`);
			const conflict = release ? conflictOf(work, release, day, context.timezone) : null;
			if (release && conflict) {
				found = { release, releaseDay: day, conflict };
				break;
			}
		}
		if (!found) continue;
		const { release, releaseDay, conflict } = found;
		const minor = isMinorOn(birthdays.get(work.employeeId) ?? null, work.date);
		const kind: ApprenticeReleaseFindingKind =
			minor && release.releaseKind === "vocational_school_day" && conflict === "release_day"
				? "jarbschg_school_day_workplace_return"
				: "bbig_release_day_shift";
		const subjectKey = work.ref;
		findings.push({
			id: statutoryFindingId(kind, work.employeeId, subjectKey),
			organizationId: context.organizationId,
			employeeId: work.employeeId,
			domain: "apprenticeship",
			kind,
			severity: minor ? "critical" : "warning",
			subjectKey,
			// The release day it conflicts with: for a night shift into a school morning, the next day.
			periodStart: releaseDay.toString(),
			periodEnd: releaseDay.add({ days: 1 }).toString(),
			legalReference: !minor
				? adultReference[conflict]
				: conflict === "release_day"
					? minorReleaseReference[release.releaseKind]
					: minorLessonReference[conflict],
			summary: { tier: "exceeded" },
			...coverageOf(work, release, releaseDay, context.timezone),
			adminDetail: null,
			inputFingerprint: statutoryInputFingerprint({
				kind,
				employeeId: work.employeeId,
				subjectKey,
				start: work.start,
				end: work.end,
				releaseId: release.releaseId,
				releaseKind: release.releaseKind,
				credit: release.credit,
				conflict,
				minor,
			}),
			acknowledgementKind: null,
			blocksPublication: minor && context.preferences.blockJarbschgShiftPublish,
		});
	}
	return findings;
}

export const apprenticeReleaseScheduleContributor: StatutoryScheduleContributor = {
	domain: "apprenticeship",
	evaluate,
};
