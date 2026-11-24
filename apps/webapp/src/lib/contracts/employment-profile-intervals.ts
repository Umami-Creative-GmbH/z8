/**
 * Employment profiles over a date range, resolved once per span instead of once per day (#1991).
 * Same answer as `loadEffectiveContractsBatch` with `timezoneOverride` and `organizationTimezone`
 * both set to `timezone` (its `isEmployedOnDay` and `employmentProfile`), for monitors that look
 * back a year over many employees: two queries, then one resolution per day the profile can change
 * on (terms boundaries, employment period starts and ends).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { employeeEmploymentHistory, employeeEmploymentPeriod } from "@/db/schema";
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	type EmploymentHistorySnapshot,
	type EmploymentPeriodSnapshot,
	employmentHistorySnapshotOf,
	employmentPeriodSnapshotOf,
	employmentProfileChangeDays,
	type ReadOnlyContractDb,
	resolveEmploymentProfileOnDay,
} from "./resolve-contract";
import type { EffectiveContractOnDay } from "./types";

export interface EmploymentProfileInterval {
	/** First day of the span. */
	readonly from: string;
	readonly untilExclusive: string;
	/** Null on days the employee is not employed. */
	readonly employmentProfile: EffectiveContractOnDay["employmentProfile"] | null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/**
 * The employment periods of the organization's `employeeIds`, as the contract resolver reads them,
 * per employee. One query; the same set of employees in any order gives the same statement, so a
 * request-scoped `memoizedReader` runs it once for every caller.
 */
export async function loadEmploymentPeriodSnapshots(
	db: ReadOnlyContractDb,
	input: { readonly organizationId: string; readonly employeeIds: readonly string[] },
): Promise<Map<string, EmploymentPeriodSnapshot[]>> {
	const periodsByEmployee = new Map<string, EmploymentPeriodSnapshot[]>();
	const employeeIds = [...new Set(input.employeeIds)].sort();
	if (employeeIds.length === 0) return periodsByEmployee;
	const periodRows = await db
		.select({
			id: employeeEmploymentPeriod.id,
			employeeId: employeeEmploymentPeriod.employeeId,
			status: employeeEmploymentPeriod.status,
			startedAt: employeeEmploymentPeriod.startedAt,
			startProvenance: employeeEmploymentPeriod.startProvenance,
			endedAt: employeeEmploymentPeriod.endedAt,
			createdAt: employeeEmploymentPeriod.createdAt,
			engagementKind: employeeEmploymentPeriod.engagementKind,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, input.organizationId),
				inArray(employeeEmploymentPeriod.employeeId, employeeIds),
			),
		);
	for (const row of periodRows) {
		push(periodsByEmployee, row.employeeId, employmentPeriodSnapshotOf(row));
	}
	return periodsByEmployee;
}

/**
 * Consecutive spans covering `[from, untilExclusive)` for each of `employeeIds`, adjacent spans
 * always differing in profile. Callers pass employees of the organization.
 */
export async function loadEmploymentProfileIntervals(
	db: ReadOnlyContractDb,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly from: PlainDate | string;
		readonly untilExclusive: PlainDate | string;
		readonly timezone: string;
	},
): Promise<Map<string, EmploymentProfileInterval[]>> {
	const result = new Map<string, EmploymentProfileInterval[]>();
	const employeeIds = [...new Set(input.employeeIds)];
	const from = typeof input.from === "string" ? parsePlainDate(input.from) : input.from;
	const until =
		typeof input.untilExclusive === "string"
			? parsePlainDate(input.untilExclusive)
			: input.untilExclusive;
	if (employeeIds.length === 0 || comparePlainDates(from, until) >= 0) return result;

	const periodsByEmployee = await loadEmploymentPeriodSnapshots(db, {
		organizationId: input.organizationId,
		employeeIds,
	});
	// Same rows and order as the batch resolver.
	const termsRows = await db
		.select({
			row: employeeEmploymentHistory,
			createdAtIso: sql<string>`to_char(${employeeEmploymentHistory.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, input.organizationId),
				inArray(employeeEmploymentHistory.employeeId, employeeIds),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
			),
		)
		.orderBy(asc(employeeEmploymentHistory.validFrom), asc(employeeEmploymentHistory.createdAt));

	const termsByEmployee = new Map<string, EmploymentHistorySnapshot[]>();
	for (const { row, createdAtIso } of termsRows) {
		// Custom working days never decide the profile.
		push(termsByEmployee, row.employeeId, employmentHistorySnapshotOf(row, createdAtIso, []));
	}

	for (const employeeId of employeeIds) {
		const facts = {
			employmentPeriods: periodsByEmployee.get(employeeId) ?? [],
			confirmedTerms: termsByEmployee.get(employeeId) ?? [],
			employeeCalendarTimezone: input.timezone,
			organizationTimezone: input.timezone,
		};
		const starts = [
			...new Set(
				[
					from,
					...employmentProfileChangeDays(facts).filter(
						(day) => comparePlainDates(from, day) < 0 && comparePlainDates(day, until) < 0,
					),
				].map((day) => day.toString()),
			),
		].sort();

		const spans: EmploymentProfileInterval[] = [];
		for (const [index, start] of starts.entries()) {
			const employmentProfile = resolveEmploymentProfileOnDay({
				...facts,
				day: parsePlainDate(start),
			});
			const untilExclusive = starts[index + 1] ?? until.toString();
			const previous = spans.at(-1);
			if (previous && previous.employmentProfile === employmentProfile) {
				spans[spans.length - 1] = { ...previous, untilExclusive };
			} else {
				spans.push({ from: start, untilExclusive, employmentProfile });
			}
		}
		result.set(employeeId, spans);
	}
	return result;
}
