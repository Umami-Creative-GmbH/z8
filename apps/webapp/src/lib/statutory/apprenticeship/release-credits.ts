/**
 * BBiG § 15 / JArbSchG § 9 apprentice release crediting (#1993), pure.
 *
 * Release days are paid: Work Balance credits them by releasing required working time, never by
 * adding worked minutes, so a release day can bring the day's requirement down to zero but never
 * produces a negative balance, and Absences count full release days as no working day, so a
 * vacation spanning them never deducts them.
 *
 * - A vocational-school day with more than five lessons of at least 45 minutes, once per
 *   compliance week, credits the full working day (§ 15 Abs. 2 Nr. 2 BBiG); other school days
 *   credit their school time including breaks (§ 15 Abs. 2 Nr. 1), lessons × 45 min when the
 *   school time is not recorded.
 * - A block-release week of at least 25 hours on at least five days credits the full working
 *   week (§ 15 Abs. 2 Nr. 3); a shorter block spreads its school time over its days. A block
 *   record may span several weeks: it is credited per compliance week (Monday to Sunday), on its
 *   school days (Monday to Friday) only, and its school minutes are the school time per week; a
 *   partial first or last week credits the share of that time its school days make of five.
 * - An exam frees and credits its participation time including breaks (§ 15 Abs. 2 Nr. 4 BBiG,
 *   § 10 Abs. 2 Nr. 1 JArbSchG); an exam recorded without its time releases the whole day. The
 *   working day immediately before the written final exam is released in full (§ 15 Abs. 2
 *   Nr. 5 BBiG, § 10 Abs. 1 Nr. 2 JArbSchG).
 */
import type { ApprenticeReleaseKind } from "@/db/schema";
import { preserveTrustBasedBalanceDates } from "@/lib/calendar/trust-based-dates";
import type { DailyWorkRequirements } from "@/lib/calendar/types";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";

/** § 15 Abs. 2 Nr. 2 BBiG: more than five lessons of at least 45 minutes. */
export const FULL_SCHOOL_DAY_MIN_LESSONS = 6;
export const LESSON_MINUTES = 45;
/** § 15 Abs. 2 Nr. 3 BBiG: at least 25 hours on at least five days. */
export const FULL_BLOCK_WEEK_MIN_MINUTES = 25 * 60;
export const FULL_BLOCK_WEEK_MIN_DAYS = 5;
/** A block record is credited on its school days, Monday to Friday. */
export const SCHOOL_DAYS_PER_WEEK = 5;

export interface ApprenticeReleaseRecord {
	readonly id: string;
	readonly releaseKind: ApprenticeReleaseKind;
	/** Inclusive. */
	readonly startsOn: string;
	/** Inclusive. */
	readonly endsOn: string;
	readonly lessonCount: number | null;
	readonly schoolMinutes: number | null;
	/** An exam's local start time (`HH:MM[:SS]`); its `schoolMinutes` are its duration. */
	readonly examStartTime: string | null;
}

/** One credited release day. */
export interface ApprenticeReleaseDay {
	readonly date: string;
	readonly releaseId: string;
	readonly releaseKind: ApprenticeReleaseKind;
	/** `full_day` releases the whole day; `school_minutes` credits `minutes` of it. */
	readonly credit: "full_day" | "school_minutes";
	readonly minutes: number | null;
	/** An exam credited with its time: when it starts, local wall time. */
	readonly examStartTime?: string;
	/**
	 * The employee's average working day and week under their effective terms on this day, which
	 * a full release day or block week is credited with as working time (§ 15 Abs. 2 BBiG, §§ 9
	 * Abs. 2, 10 Abs. 2 JArbSchG). Absent or null when the terms give no working time.
	 */
	readonly averageWorkingTime?: AverageWorkingTime | null;
}

/** Average working time from the weekly schedule of effective terms. */
export interface AverageWorkingTime {
	readonly dailyMinutes: number;
	readonly weeklyMinutes: number;
}

/**
 * The average working day and week of a weekly schedule: its working days' minutes, else the
 * weekly contract minutes over five days; null when neither gives any working time.
 */
export function averageWorkingTimeOf(terms: {
	readonly weeklyScheduleDays: readonly {
		readonly isWorkDay: boolean;
		readonly minutesPerDay: number;
	}[];
	readonly weeklyContractMinutes: number | null;
}): AverageWorkingTime | null {
	const workDays = terms.weeklyScheduleDays.filter((day) => day.isWorkDay && day.minutesPerDay > 0);
	const scheduled = workDays.reduce((total, day) => total + day.minutesPerDay, 0);
	if (scheduled > 0) {
		return { dailyMinutes: Math.round(scheduled / workDays.length), weeklyMinutes: scheduled };
	}
	const weekly = terms.weeklyContractMinutes ?? 0;
	return weekly > 0
		? { dailyMinutes: Math.round(weekly / SCHOOL_DAYS_PER_WEEK), weeklyMinutes: weekly }
		: null;
}

function eachDay(startsOn: string, endsOn: string): PlainDate[] {
	const days: PlainDate[] = [];
	const end = parsePlainDate(endsOn);
	for (let day = parsePlainDate(startsOn); day.until(end).sign >= 0; day = day.add({ days: 1 })) {
		days.push(day);
	}
	return days;
}

const mondayOf = (day: PlainDate) => day.subtract({ days: day.dayOfWeek - 1 }).toString();

/** Whether a school day has more than five lessons; an unrecorded count is given the benefit. */
function isLongSchoolDay(release: ApprenticeReleaseRecord): boolean {
	return release.lessonCount === null || release.lessonCount >= FULL_SCHOOL_DAY_MIN_LESSONS;
}

function schoolMinutesOf(release: ApprenticeReleaseRecord): number {
	return release.schoolMinutes ?? (release.lessonCount ?? 0) * LESSON_MINUTES;
}

/** The credited days of active release records, by date. Pass every record of each touched week. */
export function apprenticeReleaseDays(
	releases: readonly ApprenticeReleaseRecord[],
): ApprenticeReleaseDay[] {
	const days: ApprenticeReleaseDay[] = [];
	const weeksWithFullSchoolDay = new Set<string>();
	const ordered = [...releases].sort((left, right) => left.startsOn.localeCompare(right.startsOn));
	for (const release of ordered) {
		const base = { releaseId: release.id, releaseKind: release.releaseKind };
		switch (release.releaseKind) {
			case "exam_day":
				// The exam frees and credits its participation time including breaks; without a
				// recorded time the whole day is released, as before exam times were recorded.
				if (release.schoolMinutes !== null && release.examStartTime !== null) {
					days.push({
						...base,
						date: release.startsOn,
						credit: "school_minutes",
						minutes: release.schoolMinutes,
						examStartTime: release.examStartTime,
					});
				} else {
					days.push({ ...base, date: release.startsOn, credit: "full_day", minutes: null });
				}
				break;
			case "pre_exam_day":
				days.push({ ...base, date: release.startsOn, credit: "full_day", minutes: null });
				break;
			case "vocational_school_day": {
				const week = mondayOf(parsePlainDate(release.startsOn));
				if (isLongSchoolDay(release) && !weeksWithFullSchoolDay.has(week)) {
					weeksWithFullSchoolDay.add(week);
					days.push({ ...base, date: release.startsOn, credit: "full_day", minutes: null });
				} else {
					days.push({
						...base,
						date: release.startsOn,
						credit: "school_minutes",
						minutes: schoolMinutesOf(release),
					});
				}
				break;
			}
			case "vocational_school_block_week": {
				// Credited per school week: a record spanning several weeks is split at Mondays, and
				// only its school days (Monday to Friday) are credited.
				const schoolWeeks = new Map<string, PlainDate[]>();
				for (const day of eachDay(release.startsOn, release.endsOn)) {
					if (day.dayOfWeek > 5) continue;
					const week = schoolWeeks.get(mondayOf(day));
					if (week) week.push(day);
					else schoolWeeks.set(mondayOf(day), [day]);
				}
				// The school minutes are per week. A record within one week holds that week's school
				// time; a partial first or last week of a longer block holds its share of the weekly
				// time, by its school days out of five.
				const multiWeek = schoolWeeks.size > 1;
				for (const weekDays of schoolWeeks.values()) {
					const full =
						weekDays.length >= FULL_BLOCK_WEEK_MIN_DAYS &&
						(release.schoolMinutes === null ||
							release.schoolMinutes >= FULL_BLOCK_WEEK_MIN_MINUTES);
					const weekMinutes = multiWeek
						? ((release.schoolMinutes ?? 0) * Math.min(weekDays.length, SCHOOL_DAYS_PER_WEEK)) /
							SCHOOL_DAYS_PER_WEEK
						: (release.schoolMinutes ?? 0);
					const perDay = full ? null : Math.round(weekMinutes / weekDays.length);
					for (const day of weekDays) {
						days.push({
							...base,
							date: day.toString(),
							credit: full ? "full_day" : "school_minutes",
							minutes: perDay,
						});
					}
				}
				break;
			}
		}
	}
	return days.sort((left, right) => left.date.localeCompare(right.date));
}

/** The dates released in full. Absences count them as no working day. */
export function fullReleaseDates(days: readonly ApprenticeReleaseDay[]): Set<string> {
	return new Set(days.filter((day) => day.credit === "full_day").map((day) => day.date));
}

/**
 * Releases required working time on credited days: a full release day requires nothing, a
 * school-time credit lowers the requirement, never below zero. A day is released at most once:
 * several releases on one date credit the largest of them, never their sum, as JArbSchG counts
 * them (`youthSchoolCreditsOf`).
 */
export function applyApprenticeReleaseCredits(
	requirements: DailyWorkRequirements,
	days: readonly ApprenticeReleaseDay[],
): DailyWorkRequirements {
	if (days.length === 0) return requirements;
	const credits = new Map<string, number>();
	for (const day of days) {
		const credit = day.credit === "full_day" ? Number.POSITIVE_INFINITY : (day.minutes ?? 0);
		credits.set(day.date, Math.max(credits.get(day.date) ?? 0, credit));
	}
	const credited: DailyWorkRequirements = {};
	for (const [date, requirement] of Object.entries(requirements)) {
		const credit = credits.get(date) ?? 0;
		credited[date] =
			credit > 0
				? {
						...requirement,
						requiredMinutes: Math.max(0, requirement.requiredMinutes - credit),
					}
				: requirement;
	}
	return preserveTrustBasedBalanceDates(requirements, credited);
}
