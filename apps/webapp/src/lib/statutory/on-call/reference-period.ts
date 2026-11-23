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
import { and, eq, gt, gte, inArray, isNotNull, lt, lte } from "drizzle-orm";
import { absenceCategory, absenceEntry, workPeriod } from "@/db/schema";
import {
	getAssignedHolidayDateKeys,
	getAssignedHolidaysForEmployee,
} from "@/lib/calendar/assigned-holidays";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import {
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

const UNPAID_ABSENCE_TYPES = new Set(["unpaid", "parental"]);

interface ReferenceFacts {
	readonly contracts: ReadonlyMap<string, EffectiveContractOnDay>;
	readonly exclusionByDay: ReadonlyMap<
		string,
		Exclude<OnCallReferenceExclusionReason, "not_employed">
	>;
	readonly workMinutesByDay: Readonly<Record<string, number>>;
	readonly timezone: string;
	readonly sickStarts: readonly string[];
	readonly holidays: ReadonlySet<string>;
}

const RANK: Record<OnCallReferenceExclusionReason, number> = {
	not_employed: 4,
	unpaid_absence: 3,
	paid_absence: 2,
	public_holiday: 1,
};

/** Loads the facts of `[from, untilExclusive)` for one employee; reads only. */
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
	const from = input.from.toString();
	const until = input.untilExclusive.toString();
	const last = input.untilExclusive.subtract({ days: 1 }).toString();
	const days = daysOf(input.from, input.untilExclusive);

	const contracts =
		(
			await loadEffectiveContractsBatch(db, {
				organizationId: input.organizationId,
				employeeIds: [input.employeeId],
				dates: days,
			})
		).get(input.employeeId) ?? new Map<string, EffectiveContractOnDay>();
	const timezone = contracts.get(last)?.calendarTimezone ?? "UTC";

	const absences = await db
		.select({
			startDate: absenceEntry.startDate,
			endDate: absenceEntry.endDate,
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
				eq(absenceEntry.employeeId, input.employeeId),
				eq(absenceEntry.status, "approved"),
				lte(absenceEntry.startDate, last),
				gte(absenceEntry.endDate, from),
			),
		);

	const exclusionByDay = new Map<string, Exclude<OnCallReferenceExclusionReason, "not_employed">>();
	const exclude = (
		day: string,
		reason: Exclude<OnCallReferenceExclusionReason, "not_employed">,
	) => {
		const current = exclusionByDay.get(day);
		if (!current || RANK[reason] > RANK[current]) exclusionByDay.set(day, reason);
	};
	const sickStarts: string[] = [];
	for (const absence of absences) {
		// Home office and other categories that require work are work, not absence.
		if (absence.requiresWorkTime) continue;
		const reason = UNPAID_ABSENCE_TYPES.has(absence.type) ? "unpaid_absence" : "paid_absence";
		if (absence.type === "sick" && absence.startDate >= from) sickStarts.push(absence.startDate);
		for (
			let day = parsePlainDate(absence.startDate > from ? absence.startDate : from);
			day.toString() <= absence.endDate && day.toString() <= last;
			day = day.add({ days: 1 })
		) {
			// A half-day absence leaves the whole day out: it is no full reference day.
			exclude(day.toString(), reason);
		}
	}

	const holidays = getAssignedHolidayDateKeys(
		await getAssignedHolidaysForEmployee({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			startDate: new Date(`${from}T00:00:00.000Z`),
			endDate: new Date(`${last}T23:59:59.999Z`),
			// The holiday reader only selects; it takes the full client type.
			database: db as DatabaseClient,
		}),
	);
	const holidaysInRange = new Set([...holidays].filter((day) => day >= from && day < until));
	for (const day of holidaysInRange) exclude(day, "public_holiday");

	const window = employeePayrollWindow(from, last, timezone);
	const periods = await db
		.select({
			startTime: workPeriod.startTime,
			endTime: workPeriod.endTime,
			durationMinutes: workPeriod.durationMinutes,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, input.organizationId),
				inArray(workPeriod.employeeId, [input.employeeId]),
				completedWorkPeriodCondition(),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				lt(workPeriod.startTime, dateFromInstant(window.endExclusive)),
				gt(workPeriod.endTime, dateFromInstant(window.start)),
			),
		);
	const { minutesByDate } = allocateTrackedDailyWorkMinutes(periods, {
		startDate: from,
		throughDate: last,
		timezone,
	});

	return {
		contracts,
		exclusionByDay,
		workMinutesByDay: minutesByDate,
		timezone,
		sickStarts: [...new Set(sickStarts)].toSorted(),
		holidays: holidaysInRange,
	};
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
		onCallOnEventDate: Boolean(facts.contracts.get(input.eventDate.toString())?.onCallTerms),
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

/**
 * The on-call employee's sick-leave starts (approved) and public holidays in `[from, untilExclusive)`
 * on days they are on call, each with its reference-period breakdown. One load covers all events.
 */
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
	const from = parsePlainDate(input.from);
	const until = parsePlainDate(input.untilExclusive);
	if (comparePlainDates(from, until) >= 0) return [];
	const facts = await loadReferenceFacts(db, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		from: referenceStartOf(from, input.method),
		untilExclusive: until,
	});
	const inRange = (day: string) => day >= input.from && day < input.untilExclusive;
	const candidates: { kind: OnCallReferenceEventKind; eventDate: string }[] = [
		...facts.sickStarts
			.filter(inRange)
			.map((eventDate) => ({ kind: "sick_leave" as const, eventDate })),
		...[...facts.holidays]
			.filter(inRange)
			.map((eventDate) => ({ kind: "public_holiday" as const, eventDate })),
	];
	return candidates
		.filter((event) => Boolean(facts.contracts.get(event.eventDate)?.onCallTerms))
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
