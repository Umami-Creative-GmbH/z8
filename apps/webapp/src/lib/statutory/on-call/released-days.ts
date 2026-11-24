/**
 * Days an on-call employee is released from work (#1992): approved absence that does not require
 * work (a child's sickness too, as unpaid release), and assigned public holidays. Read once for many employees, in two queries plus the
 * holiday reader. Shared by the weekly call-off band (a released day cannot be called) and the
 * § 12 Abs. 4–5 TzBfG reference period (released days leave its average). Read-only.
 */
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import { absenceCategory, absenceEntry } from "@/db/schema";
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadHolidayDateKeys } from "../holiday-days";

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
	 * The employee's own approved sick leave touching the range, `endDate` inclusive (not clipped),
	 * and the follow-up leave after the range that continues an illness running on its last day
	 * (up to {@link FOLLOW_UP_LOOKAHEAD_DAYS} days on), so the illness's real end is known.
	 * Child-sick days are not their illness and are not listed.
	 */
	readonly sickLeaves: readonly { readonly startDate: string; readonly endDate: string }[];
	/** Assigned public holidays in the range. */
	readonly holidays: ReadonlySet<string>;
}

const NONE: OnCallReleasedDays = { reasonByDay: new Map(), sickLeaves: [], holidays: new Set() };

/**
 * How far past the range follow-up sick leave is read. The § 3 Abs. 3 EFZG claim arises at most
 * four weeks after an illness's first day, so an illness continued this far reaches it: whether it
 * goes on longer does not change whether continued pay is owed, nor any day of the range.
 */
export const FOLLOW_UP_LOOKAHEAD_DAYS = 28;

/** The employee's own illness, not a child's sickness (§ 45 SGB V). */
function isOwnSickLeave(absence: {
	readonly type: string;
	readonly sickDetail: string | null;
	readonly requiresWorkTime: boolean;
}): boolean {
	return (
		absence.type === "sick" && !absence.requiresWorkTime && absence.sickDetail !== "child_sick"
	);
}

/**
 * The follow-up leave (`after` the range, in start order) that continues an illness reaching
 * `last`: each starts on or before the day after the illness's end so far.
 */
function followUpsOf(
	inRange: readonly { readonly endDate: string }[],
	after: readonly { readonly startDate: string; readonly endDate: string }[],
	last: string,
): { startDate: string; endDate: string }[] {
	let reach = inRange.reduce<string | null>(
		(latest, leave) => (latest === null || leave.endDate > latest ? leave.endDate : latest),
		null,
	);
	if (reach === null || reach < last) return [];
	const followUps: { startDate: string; endDate: string }[] = [];
	for (const leave of after.toSorted((a, b) => a.startDate.localeCompare(b.startDate))) {
		if (leave.startDate > parsePlainDate(reach).add({ days: 1 }).toString()) break;
		followUps.push({ startDate: leave.startDate, endDate: leave.endDate });
		if (leave.endDate > reach) reach = leave.endDate;
	}
	return followUps;
}

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
	const lookaheadLast = input.untilExclusive.add({ days: FOLLOW_UP_LOOKAHEAD_DAYS - 1 }).toString();

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
				// Sick leave also some way past the range: a follow-up may continue an illness.
				or(
					lte(absenceEntry.startDate, last),
					and(eq(absenceCategory.type, "sick"), lte(absenceEntry.startDate, lookaheadLast)),
				),
				gte(absenceEntry.endDate, from),
			),
		);
	const holidaysByEmployee = await loadHolidayDateKeys(db, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		from,
		until,
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
		const own = absencesByEmployee.get(employeeId) ?? [];
		for (const absence of own) {
			// Leave after the range is read only for follow-ups, below.
			if (absence.startDate > last) continue;
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
		sickLeaves.push(
			...followUpsOf(
				sickLeaves,
				own.filter((absence) => absence.startDate > last && isOwnSickLeave(absence)),
				last,
			),
		);
		// Only where nothing else released the day: the employee's own illness or leave on the same
		// day keeps its own reason (and pay).
		for (const day of childSickDays) {
			if (!reasonByDay.has(day)) reasonByDay.set(day, "unpaid_absence");
		}
		const holidays = new Set(
			[...(holidaysByEmployee.get(employeeId) ?? [])].filter((day) => day >= from && day < until),
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
