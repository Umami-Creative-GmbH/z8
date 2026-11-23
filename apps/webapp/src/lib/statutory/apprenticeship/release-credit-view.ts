/**
 * Apprentice release records with what each one credits (#1993), for Employee Detail and the
 * employee's own profile. Wage-free: release credits are minutes and days only, so org admins,
 * the employee's managers and the employee see the same view.
 */
import type { ApprenticeReleaseKind } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { listApprenticeReleases, recordApprenticeRelease } from "../employee-context";
import { isMinorOn } from "../youth/age";
import { loadEmployeeBirthdays, loadHolidayDateKeys } from "../youth/youth-facts";
import { apprenticeReleaseDays } from "./release-credits";
import { loadApprenticeReleaseRecords } from "./release-facts";

type Reader = Pick<DatabaseClient, "select">;

export interface ApprenticeReleaseCreditView {
	readonly id: string;
	readonly releaseKind: ApprenticeReleaseKind;
	readonly startsOn: string;
	readonly endsOn: string;
	readonly lessonCount: number | null;
	readonly schoolMinutes: number | null;
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
	| "apprentice_release_no_preceding_working_day";

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
 * `includePreExamDay`, an exam day also releases the working day immediately before it, unless
 * that day is already released.
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
		readonly note?: string | null;
		readonly includePreExamDay?: boolean;
	},
): Promise<void> {
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
	await db.transaction(async (tx) => {
		// A pre-exam day that is already released (e.g. a school day) is not recorded twice.
		const alreadyReleased =
			preExamDay &&
			(
				await loadApprenticeReleaseRecords(tx, {
					organizationId: input.organizationId,
					employeeIds: [input.employeeId],
					from: preExamDay.toString(),
					until: preExamDay.add({ days: 1 }).toString(),
				})
			).has(input.employeeId);
		if (preExamDay && !alreadyReleased) {
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
			schoolMinutes: input.schoolMinutes ?? null,
		});
	});
}
