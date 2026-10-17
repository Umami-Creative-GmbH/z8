import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	type EmployeeEmploymentHistory,
	employeeEmploymentHistory,
} from "@/db/schema";
import {
	type Instant,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { ContractType } from "@/lib/validations/employee";
import {
	type CalendarDateRange,
	confirmedTermsSpans,
	type TermsSpan,
	termsInForceOn,
	termsSpansOverlapping,
	utcMidnight,
} from "./terms-in-force";

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Pick<Transaction, "select">;

/**
 * A stored terms timestamp can stand for a calendar date up to a day away
 * from its UTC date (see `termsCalendarDate`), so rows are read with this
 * margin and the calendar decides in TypeScript.
 */
const STORED_DATE_MARGIN_DAYS = 2;

async function loadConfirmedTermsRows(
	reader: Reader,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		range: CalendarDateRange;
	},
): Promise<EmployeeEmploymentHistory[]> {
	if (input.employeeIds.length === 0) return [];
	// Ended terms still suppress older overlapping rows. Filtering by validUntil
	// before resolving precedence would resurrect an older open-ended row.
	return reader
		.select()
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				inArray(employeeEmploymentHistory.employeeId, [...input.employeeIds]),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
				lt(
					employeeEmploymentHistory.validFrom,
					utcMidnight(
						input.range.toExclusive.add({ days: STORED_DATE_MARGIN_DAYS }),
					),
				),
			),
		)
		.orderBy(
			asc(employeeEmploymentHistory.validFrom),
			asc(employeeEmploymentHistory.createdAt),
		);
}

/**
 * The employee's confirmed terms overlapping `range`, in date order, read for
 * one organization. Spans are not clipped to the range, so wage boundaries at
 * its edges are never invented; use `clipTermsSpans` for per-day work.
 * `timezone` defaults to the organization's.
 */
export async function loadConfirmedTermsSpans(
	reader: Reader,
	input: {
		organizationId: string;
		employeeId: string;
		range: CalendarDateRange;
		timezone?: string;
	},
): Promise<TermsSpan<EmployeeEmploymentHistory>[]> {
	const timezone =
		input.timezone ??
		(await loadOrganizationTimezone(reader, input.organizationId));
	const rows = await loadConfirmedTermsRows(reader, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		range: input.range,
	});

	return termsSpansOverlapping(
		confirmedTermsSpans(rows, timezone),
		input.range,
	);
}

/** The employee's confirmed terms in force on `date`, read for one organization. */
export async function loadTermsInForceOn(
	reader: Reader,
	input: {
		organizationId: string;
		employeeId: string;
		date: PlainDate;
		timezone?: string;
	},
): Promise<EmployeeEmploymentHistory | null> {
	const [span] = await loadConfirmedTermsSpans(reader, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		range: { from: input.date, toExclusive: input.date.add({ days: 1 }) },
		timezone: input.timezone,
	});
	return span?.terms ?? null;
}

/** Confirmed terms on one calendar date, read in one batch for an organization's employees. */
export async function loadTermsInForceOnByEmployee(
	reader: Reader,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		date: PlainDate;
		timezone?: string;
	},
): Promise<Map<string, EmployeeEmploymentHistory>> {
	if (input.employeeIds.length === 0) return new Map();
	const timezone =
		input.timezone ??
		(await loadOrganizationTimezone(reader, input.organizationId));
	const rows = await loadConfirmedTermsRows(reader, {
		organizationId: input.organizationId,
		employeeIds: input.employeeIds,
		range: { from: input.date, toExclusive: input.date.add({ days: 1 }) },
	});
	const rowsByEmployee = new Map<string, EmployeeEmploymentHistory[]>();
	for (const row of rows) {
		const employeeRows = rowsByEmployee.get(row.employeeId) ?? [];
		employeeRows.push(row);
		rowsByEmployee.set(row.employeeId, employeeRows);
	}
	const terms = new Map<string, EmployeeEmploymentHistory>();
	for (const [employeeId, employeeRows] of rowsByEmployee) {
		const current = termsInForceOn(employeeRows, input.date, timezone);
		if (current) terms.set(employeeId, current);
	}
	return terms;
}

type EmployeeContractSource = { id: string; contractType: ContractType };

/**
 * Effective contract types on a calendar date (#1161). Confirmed terms win;
 * without applicable terms the stored employee type is a compatibility fallback,
 * not authoritative historical evidence. One terms query serves the whole list.
 * Callers supply employees they have already authorized in this organization.
 */
export async function loadContractTypesOn(
	reader: Reader,
	input: {
		organizationId: string;
		employees: readonly EmployeeContractSource[];
		date: PlainDate;
		timezone?: string;
	},
): Promise<Map<string, ContractType>> {
	const types = new Map(
		input.employees.map((row) => [row.id, row.contractType]),
	);
	if (types.size === 0) return types;
	const timezone =
		input.timezone ??
		(await loadOrganizationTimezone(reader, input.organizationId));
	const rows = await loadConfirmedTermsRows(reader, {
		organizationId: input.organizationId,
		employeeIds: [...types.keys()],
		range: { from: input.date, toExclusive: input.date.add({ days: 1 }) },
	});
	const byEmployee = new Map<string, EmployeeEmploymentHistory[]>();
	for (const row of rows) {
		const employeeRows = byEmployee.get(row.employeeId) ?? [];
		employeeRows.push(row);
		byEmployee.set(row.employeeId, employeeRows);
	}
	for (const [employeeId, employeeRows] of byEmployee) {
		const terms = termsInForceOn(employeeRows, input.date, timezone);
		if (terms) types.set(employeeId, terms.contractType);
	}
	return types;
}

/** A fresh read on today's organization-local date; no cross-request cache. */
export async function loadCurrentContractTypes(
	reader: Reader,
	input: {
		organizationId: string;
		employees: readonly EmployeeContractSource[];
		now?: Instant;
	},
): Promise<Map<string, ContractType>> {
	if (input.employees.length === 0) return new Map();
	const { timezone, today } = await loadOrganizationDay(reader, {
		organizationId: input.organizationId,
		now: input.now ?? systemClock.nowInstant(),
	});
	return loadContractTypesOn(reader, { ...input, date: today, timezone });
}
