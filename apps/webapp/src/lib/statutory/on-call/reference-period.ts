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
 * - days with approved unpaid absence (`unpaid_absence`: unpaid and parental leave),
 * - days with other approved absence that releases work (`paid_absence`: vacation, sickness…),
 * - assigned public holidays (`public_holiday`).
 *
 * The numerator is the completed work of the remaining days, allocated to employee-local days by
 * the payroll allocation rule. It only reads: it never writes work balances, settled payroll days
 * or closed months, so payroll can quote it without changing what was paid.
 */
import { and, eq, gt, gte, inArray, isNotNull, lt, min } from "drizzle-orm";
import { absenceCategory, absenceEntry, workPeriod } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
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
import { daysOf } from "./facts";
import { loadOnCallReleasedDays, type OnCallReleaseReason } from "./released-days";

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

export interface OnCallReferenceEvent {
	readonly kind: OnCallReferenceEventKind;
	readonly eventDate: string;
	readonly breakdown: OnCallReferenceBreakdown;
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

/**
 * Per employee, the first day of approved sick leave that is still running on `from` or starts
 * before `untilExclusive`. One grouped query for every employee.
 */
async function earliestSickStarts(
	db: OnCallReferenceReader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: string;
		readonly untilExclusive: string;
	},
): Promise<Map<string, string>> {
	if (input.employeeIds.length === 0) return new Map();
	const rows = await db
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
				inArray(absenceEntry.employeeId, [...input.employeeIds]),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.type, "sick"),
				eq(absenceCategory.requiresWorkTime, false),
				lt(absenceEntry.startDate, input.untilExclusive),
				gte(absenceEntry.endDate, input.from),
			),
		)
		.groupBy(absenceEntry.employeeId);
	return new Map(
		rows.flatMap((row) => (row.startDate ? [[row.employeeId, row.startDate] as const] : [])),
	);
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

	const contractsByEmployee = await loadEffectiveContractsBatch(db, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		dates: days,
	});
	const timezoneOf = (employeeId: string) =>
		contractsByEmployee.get(employeeId)?.get(last)?.calendarTimezone ?? "UTC";

	const released = await loadOnCallReleasedDays(db, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		from: input.from,
		untilExclusive: input.untilExclusive,
	});

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
	const periods = await db
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
		const reason: OnCallReferenceExclusionReason | null = employed
			? (facts.exclusionByDay.get(key) ?? null)
			: "not_employed";
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
		const minutes = facts.workMinutesByDay[key] ?? 0;
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
	const sickStarts = new Set(
		facts.sickLeaves
			.filter((leave) => leave.startDate < input.untilExclusive && leave.endDate >= input.from)
			.map((leave) => leave.startDate),
	);
	const candidates: { kind: OnCallReferenceEventKind; eventDate: string }[] = [
		...[...sickStarts].map((eventDate) => ({ kind: "sick_leave" as const, eventDate })),
		...[...facts.holidays]
			.filter(inRange)
			.map((eventDate) => ({ kind: "public_holiday" as const, eventDate })),
	];
	return candidates
		.filter((event) => onCallOn(facts, event.eventDate))
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

/**
 * The approved sick leave and public holidays in `[from, untilExclusive)` of employees the caller
 * has scoped to the organization, on days they are on call, each with its reference-period
 * breakdown. Sick leave that began before `from` and runs into the range is listed too, dated
 * (and its reference period counted) from its own first day, so a payroll period covers it.
 * One batched load covers every employee and event.
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
	// The earliest event of any employee sets the loaded range; days are judged per employee.
	let firstEvent = from;
	for (const start of sickSince.values()) {
		const day = parsePlainDate(start);
		if (comparePlainDates(day, firstEvent) < 0) firstEvent = day;
	}
	const facts = await loadReferenceFactsBatch(db, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		from: referenceStartOf(firstEvent, input.method),
		untilExclusive: until,
	});
	for (const [employeeId, own] of facts) {
		result.set(employeeId, eventsOf(own, { ...input, employeeId }));
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
