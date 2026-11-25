/**
 * Read-only § 12 Abs. 4–5 TzBfG / § 4 EFZG reference-period calculator (#1992).
 *
 * Continued pay for an on-call employee's sick leave (Abs. 4) or a public holiday (Abs. 5) follows
 * the average working time of the reference period before it: the three months before the event
 * (or, where the organization pays by it, the 13 weeks before). If employment began later, the
 * shorter period counts. Kurzarbeit, unfaulted absence, lost work and leave are left out
 * (Abs. 4 Satz 3). The calculator therefore leaves out of both the numerator and the denominator:
 *
 * - days outside an active employment period (`not_employed`),
 * - days with approved unpaid absence (`unpaid_absence`: unpaid and parental leave, and a child's
 *   sickness, § 45 SGB V, on days nothing else released),
 * - days with other approved absence that releases work (`paid_absence`: vacation, own sickness…),
 * - assigned public holidays (`public_holiday`).
 *
 * Only lost work is left out: an absence or holiday day with completed work (a worked holiday, a
 * half-day of vacation) counts like any other day, as in the on-call monitor's weekly band.
 *
 * Listed events: each of the employee's own illnesses from its first day (child-sick days are not
 * one: Kinderkrankengeld replaces pay, no § 3 EFZG), and each public holiday on which work was lost.
 * A holiday during approved unpaid, parental or child-sick leave is not listed (no work is lost to it). A
 * holiday inside an illness is its own row with its own reference period (§ 4 Abs. 2 EFZG,
 * § 12 Abs. 5 TzBfG), and the illness's paid sick days leave it out. Both are paid only while
 * continued pay is owed (§ 3 EFZG): not in the first four weeks of employment, and for at most six
 * weeks of the illness.
 *
 * The numerator is the completed work of the remaining days, allocated to employee-local days by
 * the payroll allocation rule. It only reads: it never writes work balances, settled payroll days
 * or closed months, so payroll can quote it without changing what was paid.
 */
import { and, eq, gt, gte, inArray, isNotNull, isNull, lt, min, ne, or } from "drizzle-orm";
import { absenceCategory, absenceEntry, workPeriod } from "@/db/schema";
import { mapConcurrently } from "@/lib/async/map-concurrently";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import { loadEmployeeTime } from "@/lib/engagement/engagement-stints";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import {
	compareInstants,
	comparePlainDates,
	dateFromInstant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { employeePayrollWindow } from "@/lib/payroll-allocation/protected-minutes";
import { completedWorkPeriodCondition } from "@/lib/reports/completed-work";
import { allocateTrackedDailyWorkMinutes } from "@/lib/work-balance/tracked-work";
import { loadEmployeeInOrganization } from "../employee-scope";
import { employeeWorkRows } from "../employee-time";
import { daysOf } from "./facts";
import { loadOnCallReleasedDays, type OnCallReleaseReason } from "./released-days";

/** Reference-period batches loaded at once for distinct first events. */
const REFERENCE_GROUP_CONCURRENCY = 2;

/** Select and relational reads only: the calculator never writes. */
export type OnCallReferenceReader = Pick<DatabaseClient, "select" | "query">;

export const onCallReferenceMethods = ["three_months", "thirteen_weeks"] as const;
export type OnCallReferenceMethod = (typeof onCallReferenceMethods)[number];

export type OnCallReferenceExclusionReason =
	| "not_employed"
	| "unpaid_absence"
	| "paid_absence"
	| "public_holiday";

/** A run of consecutive excluded days, `untilExclusive` exclusive. */
export interface OnCallReferenceExclusion {
	readonly from: string;
	readonly untilExclusive: string;
	readonly reason: OnCallReferenceExclusionReason;
	readonly days: number;
}

export interface OnCallReferenceBreakdown {
	readonly employeeId: string;
	/** First day of sick leave, or the public holiday. */
	readonly eventDate: string;
	readonly method: OnCallReferenceMethod;
	readonly referenceStart: string;
	/** The event day: the reference period ends the day before. */
	readonly referenceEndExclusive: string;
	/** Employee calendar timezone the days were read in. */
	readonly timezone: string;
	readonly calendarDays: number;
	/** Calendar days left after the exclusions: the average's denominator. */
	readonly denominatorDays: number;
	/** Denominator days with completed work. */
	readonly workedDays: number;
	/** Completed work minutes of the denominator days. */
	readonly numeratorMinutes: number;
	readonly averageMinutesPerDay: number | null;
	readonly averageMinutesPerWeek: number | null;
	readonly averageMinutesPerWorkedDay: number | null;
	readonly excludedPeriods: readonly OnCallReferenceExclusion[];
	/** True when employment began inside the reference period (Abs. 4 Satz 2). */
	readonly employmentShortened: boolean;
	/** Whether the employee is on call on the event day; otherwise § 12 Abs. 4–5 does not apply. */
	readonly onCallOnEventDate: boolean;
}

export type OnCallReferenceEventKind = "sick_leave" | "public_holiday";

/** A span of days, `untilExclusive` exclusive. */
export interface OnCallDaySpan {
	readonly from: string;
	readonly untilExclusive: string;
}

/**
 * An illness's days within the listed range (`from` … `untilExclusive`) and the ones its sick-leave
 * row pays (§ 12 Abs. 4 TzBfG): employed and on-call days while continued pay is owed (§ 3 EFZG,
 * see {@link continuedPayOf}), without the public holidays inside it. § 4 Abs. 2 EFZG pays those by
 * the holiday rule, each as its own `public_holiday` row, so no day is paid twice.
 */
export interface OnCallPaidSickDays {
	readonly from: string;
	readonly untilExclusive: string;
	/** Paid sick days in the range: 0 when no continued pay is owed in it. */
	readonly days: number;
	readonly holidaysPaidAsHolidays: readonly string[];
	/** The illness's whole span of continued pay, or null when none is owed for it at all. */
	readonly continuedPay: OnCallDaySpan | null;
}

export interface OnCallReferenceEvent {
	readonly kind: OnCallReferenceEventKind;
	readonly eventDate: string;
	readonly breakdown: OnCallReferenceBreakdown;
	/** Sick leave only. */
	readonly paidSickDays?: OnCallPaidSickDays;
}

export function referenceStartOf(eventDate: PlainDate, method: OnCallReferenceMethod): PlainDate {
	return method === "three_months"
		? eventDate.subtract({ months: 3 })
		: eventDate.subtract({ weeks: 13 });
}

interface ReferenceFacts {
	readonly contracts: ReadonlyMap<string, EffectiveContractOnDay>;
	readonly exclusionByDay: ReadonlyMap<string, OnCallReleaseReason>;
	readonly workMinutesByDay: Readonly<Record<string, number>>;
	readonly timezone: string;
	/** Approved sick leave touching the loaded days, `endDate` inclusive. */
	readonly sickLeaves: readonly { readonly startDate: string; readonly endDate: string }[];
	readonly holidays: ReadonlySet<string>;
}

/** § 12 Abs. 4–5 TzBfG apply only on days the employee is employed and on call. */
function onCallOn(facts: ReferenceFacts, day: string): boolean {
	const contract = facts.contracts.get(day);
	return Boolean(contract?.isEmployedOnDay && contract.onCallTerms);
}

interface SickLeave {
	readonly startDate: string;
	/** Inclusive. */
	readonly endDate: string;
}

/**
 * Sick leave joined into illnesses: leave that overlaps or adjoins earlier leave (no day between)
 * continues the same illness, so § 12 Abs. 4 TzBfG dates it, and its reference period, from the
 * first leave's start. In start order.
 */
export function continuedSickLeaves(leaves: readonly SickLeave[]): SickLeave[] {
	const merged: SickLeave[] = [];
	for (const leave of leaves.toSorted((a, b) => a.startDate.localeCompare(b.startDate))) {
		const previous = merged.at(-1);
		if (previous && leave.startDate <= dayAfter(previous.endDate)) {
			if (leave.endDate > previous.endDate) {
				merged[merged.length - 1] = { startDate: previous.startDate, endDate: leave.endDate };
			}
			continue;
		}
		merged.push(leave);
	}
	return merged;
}

function dayAfter(date: string): string {
	return parsePlainDate(date).add({ days: 1 }).toString();
}

/** § 3 Abs. 3 EFZG: the claim arises after four weeks of uninterrupted employment. */
const EFZG_WAITING_DAYS = 28;
/** § 3 Abs. 1 EFZG: continued pay for up to six weeks of the illness. */
const EFZG_CONTINUED_PAY_DAYS = 42;

/**
 * The days of an illness on which continued pay is owed (§ 3 EFZG), or null when none is. The six
 * weeks run from the illness's first day, or, when it began within the first four weeks of
 * uninterrupted employment, from the day the claim arises (§ 3 Abs. 3 EFZG), and end with the
 * illness. Back-to-back leave is one illness ({@link continuedSickLeaves}).
 *
 * Not covered: a new illness from the same cause as an earlier one (Fortsetzungserkrankung,
 * § 3 Abs. 1 Satz 2 EFZG) is not counted against the earlier one's six weeks; each illness gets
 * its own. Payroll has to apply that 6/12-month rule itself.
 */
function continuedPayOf(facts: ReferenceFacts, leave: SickLeave): OnCallDaySpan | null {
	const employed = (day: PlainDate) =>
		facts.contracts.get(day.toString())?.isEmployedOnDay ?? false;
	const illnessEnd = parsePlainDate(leave.endDate);
	// The first employed day of the illness among the loaded days (they cover its start).
	let first = parsePlainDate(leave.startDate);
	while (!employed(first)) {
		first = first.add({ days: 1 });
		if (comparePlainDates(first, illnessEnd) > 0 || !facts.contracts.has(first.toString())) {
			return null;
		}
	}
	// The start of the uninterrupted employment it belongs to. The loaded days reach at least
	// three months back, so a run reaching their start is well past the waiting time. Days after
	// the loaded ones are not needed: once the claim arises, the six weeks run on even if the
	// employment ends (§ 8 EFZG), and days not employed are not counted as paid sick days.
	let employedSince = first;
	while (employed(employedSince.subtract({ days: 1 }))) {
		employedSince = employedSince.subtract({ days: 1 });
	}
	const claimArises = employedSince.add({ days: EFZG_WAITING_DAYS });
	const from = comparePlainDates(claimArises, first) > 0 ? claimArises : first;
	if (comparePlainDates(from, illnessEnd) > 0) return null;
	const sixWeeksEnd = from.add({ days: EFZG_CONTINUED_PAY_DAYS }).toString();
	const until = dayAfter(leave.endDate);
	return { from: from.toString(), untilExclusive: sixWeeksEnd < until ? sixWeeksEnd : until };
}

function within(span: OnCallDaySpan | null, day: string): boolean {
	return span !== null && day >= span.from && day < span.untilExclusive;
}

/**
 * Per employee, the start of the earliest illness (approved sick leave joined by
 * {@link continuedSickLeaves}) that is still running on `from` or starts before `untilExclusive`.
 * One grouped query for every employee, then one per step back through leave adjoining it.
 */
export async function earliestSickStarts(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		/** Null: every employee of the organization. */
		readonly employeeIds: readonly string[] | null;
		readonly from: string;
		readonly untilExclusive: string;
	},
): Promise<Map<string, string>> {
	const earliest = async (
		employeeIds: readonly string[] | null,
		untilExclusive: string,
		from: string,
	) =>
		new Map(
			(
				await db
					.select({ employeeId: absenceEntry.employeeId, startDate: min(absenceEntry.startDate) })
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
							employeeIds ? inArray(absenceEntry.employeeId, [...employeeIds]) : undefined,
							eq(absenceEntry.status, "approved"),
							eq(absenceCategory.type, "sick"),
							eq(absenceCategory.requiresWorkTime, false),
							// A child's sickness (§ 45 SGB V) is not the employee's own illness.
							or(isNull(absenceEntry.sickDetail), ne(absenceEntry.sickDetail, "child_sick")),
							lt(absenceEntry.startDate, untilExclusive),
							gte(absenceEntry.endDate, from),
						),
					)
					.groupBy(absenceEntry.employeeId)
			).flatMap((row) => (row.startDate ? [[row.employeeId, row.startDate] as const] : [])),
		);
	if (input.employeeIds?.length === 0) return new Map();
	const result = await earliest(input.employeeIds, input.untilExclusive, input.from);
	// Step back while earlier leave ends on or after the day before the illness found so far.
	let open = [...result.keys()];
	while (open.length > 0) {
		const stepped: string[] = [];
		for (const [start, employeeIds] of Map.groupBy(open, (id) => result.get(id) ?? "")) {
			const dayBefore = parsePlainDate(start).subtract({ days: 1 }).toString();
			for (const [employeeId, earlier] of await earliest(employeeIds, start, dayBefore)) {
				result.set(employeeId, earlier);
				stepped.push(employeeId);
			}
		}
		open = stepped;
	}
	return result;
}

/**
 * Loads the facts of `[from, untilExclusive)` for employees of the organization the caller has
 * already scoped. Batched: one contract resolution, one absence and holiday read and one work
 * read for all of them. Reads only.
 */
async function loadReferenceFactsBatch(
	db: OnCallReferenceReader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: PlainDate;
		readonly untilExclusive: PlainDate;
	},
): Promise<Map<string, ReferenceFacts>> {
	const result = new Map<string, ReferenceFacts>();
	if (input.employeeIds.length === 0) return result;
	const from = input.from.toString();
	const last = input.untilExclusive.subtract({ days: 1 }).toString();
	const days = daysOf(input.from, input.untilExclusive);

	// Independent reads on a pool-backed client. Employee time only (#2010): work of an External
	// Contractor stint pays no on-call reference.
	const [contractsByEmployee, released, employeeTime] = await Promise.all([
		loadEffectiveContractsBatch(db, {
			organizationId: input.organizationId,
			employeeIds: input.employeeIds,
			dates: days,
		}),
		loadOnCallReleasedDays(db, {
			organizationId: input.organizationId,
			employeeIds: input.employeeIds,
			from: input.from,
			untilExclusive: input.untilExclusive,
		}),
		loadEmployeeTime(db, input.organizationId, input.employeeIds),
	]);
	const timezoneOf = (employeeId: string) =>
		contractsByEmployee.get(employeeId)?.get(last)?.calendarTimezone ?? "UTC";

	// One read spanning every employee's local window; the allocator clips to each one.
	const windows = [...new Set(input.employeeIds.map(timezoneOf))].map((timezone) =>
		employeePayrollWindow(from, last, timezone),
	);
	const windowStart = windows
		.map((w) => w.start)
		.reduce((a, b) => (compareInstants(a, b) <= 0 ? a : b));
	const windowEnd = windows
		.map((w) => w.endExclusive)
		.reduce((a, b) => (compareInstants(a, b) >= 0 ? a : b));
	const storedPeriods = await db
		.select({
			employeeId: workPeriod.employeeId,
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, [...input.employeeIds]),
				completedWorkPeriodCondition(),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				lt(workPeriod.startTime, dateFromInstant(windowEnd)),
				gt(workPeriod.endTime, dateFromInstant(windowStart)),
			),
		);
	const periods = employeeWorkRows(employeeTime, storedPeriods);
	const periodsByEmployee = Map.groupBy(periods, (row) => row.employeeId);

	for (const employeeId of input.employeeIds) {
		const timezone = timezoneOf(employeeId);
		const { minutesByDate } = allocateTrackedDailyWorkMinutes(
			periodsByEmployee.get(employeeId) ?? [],
			{ startDate: from, throughDate: last, timezone },
		);
		const days = released.get(employeeId);
		result.set(employeeId, {
			contracts: contractsByEmployee.get(employeeId) ?? new Map<string, EffectiveContractOnDay>(),
			exclusionByDay: days?.reasonByDay ?? new Map(),
			workMinutesByDay: minutesByDate,
			timezone,
			sickLeaves: days?.sickLeaves ?? [],
			holidays: days?.holidays ?? new Set(),
		});
	}
	return result;
}

/** Loads the facts of `[from, untilExclusive)` for one employee of the organization; reads only. */
async function loadReferenceFacts(
	db: OnCallReferenceReader,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly from: PlainDate;
		readonly untilExclusive: PlainDate;
	},
): Promise<ReferenceFacts> {
	await loadEmployeeInOrganization(db, input);
	const facts = await loadReferenceFactsBatch(db, { ...input, employeeIds: [input.employeeId] });
	const own = facts.get(input.employeeId);
	if (!own) throw new Error("reference facts missing for a loaded employee");
	return own;
}

function computeBreakdown(
	facts: ReferenceFacts,
	input: {
		readonly employeeId: string;
		readonly eventDate: PlainDate;
		readonly method: OnCallReferenceMethod;
	},
): OnCallReferenceBreakdown {
	const start = referenceStartOf(input.eventDate, input.method);
	const days = daysOf(start, input.eventDate);
	const excludedPeriods: OnCallReferenceExclusion[] = [];
	let denominatorDays = 0;
	let workedDays = 0;
	let numeratorMinutes = 0;
	let firstEmployedSeen = false;
	let employmentShortened = false;

	for (const day of days) {
		const key = day.toString();
		const employed = facts.contracts.get(key)?.isEmployedOnDay ?? false;
		if (employed) firstEmployedSeen = true;
		else if (!firstEmployedSeen) employmentShortened = true;
		const minutes = facts.workMinutesByDay[key] ?? 0;
		// Only lost work is left out: a holiday or absence day that was worked anyway counts.
		const reason: OnCallReferenceExclusionReason | null = !employed
			? "not_employed"
			: minutes > 0
				? null
				: (facts.exclusionByDay.get(key) ?? null);
		if (reason) {
			const previous = excludedPeriods.at(-1);
			if (previous && previous.reason === reason && previous.untilExclusive === key) {
				excludedPeriods[excludedPeriods.length - 1] = {
					...previous,
					untilExclusive: day.add({ days: 1 }).toString(),
					days: previous.days + 1,
				};
			} else {
				excludedPeriods.push({
					from: key,
					untilExclusive: day.add({ days: 1 }).toString(),
					reason,
					days: 1,
				});
			}
			continue;
		}
		denominatorDays += 1;
		numeratorMinutes += minutes;
		if (minutes > 0) workedDays += 1;
	}

	const average = (minutes: number, divisor: number) =>
		divisor > 0 ? Math.round(minutes / divisor) : null;
	return {
		employeeId: input.employeeId,
		eventDate: input.eventDate.toString(),
		method: input.method,
		referenceStart: start.toString(),
		referenceEndExclusive: input.eventDate.toString(),
		timezone: facts.timezone,
		calendarDays: days.length,
		denominatorDays,
		workedDays,
		numeratorMinutes,
		averageMinutesPerDay: average(numeratorMinutes, denominatorDays),
		averageMinutesPerWeek: average(numeratorMinutes * 7, denominatorDays),
		averageMinutesPerWorkedDay: average(numeratorMinutes, workedDays),
		excludedPeriods,
		employmentShortened: employmentShortened && firstEmployedSeen,
		onCallOnEventDate: onCallOn(facts, input.eventDate.toString()),
	};
}

/** The reference-period breakdown for one sick-leave start or public holiday. */
export async function calculateOnCallReferencePeriod(
	db: OnCallReferenceReader,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly eventDate: string;
		readonly method: OnCallReferenceMethod;
	},
): Promise<OnCallReferenceBreakdown> {
	const eventDate = parsePlainDate(input.eventDate);
	const facts = await loadReferenceFacts(db, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		from: referenceStartOf(eventDate, input.method),
		untilExclusive: eventDate.add({ days: 1 }),
	});
	return computeBreakdown(facts, { employeeId: input.employeeId, eventDate, method: input.method });
}

function eventsOf(
	facts: ReferenceFacts,
	input: {
		readonly employeeId: string;
		readonly from: string;
		readonly untilExclusive: string;
		readonly method: OnCallReferenceMethod;
	},
): OnCallReferenceEvent[] {
	const inRange = (day: string) => day >= input.from && day < input.untilExclusive;
	const illnesses = continuedSickLeaves(facts.sickLeaves).map((leave) => ({
		...leave,
		continuedPay: continuedPayOf(facts, leave),
	}));
	// A holiday inside an illness on which no continued pay is owed (the first four weeks of
	// employment, or after the six weeks) is not paid by the holiday rule either.
	const unpaidIllnessDay = (day: string) =>
		illnesses.some(
			(illness) =>
				day >= illness.startDate && day <= illness.endDate && !within(illness.continuedPay, day),
		);
	// A holiday is paid only where work was lost (as the band and the denominator see it). During
	// approved unpaid or parental leave no work is lost to it, so there is no holiday pay. A holiday
	// inside an illness is its own row: § 4 Abs. 2 EFZG pays it by the holiday rule, and § 12 Abs. 5
	// TzBfG dates its reference period from the holiday itself.
	const paidHolidays = [...facts.holidays]
		.filter(
			(day) =>
				inRange(day) &&
				onCallOn(facts, day) &&
				(facts.workMinutesByDay[day] ?? 0) === 0 &&
				facts.exclusionByDay.get(day) !== "unpaid_absence" &&
				!unpaidIllnessDay(day),
		)
		.toSorted();
	const paidHolidaySet = new Set(paidHolidays);
	// Illnesses listed: running in the range and on call on their first day.
	const sickRows = illnesses
		.filter(
			(illness) =>
				illness.startDate < input.untilExclusive &&
				illness.endDate >= input.from &&
				onCallOn(facts, illness.startDate),
		)
		.map((illness) => ({
			kind: "sick_leave" as const,
			eventDate: illness.startDate,
			paidSickDays: paidSickDaysOf(facts, illness, input, paidHolidaySet),
		}));
	const holidayRows = paidHolidays.map((eventDate) => ({
		kind: "public_holiday" as const,
		eventDate,
	}));
	return [...sickRows, ...holidayRows]
		.toSorted((a, b) => a.eventDate.localeCompare(b.eventDate) || a.kind.localeCompare(b.kind))
		.map((event) => ({
			...event,
			breakdown: computeBreakdown(facts, {
				employeeId: input.employeeId,
				eventDate: parsePlainDate(event.eventDate),
				method: input.method,
			}),
		}));
}

/** The illness's days in the listed range that its sick-leave row pays; see {@link OnCallPaidSickDays}. */
function paidSickDaysOf(
	facts: ReferenceFacts,
	illness: SickLeave & { readonly continuedPay: OnCallDaySpan | null },
	range: { readonly from: string; readonly untilExclusive: string },
	paidHolidays: ReadonlySet<string>,
): OnCallPaidSickDays {
	const from = illness.startDate > range.from ? illness.startDate : range.from;
	const illnessEnd = dayAfter(illness.endDate);
	const untilExclusive = illnessEnd < range.untilExclusive ? illnessEnd : range.untilExclusive;
	const holidaysPaidAsHolidays: string[] = [];
	let days = 0;
	for (const day of daysOf(parsePlainDate(from), parsePlainDate(untilExclusive))) {
		const key = day.toString();
		// Holidays inside the illness are paid only while continued pay is owed: `paidHolidays`
		// already leaves out the others.
		if (paidHolidays.has(key)) holidaysPaidAsHolidays.push(key);
		else if (within(illness.continuedPay, key) && onCallOn(facts, key)) days += 1;
	}
	return {
		from,
		untilExclusive,
		days,
		holidaysPaidAsHolidays,
		continuedPay: illness.continuedPay,
	};
}

/**
 * The approved sick leave and public holidays in `[from, untilExclusive)` of employees the caller
 * has scoped to the organization, on days they are on call, each with its reference-period
 * breakdown. Sick leave that began before `from` and runs into the range is listed too, dated
 * (and its reference period counted) from its own first day, so a payroll period covers it.
 * One batched load per distinct first event: every employee is loaded from their own one.
 */
export async function listOnCallReferenceEventsBatch(
	db: OnCallReferenceReader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly untilExclusive: string;
		readonly method: OnCallReferenceMethod;
	},
): Promise<Map<string, OnCallReferenceEvent[]>> {
	const result = new Map<string, OnCallReferenceEvent[]>();
	const from = parsePlainDate(input.from);
	const until = parsePlainDate(input.untilExclusive);
	if (input.employeeIds.length === 0 || comparePlainDates(from, until) >= 0) return result;
	const sickSince = await earliestSickStarts(db, input);
	// Each employee's own first event sets their loaded range, so one long-running sick leave
	// does not widen everyone's load. Employees sharing a first event share one batched load.
	const byFirstEvent = Map.groupBy(input.employeeIds, (employeeId) => {
		const start = sickSince.get(employeeId);
		return start && start < input.from ? start : input.from;
	});
	// A few groups at a time: each batch itself runs its reads concurrently on the pool. Results
	// are kept in group order.
	const factsByGroup = await mapConcurrently(
		[...byFirstEvent],
		REFERENCE_GROUP_CONCURRENCY,
		([firstEvent, employeeIds]) =>
			loadReferenceFactsBatch(db, {
				organizationId: input.organizationId,
				employeeIds,
				from: referenceStartOf(parsePlainDate(firstEvent), input.method),
				untilExclusive: until,
			}),
	);
	for (const facts of factsByGroup) {
		for (const [employeeId, own] of facts) {
			result.set(employeeId, eventsOf(own, { ...input, employeeId }));
		}
	}
	return result;
}

/** {@link listOnCallReferenceEventsBatch} for one employee, checked to belong to the organization. */
export async function listOnCallReferenceEvents(
	db: OnCallReferenceReader,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly from: string;
		readonly untilExclusive: string;
		readonly method: OnCallReferenceMethod;
	},
): Promise<OnCallReferenceEvent[]> {
	await loadEmployeeInOrganization(db, input);
	const events = await listOnCallReferenceEventsBatch(db, {
		...input,
		employeeIds: [input.employeeId],
	});
	return events.get(input.employeeId) ?? [];
}
