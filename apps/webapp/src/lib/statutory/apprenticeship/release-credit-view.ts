/**
 * Apprentice release records with what each one credits (#1993), for Employee Detail and the
 * employee's own profile. Wage-free: release credits are minutes and days only, so org admins,
 * the employee's managers and the employee see the same view.
 */
import { and, asc, eq } from "drizzle-orm";
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

/** How many days before an exam its pre-exam day is looked for, across a multi-day exam. */
const PRE_EXAM_LOOKBACK_DAYS = 14;

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
	| "apprentice_release_exam_time_invalid"
	| "apprentice_release_school_time_invalid"
	| "apprentice_release_day_already_released";

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
 * school day needs its lesson count and a block week its school minutes. A day holds one
 * release: recording on a day already released is refused, except that a pre-exam day replaces a
 * single-day school release or lies on top of a partly credited block day
 * (`makeRoomForPreExamDay`), and an exam replaces a pre-exam day.
 *
 * With `includePreExamDay`, an exam day also releases the working day before it in full, unless
 * that day is already released in full for good. Exam days are skipped: a multi-day exam has one
 * pre-exam day, the working day before its first exam day, and an exam is never voided for it.
 * An exam recorded on a pre-exam day moves that pre-exam day before itself.
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
		/**
		 * When a school day's school starts and ends, local `HH:MM`: it then credits that school time
		 * including breaks instead of its lessons × 45 minutes.
		 */
		readonly schoolStartTime?: string | null;
		readonly schoolEndTime?: string | null;
		readonly note?: string | null;
		readonly includePreExamDay?: boolean;
	},
): Promise<void> {
	const exam =
		input.releaseKind === "exam_day"
			? await examTimeOf(db, input)
			: { startTime: null, minutes: null };
	const schoolMinutes =
		input.releaseKind === "exam_day"
			? exam.minutes
			: input.releaseKind === "vocational_school_day"
				? ((await schoolTimeOf(db, input)) ?? input.schoolMinutes ?? null)
				: (input.schoolMinutes ?? null);
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
	const contracts = (
		await loadEffectiveContractsBatch(db, {
			organizationId: input.organizationId,
			employeeIds: [input.employeeId],
			dates,
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
	// An exam may move a pre-exam day recorded on its date, so the days before it are read in any
	// case. A public holiday is no working day.
	const before =
		input.releaseKind === "exam_day"
			? await workingDaysBefore(db, { ...input, day: examDay })
			: null;

	const base = {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
		note: input.note,
	};
	const firstTouched = await db.transaction(async (tx) => {
		const onNewDays = await listApprenticeReleases(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			from: input.startsOn,
			until: parsePlainDate(input.endsOn).add({ days: 1 }).toString(),
		});
		let touched = examDay;
		let preExamDayMoved = false;
		if (input.releaseKind === "pre_exam_day") {
			if (!(await makeRoomForPreExamDay(tx, { ...base, preExamDay: examDay }))) {
				refuseDayAlreadyReleased();
			}
		} else {
			for (const record of onNewDays) {
				// An exam day needs no pre-exam release of its own: a pre-exam day recorded on it moves
				// to the working day before the exam.
				if (input.releaseKind === "exam_day" && record.releaseKind === "pre_exam_day") {
					await voidApprenticeRelease(tx, {
						...base,
						releaseId: record.id,
						reason: EXAM_ON_PRE_EXAM_DAY_REASON,
					});
					preExamDayMoved = true;
					continue;
				}
				refuseDayAlreadyReleased();
			}
		}
		const recorded = await recordApprenticeRelease(tx, {
			...base,
			releaseKind: input.releaseKind,
			startsOn: input.startsOn,
			endsOn: input.endsOn,
			lessonCount: input.lessonCount ?? null,
			schoolMinutes,
			examStartTime: exam.startTime,
		});
		if (before && (input.includePreExamDay || preExamDayMoved)) {
			const preExamDay = await releasePreExamDayFor(tx, { ...base, ...before, exam: recorded });
			if (!preExamDay) {
				refuse(
					"apprentice_release_no_preceding_working_day",
					"No working day in the week before the exam to release",
				);
			}
			touched = preExamDay;
		}
		// The release changes the required time of its days and the week's full school day attribution.
		await markEmployeeWorkBalanceDirty(
			{
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				dirtyFromDate: mondayOf(touched),
			},
			tx,
		);
		return touched;
	});
	await refreshWorkBalanceAfterCommit({ ...input, dirtyFromDate: mondayOf(firstTouched) });
}

function refuseDayAlreadyReleased(): never {
	refuse(
		"apprentice_release_day_already_released",
		"This day is already released. Remove the release recorded on it first",
		"startsOn",
	);
}

/** Audit reason of a partly credited release that a pre-exam day release replaces. */
export const PRE_EXAM_DAY_SUPERSEDES_REASON =
	"Superseded by the pre-exam day release in full (§ 15 Abs. 2 Nr. 5 BBiG, § 10 Abs. 1 Nr. 2 JArbSchG)";

/** Audit reason of a pre-exam day release voided because the day is itself an exam day. */
export const EXAM_ON_PRE_EXAM_DAY_REASON =
	"The day is itself an exam day; the pre-exam day moves to the working day before the exam";

/** Audit reason of a pre-exam day release voided with the exam it was released for. */
export const EXAM_VOIDED_REASON = "The exam this pre-exam day was released for was voided";

type Writer = Pick<DatabaseClient, "select" | "insert" | "update">;

interface ReleaseScope {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly actorUserId: string;
	readonly note?: string | null;
}

/**
 * Releases the pre-exam day of an exam inside a transaction and links it to the exam: the working
 * day before the exam, skipping exam days, so a multi-day exam has one pre-exam day before its
 * first exam day. Returns that day, or null when the lookback holds no working day. A day already
 * released in full for good is left as it is.
 */
async function releasePreExamDayFor(
	tx: Writer,
	input: ReleaseScope & {
		readonly exam: { readonly id: string; readonly startsOn: string };
		/** The days before the exam, nearest first. */
		readonly lookback: readonly PlainDate[];
		readonly isWorkingDay: (day: PlainDate) => boolean;
	},
): Promise<PlainDate | null> {
	const earlier = await listApprenticeReleases(tx, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		from: (
			input.lookback[input.lookback.length - 1] ?? parsePlainDate(input.exam.startsOn)
		).toString(),
		until: input.exam.startsOn,
	});
	const examDays = new Set(
		earlier.filter((record) => record.releaseKind === "exam_day").map((record) => record.startsOn),
	);
	const preExamDay = input.lookback.find(
		(day) => !examDays.has(day.toString()) && input.isWorkingDay(day),
	);
	if (!preExamDay) return null;
	if (await makeRoomForPreExamDay(tx, { ...input, preExamDay, examReleaseId: input.exam.id })) {
		await recordApprenticeRelease(tx, {
			...input,
			releaseKind: "pre_exam_day",
			startsOn: preExamDay.toString(),
			endsOn: preExamDay.toString(),
			examReleaseId: input.exam.id,
		});
	}
	return preExamDay;
}

/** The days before `day` a pre-exam day is looked for on, nearest first, and which are working days. */
async function workingDaysBefore(
	db: Reader,
	input: { readonly organizationId: string; readonly employeeId: string; readonly day: PlainDate },
): Promise<{
	readonly lookback: PlainDate[];
	readonly isWorkingDay: (day: PlainDate) => boolean;
}> {
	const lookback = Array.from({ length: PRE_EXAM_LOOKBACK_DAYS }, (_, index) =>
		input.day.subtract({ days: index + 1 }),
	);
	const contracts = (
		await loadEffectiveContractsBatch(db, {
			organizationId: input.organizationId,
			employeeIds: [input.employeeId],
			dates: lookback,
		})
	).get(input.employeeId);
	const holidays =
		(
			await loadHolidayDateKeys(db, {
				organizationId: input.organizationId,
				employeeIds: [input.employeeId],
				from: lookback[lookback.length - 1].toString(),
				until: input.day.toString(),
			})
		).get(input.employeeId) ?? new Set<string>();
	return {
		lookback,
		isWorkingDay: (day) => {
			const contract = contracts?.get(day.toString());
			return Boolean(
				contract?.isWorkDay &&
				contract.employmentProfile === "apprentice" &&
				!holidays.has(day.toString()),
			);
		},
	};
}

/**
 * Whether the pre-exam day can be released in full, inside the recording transaction. A day
 * already released in full for good (a full block week, an exam without its time, a pre-exam day)
 * is not recorded twice, and an exam is never voided. Any other single-day release on it (a
 * school day, whose full credit may move to a long school day recorded later in the week) is
 * voided with an audit reason, so the full pre-exam release takes its place without overlapping
 * it. A block week is never split or voided: a full block day stays as the block credits it, and
 * on a day the block credits only partly the pre-exam day is recorded on top of the block.
 */
async function makeRoomForPreExamDay(
	tx: Pick<DatabaseClient, "select" | "insert" | "update">,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly actorUserId: string;
		readonly preExamDay: PlainDate;
		/** The exam the pre-exam day is released for: what it replaces is linked to it. */
		readonly examReleaseId?: string;
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
	// A school day's full credit goes to the week's first long school day, so a school day
	// recorded earlier in the week later takes it: only other full releases stay full for good.
	if (
		onDay.some(
			(credited) =>
				credited.releaseKind === "exam_day" ||
				(credited.credit === "full_day" && credited.releaseKind !== "vocational_school_day"),
		)
	) {
		return false;
	}
	// A block that credits the day only partly stays as it is: the pre-exam day is released in full
	// on top of it, and each day is credited once, with its largest release.
	const covering = records.filter(
		(record) => record.startsOn <= day && record.endsOn >= day && record.startsOn === record.endsOn,
	);
	for (const record of covering) {
		await voidApprenticeRelease(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			actorUserId: input.actorUserId,
			releaseId: record.id,
			reason: PRE_EXAM_DAY_SUPERSEDES_REASON,
		});
		if (input.examReleaseId) {
			await tx
				.update(employeeApprenticeRelease)
				.set({ examReleaseId: input.examReleaseId })
				.where(
					and(
						eq(employeeApprenticeRelease.id, record.id),
						eq(employeeApprenticeRelease.organizationId, input.organizationId),
						eq(employeeApprenticeRelease.employeeId, input.employeeId),
					),
				);
		}
	}
	return true;
}

/**
 * Voids a release and marks the employee's stored work balance for recomputation from the
 * release's week, so it no longer credits the release however far back it lies.
 *
 * Voiding an exam undoes what it caused: its pre-exam day is voided too, and a release that pre-
 * exam day replaced is recorded again with an audit note, when its days are still free. When a
 * later exam day of the same multi-day exam remains, it keeps a pre-exam day: the working day
 * before it, now that the voided exam day no longer is one.
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
		.select({
			startsOn: employeeApprenticeRelease.startsOn,
			releaseKind: employeeApprenticeRelease.releaseKind,
			voidedAt: employeeApprenticeRelease.voidedAt,
		})
		.from(employeeApprenticeRelease)
		.where(
			and(
				eq(employeeApprenticeRelease.id, input.releaseId),
				eq(employeeApprenticeRelease.organizationId, input.organizationId),
				eq(employeeApprenticeRelease.employeeId, input.employeeId),
			),
		);
	const examDay =
		release?.releaseKind === "exam_day" && !release.voidedAt
			? parsePlainDate(release.startsOn)
			: null;
	const firstTouched = await db.transaction(async (tx) => {
		await voidApprenticeRelease(tx, input);
		if (!release) return null;
		let touched = parsePlainDate(release.startsOn);
		if (examDay) {
			const undone = await undoExamSideEffects(tx, { ...input, examDay });
			if (undone && Temporal.PlainDate.compare(undone, touched) < 0) touched = undone;
		}
		await markEmployeeWorkBalanceDirty(
			{
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				dirtyFromDate: mondayOf(touched),
			},
			tx,
		);
		return touched;
	});
	if (firstTouched) {
		await refreshWorkBalanceAfterCommit({ ...input, dirtyFromDate: mondayOf(firstTouched) });
	}
}

/**
 * Inside the voiding transaction of an exam: voids its pre-exam day, restores what that pre-exam
 * day replaced, and moves the pre-exam day before the run's next exam day. Returns the earliest
 * day it changed.
 */
async function undoExamSideEffects(
	tx: Writer,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly actorUserId: string;
		readonly releaseId: string;
		readonly examDay: PlainDate;
	},
): Promise<PlainDate | null> {
	const scope = {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		actorUserId: input.actorUserId,
	};
	const linked = await tx
		.select()
		.from(employeeApprenticeRelease)
		.where(
			and(
				eq(employeeApprenticeRelease.organizationId, input.organizationId),
				eq(employeeApprenticeRelease.employeeId, input.employeeId),
				eq(employeeApprenticeRelease.examReleaseId, input.releaseId),
			),
		)
		.orderBy(asc(employeeApprenticeRelease.startsOn));
	let earliest: PlainDate | null = null;
	const touch = (day: string) => {
		const date = parsePlainDate(day);
		if (!earliest || Temporal.PlainDate.compare(date, earliest) < 0) earliest = date;
	};

	const preExamDays = linked.filter(
		(row) => row.releaseKind === "pre_exam_day" && row.voidedAt === null,
	);
	for (const row of preExamDays) {
		await voidApprenticeRelease(tx, { ...scope, releaseId: row.id, reason: EXAM_VOIDED_REASON });
		touch(row.startsOn);
	}
	// What a pre-exam day replaced is recorded again, with an audit note, on days still free.
	for (const row of linked) {
		if (row.voidedAt === null || row.voidReason !== PRE_EXAM_DAY_SUPERSEDES_REASON) continue;
		const occupied = await listApprenticeReleases(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			from: row.startsOn,
			until: parsePlainDate(row.endsOn).add({ days: 1 }).toString(),
		});
		if (occupied.length > 0) continue;
		const audit = `Release restored: the exam of ${input.examDay.toString()} it was replaced for was voided`;
		await recordApprenticeRelease(tx, {
			...scope,
			releaseKind: row.releaseKind,
			startsOn: row.startsOn,
			endsOn: row.endsOn,
			lessonCount: row.lessonCount,
			schoolMinutes: row.schoolMinutes,
			examStartTime: row.examStartTime,
			note: row.note ? `${row.note}\n${audit}` : audit,
		});
		touch(row.startsOn);
	}

	// A later exam day of the same multi-day exam keeps a pre-exam day.
	if (preExamDays.length > 0) {
		const [next] = (
			await listApprenticeReleases(tx, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				from: input.examDay.add({ days: 1 }).toString(),
				until: input.examDay.add({ days: PRE_EXAM_LOOKBACK_DAYS + 1 }).toString(),
			})
		).filter((record) => record.releaseKind === "exam_day");
		if (next) {
			const before = await workingDaysBefore(tx, {
				...scope,
				day: parsePlainDate(next.startsOn),
			});
			const run = await listApprenticeReleases(tx, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				from: before.lookback[before.lookback.length - 1].toString(),
				until: next.startsOn,
			});
			const examDays = new Set(
				run.filter((record) => record.releaseKind === "exam_day").map((record) => record.startsOn),
			);
			const preExamDay = before.lookback.find(
				(day) => !examDays.has(day.toString()) && before.isWorkingDay(day),
			);
			// In the same run when only exam days and days off lie between the voided day and it.
			if (preExamDay && Temporal.PlainDate.compare(preExamDay, input.examDay) <= 0) {
				const released = await releasePreExamDayFor(tx, { ...scope, ...before, exam: next });
				if (released) touch(released.toString());
			}
		}
	}
	return earliest;
}

const mondayOf = (day: PlainDate) => day.subtract({ days: day.dayOfWeek - 1 }).toString();

const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * An exam's start and participation time including breaks, from its local start and end on the
 * exam day in the organization's zone. Both or neither: without them the whole day is released.
 */
function examTimeOf(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly startsOn: string;
		readonly examStartTime?: string | null;
		readonly examEndTime?: string | null;
	},
): Promise<{ readonly startTime: string | null; readonly minutes: number | null }> {
	return wallTimeSpanOf(db, {
		organizationId: input.organizationId,
		startsOn: input.startsOn,
		startTime: input.examStartTime,
		endTime: input.examEndTime,
		refusal: "apprentice_release_exam_time_invalid",
		what: "exam",
		fields: ["examStartTime", "examEndTime"],
	});
}

/**
 * A school day's school time including breaks (§ 9 Abs. 2 Nr. 3 JArbSchG, § 15 Abs. 2 Nr. 1
 * BBiG), from its local start and end in the organization's zone. Both or neither: without them
 * the school day counts its lessons of 45 minutes.
 */
async function schoolTimeOf(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly startsOn: string;
		readonly schoolStartTime?: string | null;
		readonly schoolEndTime?: string | null;
	},
): Promise<number | null> {
	const span = await wallTimeSpanOf(db, {
		organizationId: input.organizationId,
		startsOn: input.startsOn,
		startTime: input.schoolStartTime,
		endTime: input.schoolEndTime,
		refusal: "apprentice_release_school_time_invalid",
		what: "school",
		fields: ["schoolStartTime", "schoolEndTime"],
	});
	return span.minutes;
}

/** The minutes between two local wall times on a day in the organization's zone, both or neither. */
async function wallTimeSpanOf(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly startsOn: string;
		readonly startTime?: string | null;
		readonly endTime?: string | null;
		readonly refusal: ApprenticeReleaseRefusal;
		readonly what: "exam" | "school";
		readonly fields: readonly [string, string];
	},
): Promise<{ readonly startTime: string | null; readonly minutes: number | null }> {
	const startTime = input.startTime || null;
	const endTime = input.endTime || null;
	if (!startTime && !endTime) return { startTime: null, minutes: null };
	if (!startTime || !endTime || !WALL_TIME.test(startTime) || !WALL_TIME.test(endTime)) {
		refuse(
			input.refusal,
			`Enter when the ${input.what} starts and ends, or neither`,
			input.fields[0],
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
		refuse(input.refusal, `The ${input.what} must end after it starts`, input.fields[1]);
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
