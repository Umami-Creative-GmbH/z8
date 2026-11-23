/**
 * Days an on-call employee is released from work (#1992): approved absence that does not require
 * work (a child's sickness too, as unpaid release), and assigned public holidays. Read once for many employees, in two queries plus the
 * holiday reader. Shared by the weekly call-off band (a released day cannot be called) and the
 * § 12 Abs. 4–5 TzBfG reference period (released days leave its average). Read-only.
 */
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { absenceCategory, absenceEntry } from "@/db/schema";
import {
	getAssignedHolidayDateKeys,
	getAssignedHolidaysForEmployees,
} from "@/lib/calendar/assigned-holidays";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

export type OnCallReleasedDayReader = Pick<DatabaseClient, "select" | "query">;

export type OnCallReleaseReason = "unpaid_absence" | "paid_absence" | "public_holiday";

/** The stronger reason wins when absences and holidays fall on one day. */
export const ON_CALL_RELEASE_RANK: Record<OnCallReleaseReason, number> = {
	unpaid_absence: 3,
	paid_absence: 2,
	public_holiday: 1,
};

const UNPAID_ABSENCE_TYPES = new Set(["unpaid", "parental"]);

export interface OnCallReleasedDays {
	/** Release reason per released day (`YYYY-MM-DD`) of the range. */
	readonly reasonByDay: ReadonlyMap<string, OnCallReleaseReason>;
	/**
	 * The employee's own approved sick leave touching the range, `endDate` inclusive (not clipped).
	 * Child-sick days are not their illness and are not listed.
	 */
	readonly sickLeaves: readonly { readonly startDate: string; readonly endDate: string }[];
	/** Assigned public holidays in the range. */
	readonly holidays: ReadonlySet<string>;
}

const NONE: OnCallReleasedDays = { reasonByDay: new Map(), sickLeaves: [], holidays: new Set() };

/**
 * Released days of `employeeIds` in `[from, untilExclusive)`. A half-day absence releases the whole
 * day: it is no full working day. Categories that require work (home office) release nothing.
 */
export async function loadOnCallReleasedDays(
	db: OnCallReleasedDayReader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: PlainDate;
		readonly untilExclusive: PlainDate;
	},
): Promise<ReadonlyMap<string, OnCallReleasedDays>> {
	const result = new Map<string, OnCallReleasedDays>();
	if (input.employeeIds.length === 0) return result;
	const from = input.from.toString();
	const until = input.untilExclusive.toString();
	const last = input.untilExclusive.subtract({ days: 1 }).toString();
	if (from > last) return result;

	const absences = await db
		.select({
			employeeId: absenceEntry.employeeId,
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
			sickDetail: absenceEntry.sickDetail,
			type: absenceCategory.type,
			requiresWorkTime: absenceCategory.requiresWorkTime,
		})
		.from(absenceEntry)
		.innerJoin(
			absenceCategory,
			and(
				eq(absenceCategory.id, absenceEntry.categoryId),
				eq(absenceCategory.organizationId, input.organizationId),
			),
		)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				inArray(absenceEntry.employeeId, [...input.employeeIds]),
				eq(absenceEntry.status, "approved"),
				lte(absenceEntry.startDate, last),
				gte(absenceEntry.endDate, from),
			),
		);
	const holidaysByEmployee = await getAssignedHolidaysForEmployees({
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		startDate: new Date(`${from}T00:00:00.000Z`),
		endDate: new Date(`${last}T23:59:59.999Z`),
		// The holiday reader only reads; it takes the full client type.
		database: db as DatabaseClient,
	});

	const absencesByEmployee = Map.groupBy(absences, (row) => row.employeeId);
	for (const employeeId of input.employeeIds) {
		const reasonByDay = new Map<string, OnCallReleaseReason>();
		const release = (day: string, reason: OnCallReleaseReason) => {
			const current = reasonByDay.get(day);
			if (!current || ON_CALL_RELEASE_RANK[reason] > ON_CALL_RELEASE_RANK[current]) {
				reasonByDay.set(day, reason);
			}
		};
		const daysOfAbsence = (absence: { startDate: string; endDate: string }) => {
			const days: string[] = [];
			for (
				let day = parsePlainDate(absence.startDate > from ? absence.startDate : from);
				day.toString() <= absence.endDate && day.toString() <= last;
				day = day.add({ days: 1 })
			) {
				days.push(day.toString());
			}
			return days;
		};
		const sickLeaves: { startDate: string; endDate: string }[] = [];
		const childSickDays: string[] = [];
		for (const absence of absencesByEmployee.get(employeeId) ?? []) {
			// Home office and other categories that require work are work, not absence.
			if (absence.requiresWorkTime) continue;
			// A child's sickness (§ 45 SGB V) releases the employee without pay: Kinderkrankengeld
			// replaces it. It is not their own illness, so no § 3 EFZG continued pay and no
			// § 12 Abs. 4 TzBfG event.
			if (absence.type === "sick" && absence.sickDetail === "child_sick") {
				childSickDays.push(...daysOfAbsence(absence));
				continue;
			}
			const reason = UNPAID_ABSENCE_TYPES.has(absence.type) ? "unpaid_absence" : "paid_absence";
			if (absence.type === "sick") {
				sickLeaves.push({ startDate: absence.startDate, endDate: absence.endDate });
			}
			for (const day of daysOfAbsence(absence)) release(day, reason);
		}
		// Only where nothing else released the day: the employee's own illness or leave on the same
		// day keeps its own reason (and pay).
		for (const day of childSickDays) {
			if (!reasonByDay.has(day)) reasonByDay.set(day, "unpaid_absence");
		}
		const holidays = new Set(
			[...getAssignedHolidayDateKeys(holidaysByEmployee.get(employeeId) ?? [])].filter(
				(day) => day >= from && day < until,
			),
		);
		for (const day of holidays) release(day, "public_holiday");
		result.set(
			employeeId,
			reasonByDay.size === 0 && sickLeaves.length === 0
				? NONE
				: { reasonByDay, sickLeaves, holidays },
		);
	}
	return result;
}
