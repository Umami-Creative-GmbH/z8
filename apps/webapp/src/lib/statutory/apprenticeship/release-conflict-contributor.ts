/**
 * Apprentice school and exam release conflicts in Scheduling and Staffing (#1993). A shift with
 * work on a day released in full (credited school day, block-release week, pre-exam day, or an exam
 * day recorded without its time), also a night shift starting the day before, during an exam recorded with its time, during a short school day's
 * lessons recorded with their times, or before such lessons starting before 09:00, is a
 * conflict for every apprentice, and prohibited for one under 18 (§§ 9, 10 JArbSchG): with the
 * organization's `blockJarbschgShiftPublish` on, that shift blocks publication. On the week's full
 * school day (more than five lessons) an apprentice under 18 may not return to the workplace
 * afterwards (§ 9 Abs. 1 Nr. 2 JArbSchG); after a shorter school day they may. In a full
 * block-release week, up to 2 h a week of in-company training are allowed (§ 9 Abs. 1 Nr. 3
 * JArbSchG, § 15 Abs. 1 Satz 3 BBiG): only the work on its block days past them conflicts.
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
import {
	type ApprenticeReleaseDay,
	BLOCK_WEEK_TRAINING_ALLOWANCE_MINUTES,
} from "./release-credits";
import { loadApprenticeReleaseDays } from "./release-facts";

export type ApprenticeReleaseFindingKind =
	| "bbig_release_day_shift"
	| "jarbschg_school_day_workplace_return";

const apprenticeReleaseFindingKinds: ReadonlySet<string> = new Set<ApprenticeReleaseFindingKind>([
	"bbig_release_day_shift",
	"jarbschg_school_day_workplace_return",
]);

/**
 * What a release conflict is about: employee and the release day it conflicts with
 * (`periodStart`), whichever shift it is, whichever day that shift starts on, and whichever rule
 * the conflict cites. The rule follows from where the shift lies on the day (before early lessons,
 * or after the lessons began), so an edit that shortens a shift may change it; the day's conflicts
 * are judged together by the release time they cover. A shift through two release days has a
 * conflict in each day's scope, covering its work on that day. Null for other findings.
 */
export function apprenticeReleaseScopeOf(
	finding: Pick<StatutoryFinding, "kind" | "employeeId" | "periodStart"> & {
		readonly summary?: StatutoryFinding["summary"];
	},
): string | null {
	if (!apprenticeReleaseFindingKinds.has(finding.kind)) return null;
	// Work past a block week's training allowance: what is past it depends on the whole week.
	if (finding.summary?.limit) {
		const day = parsePlainDate(finding.periodStart);
		return JSON.stringify([
			"apprentice_block_week_training",
			finding.employeeId,
			day.subtract({ days: day.dayOfWeek - 1 }).toString(),
		]);
	}
	return JSON.stringify(["apprentice_release", finding.employeeId, finding.periodStart]);
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

/** The planned work inside the release time of `day`, or null. */
function coveredPartOf(
	work: PlannedWork,
	release: ApprenticeReleaseDay,
	day: PlainDate,
	timezone: string,
): { readonly start: Instant; readonly end: Instant } | null {
	const time = releaseTimeOf(release, day, timezone);
	if (!time) return null;
	const start = compareInstants(work.start, time.start) > 0 ? work.start : time.start;
	const end = compareInstants(work.end, time.end) < 0 ? work.end : time.end;
	return compareInstants(start, end) < 0 ? { start, end } : null;
}

type Span = { readonly start: Instant; readonly end: Instant };

/**
 * A span as a finding's depth: its minutes, and where it lies so work that overlapping shifts
 * share is counted once (`causedBlockingFindings`).
 */
function coverageOfSpan(
	part: Span | null,
): Pick<StatutoryFinding, "coveredMinutes" | "coveredSpan"> {
	if (!part) return {};
	return {
		coveredMinutes: Math.round(part.start.until(part.end).total("minutes")),
		coveredSpan: { start: part.start.toString(), end: part.end.toString() },
	};
}

/** A full block-week school day: in-company training of up to 2 h a week is allowed on it. */
const isFullBlockWeekDay = (release: ApprenticeReleaseDay) =>
	release.releaseKind === "vocational_school_block_week" && release.credit === "full_day";

/** Minutes of the union of `spans` (overlapping spans counted once). */
function unionMinutes(spans: readonly Span[]): number {
	return mergeSpans(spans).reduce(
		(total, span) => total + span.start.until(span.end).total("minutes"),
		0,
	);
}

function mergeSpans(spans: readonly Span[]): Span[] {
	const sorted = [...spans].sort((left, right) => compareInstants(left.start, right.start));
	const merged: { start: Instant; end: Instant }[] = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last && compareInstants(span.start, last.end) <= 0) {
			if (compareInstants(span.end, last.end) > 0) last.end = span.end;
		} else {
			merged.push({ start: span.start, end: span.end });
		}
	}
	return merged;
}

/**
 * When a week's planned work on full block days has used the training allowance: the instant at
 * which the union of `spans`, earliest first, reaches `allowanceMinutes`. Null while it stays
 * within it.
 */
function allowanceUsedAt(spans: readonly Span[], allowanceMinutes: number): Instant | null {
	let left = allowanceMinutes;
	for (const span of mergeSpans(spans)) {
		const minutes = span.start.until(span.end).total("minutes");
		if (minutes > left) return span.start.add({ nanoseconds: Math.round(left * 60e9) });
		left -= minutes;
	}
	return null;
}

/**
 * The conflict of `work` with the release on `releaseDay`: dated that day (for a night shift into
 * a school morning, the next day), citing the rule that day's release time sets, and as deep as
 * the work on that day alone. Its id names the release day, so a shift through two release days
 * has two conflicts, each judged, acknowledged and compared on its own day.
 */
function releaseConflictFinding(
	context: StatutoryScheduleContext,
	work: PlannedWork,
	release: ApprenticeReleaseDay,
	releaseDay: PlainDate,
	conflict: ReleaseConflict,
	{
		minor,
		training,
	}: {
		readonly minor: boolean;
		/**
		 * Work on a full block day past the week's training allowance: the part of this work past
		 * it, and the week's planned work on its block days (counted once).
		 */
		readonly training?: { readonly excess: Span; readonly weekMinutes: number };
	},
): StatutoryFinding<ApprenticeReleaseFindingKind> {
	const kind: ApprenticeReleaseFindingKind =
		minor && release.releaseKind === "vocational_school_day" && conflict === "release_day"
			? "jarbschg_school_day_workplace_return"
			: "bbig_release_day_shift";
	const subjectKey = work.ref;
	return {
		id: `${statutoryFindingId(kind, work.employeeId, subjectKey)}:${releaseDay}`,
		organizationId: context.organizationId,
		employeeId: work.employeeId,
		domain: "apprenticeship",
		kind,
		severity: minor ? "critical" : "warning",
		subjectKey,
		periodStart: releaseDay.toString(),
		periodEnd: releaseDay.add({ days: 1 }).toString(),
		legalReference: !minor
			? adultReference[conflict]
			: conflict === "release_day"
				? minorReleaseReference[release.releaseKind]
				: minorLessonReference[conflict],
		summary: training
			? {
					tier: "exceeded",
					used: { unit: "minutes", value: training.weekMinutes },
					limit: { unit: "minutes", value: BLOCK_WEEK_TRAINING_ALLOWANCE_MINUTES },
				}
			: { tier: "exceeded" },
		// Only the work past the allowance is covered: the allowed training is no conflict.
		...coverageOfSpan(
			training ? training.excess : coveredPartOf(work, release, releaseDay, context.timezone),
		),
		adminDetail: null,
		inputFingerprint: statutoryInputFingerprint({
			kind,
			employeeId: work.employeeId,
			subjectKey,
			releaseDay: releaseDay.toString(),
			start: work.start,
			end: work.end,
			releaseId: release.releaseId,
			releaseKind: release.releaseKind,
			credit: release.credit,
			conflict,
			minor,
			trainingExcess: training
				? [training.excess.start.toString(), training.excess.end.toString(), training.weekMinutes]
				: null,
		}),
		acknowledgementKind: null,
		blocksPublication: minor && context.preferences.blockJarbschgShiftPublish,
	};
}

const mondayOf = (day: PlainDate) => day.subtract({ days: day.dayOfWeek - 1 });

async function evaluate(context: StatutoryScheduleContext): Promise<StatutoryFinding[]> {
	const windowStart = parsePlainDate(context.window.start);
	const windowEnd = parsePlainDate(context.window.endExclusive);
	// Whole compliance weeks: a block week's training allowance is the week's. The Sunday before
	// too, for a night shift into Monday's block day, and the week after, for a night shift from the
	// window into a school morning or the next week's block.
	const weeksStart = mondayOf(windowStart);
	const weeksEnd = mondayOf(windowEnd.subtract({ days: 1 })).add({ days: 7 });
	const releaseDays = await loadApprenticeReleaseDays(context.db, {
		organizationId: context.organizationId,
		employeeIds: context.employeeIds,
		from: weeksStart.toString(),
		until: weeksEnd.add({ days: 8 }).toString(),
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
		from: weeksStart.subtract({ days: 1 }).toString(),
		until: weeksEnd.add({ days: 7 }).toString(),
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

	const inWindow = (day: PlainDate) =>
		Temporal.PlainDate.compare(day, windowStart) >= 0 &&
		Temporal.PlainDate.compare(day, windowEnd) < 0;
	/** Each conflict of planned work with a release day, the work's own day in the window. */
	const conflicts: {
		readonly work: PlannedWork;
		readonly release: ApprenticeReleaseDay;
		readonly releaseDay: PlainDate;
		readonly conflict: ReleaseConflict;
		/** Planned work loaded for the week's training allowance only. */
		readonly outsideWindow: boolean;
	}[] = [];
	for (const work of planned) {
		// Its own day, and the next one when it runs past midnight into a school morning.
		const lastDay = plainDateAt(work.end.subtract({ nanoseconds: 1 }), context.timezone);
		const days = lastDay.equals(work.date) ? [work.date] : [work.date, lastDay];
		// One conflict per release day it conflicts with, judged and dated on that day: a night
		// shift through two release days is a conflict on each, as deep as its work there.
		for (const releaseDay of days) {
			const release = releaseOn.get(`${work.employeeId}:${releaseDay}`);
			const conflict = release ? conflictOf(work, release, releaseDay, context.timezone) : null;
			if (!release || !conflict) continue;
			const proposed = !work.ref.startsWith("shift:");
			conflicts.push({
				work,
				release,
				releaseDay,
				conflict,
				outsideWindow: !proposed && !inWindow(work.date),
			});
		}
	}

	// § 9 Abs. 1 Nr. 3 JArbSchG, § 15 Abs. 1 Satz 3 BBiG: up to 2 h a week of planned work on
	// full block days, earliest first and overlapping shifts counted once, are allowed in-company
	// training. Only work past them conflicts, judged on the whole week whichever days are judged.
	const blockWork = new Map<string, { readonly part: Span }[]>();
	const weekKeyOf = (employeeId: string, releaseDay: PlainDate) =>
		`${employeeId}:${mondayOf(releaseDay)}`;
	for (const entry of conflicts) {
		if (!isFullBlockWeekDay(entry.release)) continue;
		const part = coveredPartOf(entry.work, entry.release, entry.releaseDay, context.timezone);
		if (!part) continue;
		const key = weekKeyOf(entry.work.employeeId, entry.releaseDay);
		const week = blockWork.get(key);
		if (week) week.push({ part });
		else blockWork.set(key, [{ part }]);
	}
	const allowance = new Map<string, { readonly usedAt: Instant; readonly weekMinutes: number }>();
	for (const [key, week] of blockWork) {
		const spans = week.map((entry) => entry.part);
		const usedAt = allowanceUsedAt(spans, BLOCK_WEEK_TRAINING_ALLOWANCE_MINUTES);
		if (usedAt) allowance.set(key, { usedAt, weekMinutes: Math.round(unionMinutes(spans)) });
	}

	const findings: StatutoryFinding<ApprenticeReleaseFindingKind>[] = [];
	for (const { work, release, releaseDay, conflict, outsideWindow } of conflicts) {
		const minor = isMinorOn(birthdays.get(work.employeeId) ?? null, releaseDay);
		if (!isFullBlockWeekDay(release)) {
			if (outsideWindow) continue;
			findings.push(
				releaseConflictFinding(context, work, release, releaseDay, conflict, { minor }),
			);
			continue;
		}
		// Reported whenever the block day's week touches the window: work earlier in the week
		// moves what is past the allowance onto later days.
		const monday = mondayOf(releaseDay);
		const weekTouchesWindow =
			Temporal.PlainDate.compare(monday, windowEnd) < 0 &&
			Temporal.PlainDate.compare(monday.add({ days: 7 }), windowStart) > 0;
		if (outsideWindow && !weekTouchesWindow) continue;
		const week = allowance.get(weekKeyOf(work.employeeId, releaseDay));
		const part = coveredPartOf(work, release, releaseDay, context.timezone);
		if (!week || !part) continue;
		const start = compareInstants(part.start, week.usedAt) > 0 ? part.start : week.usedAt;
		if (compareInstants(start, part.end) >= 0) continue;
		findings.push(
			releaseConflictFinding(context, work, release, releaseDay, conflict, {
				minor,
				training: { excess: { start, end: part.end }, weekMinutes: week.weekMinutes },
			}),
		);
	}
	return findings;
}

export const apprenticeReleaseScheduleContributor: StatutoryScheduleContributor = {
	domain: "apprenticeship",
	evaluate,
};
