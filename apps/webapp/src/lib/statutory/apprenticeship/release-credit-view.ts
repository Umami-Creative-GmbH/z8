/**
 * Apprentice release records with what each one credits (#1993), for Employee Detail and the
 * employee's own profile. Wage-free: release credits are minutes and days only, so org admins,
 * the employee's managers and the employee see the same view.
 */
import { and, eq } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { type ApprenticeReleaseKind, employeeApprenticeRelease } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import {
	markEmployeeWorkBalanceDirty,
	refreshEmployeeWorkBalanceFromPeriods,
} from "@/lib/work-balance/service";
import {
	listApprenticeReleases,
	recordApprenticeRelease,
	voidApprenticeRelease,
} from "../employee-context";
import { isMinorOn } from "../youth/age";
import { loadEmployeeBirthdays, loadHolidayDateKeys } from "../youth/youth-facts";
import { apprenticeReleaseDays } from "./release-credits";
import { loadApprenticeReleaseRecords } from "./release-facts";

type Reader = Pick<DatabaseClient, "select">;

const logger = createLogger("ApprenticeRelease");

export interface ApprenticeReleaseCreditView {
	readonly id: string;
	readonly releaseKind: ApprenticeReleaseKind;
	readonly startsOn: string;
	readonly endsOn: string;
	readonly lessonCount: number | null;
	readonly schoolMinutes: number | null;
	/** An exam's local start time, `HH:MM`, when it was recorded with its time. */
	readonly examStartTime: string | null;
	readonly note: string | null;
	/** Days released in full: their whole working time is credited. */
	readonly fullDays: number;
	/** School minutes credited on days that are only partly released. */
	readonly creditedMinutes: number;
	/**
	 * The week's full school day (more than five lessons of 45 minutes) of an employee under 18:
	 * they may not return to the workplace afterwards (§ 9 Abs. 1 Nr. 2 JArbSchG).
	 */
	readonly flagsWorkplaceReturn: boolean;
}

export interface ApprenticeReleaseCredits {
	/** Whether the employee's terms make them an apprentice today. */
	readonly isApprentice: boolean;
	readonly releases: readonly ApprenticeReleaseCreditView[];
}

export type ApprenticeReleaseRefusal =
	| "apprentice_release_not_apprentice"
	| "apprentice_release_lessons_required"
	| "apprentice_release_school_minutes_required"
	| "apprentice_release_no_preceding_working_day"
	| "apprentice_release_exam_time_invalid";

function refuse(refusal: ApprenticeReleaseRefusal, message: string, field?: string): never {
	throw new ValidationError({ message, refusal, field });
}

function eachDay(startsOn: string, endsOn: string): PlainDate[] {
	const days: PlainDate[] = [];
	const end = parsePlainDate(endsOn);
	for (let day = parsePlainDate(startsOn); day.until(end).sign >= 0; day = day.add({ days: 1 })) {
		days.push(day);
	}
	return days;
}

/** The employee's active release records with their credits, newest first. */
export async function loadApprenticeReleaseCredits(
	db: Reader,
	input: { readonly organizationId: string; readonly employeeId: string; readonly today: string },
): Promise<ApprenticeReleaseCredits> {
	const releases = await listApprenticeReleases(db, input);
	const contracts = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		dates: [parsePlainDate(input.today)],
	});
	const birthday =
		(
			await loadEmployeeBirthdays(db, {
				organizationId: input.organizationId,
				employeeIds: [input.employeeId],
			})
		).get(input.employeeId) ?? null;
	const days = apprenticeReleaseDays(releases);
	return {
		isApprentice:
			contracts.get(input.employeeId)?.get(input.today)?.employmentProfile === "apprentice",
		releases: releases
			.map((release) => {
				const own = days.filter((day) => day.releaseId === release.id);
				const partial = own.filter((day) => day.credit === "school_minutes");
				return {
					id: release.id,
					releaseKind: release.releaseKind,
					startsOn: release.startsOn,
					endsOn: release.endsOn,
					lessonCount: release.lessonCount,
					schoolMinutes: release.schoolMinutes,
					examStartTime: release.examStartTime?.slice(0, 5) ?? null,
					note: release.note,
					fullDays: own.length - partial.length,
					creditedMinutes: partial.reduce((total, day) => total + (day.minutes ?? 0), 0),
					flagsWorkplaceReturn:
						release.releaseKind === "vocational_school_day" &&
						own.length > partial.length &&
						isMinorOn(birthday, parsePlainDate(release.startsOn)),
				};
			})
			.reverse(),
	};
}

/**
 * Records a release for an apprentice. Every released day must fall under apprentice terms; a
 * school day needs its lesson count and a block week its school minutes. With
 * `includePreExamDay`, an exam day also releases the working day immediately before it in full,
 * unless that day is already released in full; a partly credited single-day release on it is
 * replaced (`makeRoomForPreExamDay`).
 */
export async function recordApprenticeReleaseWithCredit(
	db: Pick<DatabaseClient, "select" | "insert" | "update" | "transaction">,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly actorUserId: string;
		readonly releaseKind: ApprenticeReleaseKind;
		readonly startsOn: string;
		readonly endsOn: string;
		readonly lessonCount?: number | null;
		readonly schoolMinutes?: number | null;
		/** When the exam starts and ends, local `HH:MM`: the exam day then credits only that time. */
		readonly examStartTime?: string | null;
		readonly examEndTime?: string | null;
		readonly note?: string | null;
		readonly includePreExamDay?: boolean;
	},
): Promise<void> {
	const exam =
		input.releaseKind === "exam_day"
			? await examTimeOf(db, input)
			: { startTime: null, minutes: null };
	if (input.releaseKind === "vocational_school_day" && input.lessonCount == null) {
		refuse("apprentice_release_lessons_required", "Enter the number of lessons", "lessonCount");
	}
	if (input.releaseKind === "vocational_school_block_week" && input.schoolMinutes == null) {
		refuse(
			"apprentice_release_school_minutes_required",
			"Enter the planned school hours of the block week",
			"schoolMinutes",
		);
	}
	let dates: PlainDate[];
	try {
		dates = eachDay(input.startsOn, input.endsOn);
	} catch {
		throw new ValidationError({
			message: "Dates must use YYYY-MM-DD",
			refusal: "statutory_invalid_range",
		});
	}
	const examDay = parsePlainDate(input.startsOn);
	const lookback =
		input.releaseKind === "exam_day" && input.includePreExamDay
			? Array.from({ length: 7 }, (_, index) => examDay.subtract({ days: index + 1 }))
			: [];
	const contracts = (
		await loadEffectiveContractsBatch(db, {
			organizationId: input.organizationId,
			employeeIds: [input.employeeId],
			dates: [...dates, ...lookback],
		})
	).get(input.employeeId);
	if (!contracts) {
		throw new NotFoundError({
			message: "Employee not found",
			entityType: "employee",
			entityId: input.employeeId,
		});
	}
	if (dates.some((day) => contracts.get(day.toString())?.employmentProfile !== "apprentice")) {
		refuse(
			"apprentice_release_not_apprentice",
			"Release days can only be recorded while the employee's terms make them an apprentice",
		);
	}
	// The working day before the exam: a public holiday is no working day.
	const holidays =
		lookback.length > 0
			? ((
					await loadHolidayDateKeys(db, {
						organizationId: input.organizationId,
						employeeIds: [input.employeeId],
						from: lookback[lookback.length - 1].toString(),
						until: examDay.toString(),
					})
				).get(input.employeeId) ?? new Set<string>())
			: new Set<string>();
	const preExamDay = lookback.find((day) => {
		const contract = contracts.get(day.toString());
		return (
			contract?.isWorkDay &&
			contract.employmentProfile === "apprentice" &&
			!holidays.has(day.toString())
		);
	});
	if (input.includePreExamDay && input.releaseKind === "exam_day" && !preExamDay) {
		refuse(
			"apprentice_release_no_preceding_working_day",
			"No working day in the week before the exam to release",
		);
	}

	const base = {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
		note: input.note,
	};
	// The release changes the required time of its days and the week's full school day attribution.
	const dirtyFromDate = mondayOf(preExamDay ?? examDay);
	await db.transaction(async (tx) => {
		const releasePreExamDay = preExamDay
			? await makeRoomForPreExamDay(tx, { ...base, preExamDay })
			: false;
		if (preExamDay && releasePreExamDay) {
			await recordApprenticeRelease(tx, {
				...base,
				releaseKind: "pre_exam_day",
				startsOn: preExamDay.toString(),
				endsOn: preExamDay.toString(),
			});
		}
		await recordApprenticeRelease(tx, {
			...base,
			releaseKind: input.releaseKind,
			startsOn: input.startsOn,
			endsOn: input.endsOn,
			lessonCount: input.lessonCount ?? null,
			schoolMinutes:
				input.releaseKind === "exam_day" ? exam.minutes : (input.schoolMinutes ?? null),
			examStartTime: exam.startTime,
		});
		await markEmployeeWorkBalanceDirty(
			{ organizationId: input.organizationId, employeeId: input.employeeId, dirtyFromDate },
			tx,
		);
	});
	await refreshWorkBalanceAfterCommit({ ...input, dirtyFromDate });
}

/** Audit reason of a partly credited release that a pre-exam day release replaces. */
export const PRE_EXAM_DAY_SUPERSEDES_REASON =
	"Superseded by the pre-exam day release in full (§ 15 Abs. 2 Nr. 5 BBiG, § 10 Abs. 1 Nr. 2 JArbSchG)";

/**
 * Whether the pre-exam day can be released in full, inside the recording transaction. A day
 * already released in full (e.g. the week's full school day) is not recorded twice. A day that is
 * only partly credited (a short school day, a timed exam) is upgraded: its single-day release is
 * voided with an audit reason, so the full pre-exam release takes its place without overlapping
 * it. A block week is never split: a day inside a block stays as the block credits it.
 */
async function makeRoomForPreExamDay(
	tx: Pick<DatabaseClient, "select" | "insert" | "update">,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly actorUserId: string;
		readonly preExamDay: PlainDate;
	},
): Promise<boolean> {
	const day = input.preExamDay.toString();
	const monday = parsePlainDate(mondayOf(input.preExamDay));
	// The whole week, so the week's full school day is attributed as everywhere else.
	const records =
		(
			await loadApprenticeReleaseRecords(tx, {
				organizationId: input.organizationId,
				employeeIds: [input.employeeId],
				from: monday.toString(),
				until: monday.add({ days: 7 }).toString(),
			})
		).get(input.employeeId) ?? [];
	const onDay = apprenticeReleaseDays(records).filter((credited) => credited.date === day);
	if (onDay.length === 0) return true;
	if (onDay.some((credited) => credited.credit === "full_day")) return false;
	const covering = records.filter((record) => record.startsOn <= day && record.endsOn >= day);
	if (covering.some((record) => record.startsOn !== record.endsOn)) return false;
	for (const record of covering) {
		await voidApprenticeRelease(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			actorUserId: input.actorUserId,
			releaseId: record.id,
			reason: PRE_EXAM_DAY_SUPERSEDES_REASON,
		});
	}
	return true;
}

/**
 * Voids a release and marks the employee's stored work balance for recomputation from the
 * release's week, so it no longer credits the release however far back it lies.
 */
export async function voidApprenticeReleaseWithCredit(
	db: Pick<DatabaseClient, "select" | "insert" | "update" | "transaction">,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly actorUserId: string;
		readonly releaseId: string;
		readonly reason: string;
	},
): Promise<void> {
	const [release] = await db
		.select({ startsOn: employeeApprenticeRelease.startsOn })
		.from(employeeApprenticeRelease)
		.where(
			and(
				eq(employeeApprenticeRelease.id, input.releaseId),
				eq(employeeApprenticeRelease.organizationId, input.organizationId),
				eq(employeeApprenticeRelease.employeeId, input.employeeId),
			),
		);
	const dirtyFromDate = release ? mondayOf(parsePlainDate(release.startsOn)) : null;
	await db.transaction(async (tx) => {
		await voidApprenticeRelease(tx, input);
		if (dirtyFromDate) {
			await markEmployeeWorkBalanceDirty(
				{ organizationId: input.organizationId, employeeId: input.employeeId, dirtyFromDate },
				tx,
			);
		}
	});
	if (dirtyFromDate) await refreshWorkBalanceAfterCommit({ ...input, dirtyFromDate });
}

const mondayOf = (day: PlainDate) => day.subtract({ days: day.dayOfWeek - 1 }).toString();

const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * An exam's start and participation time including breaks, from its local start and end on the
 * exam day in the organization's zone. Both or neither: without them the whole day is released.
 */
async function examTimeOf(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly startsOn: string;
		readonly examStartTime?: string | null;
		readonly examEndTime?: string | null;
	},
): Promise<{ readonly startTime: string | null; readonly minutes: number | null }> {
	const startTime = input.examStartTime || null;
	const endTime = input.examEndTime || null;
	if (!startTime && !endTime) return { startTime: null, minutes: null };
	if (!startTime || !endTime || !WALL_TIME.test(startTime) || !WALL_TIME.test(endTime)) {
		refuse(
			"apprentice_release_exam_time_invalid",
			"Enter when the exam starts and ends, or neither",
			"examStartTime",
		);
	}
	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	let day: PlainDate;
	try {
		day = parsePlainDate(input.startsOn);
	} catch {
		throw new ValidationError({
			message: "Dates must use YYYY-MM-DD",
			refusal: "statutory_invalid_range",
		});
	}
	const at = (time: string) =>
		day
			.toZonedDateTime({ timeZone: timezone, plainTime: Temporal.PlainTime.from(time) })
			.toInstant();
	const minutes = Math.round(at(startTime).until(at(endTime)).total({ unit: "minutes" }));
	if (minutes <= 0) {
		refuse(
			"apprentice_release_exam_time_invalid",
			"The exam must end after it starts",
			"examEndTime",
		);
	}
	return { startTime, minutes };
}

/** Recomputes the stored balance now; the balance worker retries a failed refresh. */
async function refreshWorkBalanceAfterCommit(input: {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly dirtyFromDate: string;
}): Promise<void> {
	try {
		await refreshEmployeeWorkBalanceFromPeriods({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			dirtyFromDate: input.dirtyFromDate,
		});
	} catch (error) {
		logger.error(
			{ error, organizationId: input.organizationId, employeeId: input.employeeId },
			"Work balance refresh after an apprentice release change failed; the balance worker retries it",
		);
	}
}
