/**
 * Who is on Minijob terms, and on what terms each day (#1989). Effective terms come from the
 * unified contract resolver, but only where they can change: on the first of every month and
 * around every confirmed terms row and employment period boundary. Between two such dates the
 * resolver's profile, wage and employment status stay the same, so each day takes the terms
 * resolved on the latest sample date at or before it.
 */
import { and, eq, gt, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { employeeEmploymentHistory, employeeEmploymentPeriod } from "@/db/schema";
import { loadEffectiveContractsBatch } from "@/lib/contracts/resolve-contract";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";
import { instantFromDate, parsePlainDate, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { firstDayOf, monthsBetween } from "./minijob-months";

type Reader = Pick<DatabaseClient, "select">;

/** Stored terms dates may stand for a calendar date a day away from their UTC date. */
const TERMS_MARGIN_DAYS = 2;

/** Sample a boundary the day before, on and after it: stored dates and instants may differ. */
const BOUNDARY_MARGIN_DAYS = 1;

function utcDate(day: string): Date {
	return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Employees of the organization with confirmed Minijob terms overlapping `[from, until)`
 * (calendar dates), optionally among `employeeIds`. Everyone else is out of scope.
 */
export async function loadMinijobCandidates(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds?: readonly string[];
		readonly from: string;
		readonly until: string;
	},
): Promise<string[]> {
	const conditions: SQL[] = [
		eq(employeeEmploymentHistory.organizationId, input.organizationId),
		eq(employeeEmploymentHistory.reviewState, "confirmed"),
		eq(employeeEmploymentHistory.employmentProfile, "minijob"),
		lt(
			employeeEmploymentHistory.validFrom,
			utcDate(parsePlainDate(input.until).add({ days: TERMS_MARGIN_DAYS }).toString()),
		),
		or(
			isNull(employeeEmploymentHistory.validUntil),
			gt(
				employeeEmploymentHistory.validUntil,
				utcDate(parsePlainDate(input.from).subtract({ days: TERMS_MARGIN_DAYS }).toString()),
			),
		) as SQL,
	];
	if (input.employeeIds) {
		if (input.employeeIds.length === 0) return [];
		conditions.push(inArray(employeeEmploymentHistory.employeeId, [...input.employeeIds]));
	}
	const rows = await db
		.select({ employeeId: employeeEmploymentHistory.employeeId })
		.from(employeeEmploymentHistory)
		.where(and(...conditions));
	return [...new Set(rows.map((row) => row.employeeId))];
}

export function isMinijobDay(contract: EffectiveContractOnDay | undefined): boolean {
	return contract?.employmentProfile === "minijob" && contract.isEmployedOnDay;
}

export interface MinijobTerms {
	/** The effective terms on `date` (`YYYY-MM-DD` within the range), if resolved. */
	contractOn(employeeId: string, date: string): EffectiveContractOnDay | undefined;
	/** Whether the employee has Minijob terms on any employed day of `month` (`YYYY-MM`). */
	isMinijobMonth(employeeId: string, month: string): boolean;
}

/** The latest of the sorted `dates` at or before `date`, by index; -1 when none is. */
function latestAtOrBefore(dates: readonly string[], date: string): number {
	let low = 0;
	let high = dates.length - 1;
	let found = -1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		if (dates[middle] <= date) {
			found = middle;
			low = middle + 1;
		} else high = middle - 1;
	}
	return found;
}

/** Effective terms of the employees across the months `[fromMonth, untilMonth)`. */
export async function loadMinijobTerms(
	db: Reader,
	input: {
		readonly organizationId: string;
		readonly employeeIds: readonly string[];
		readonly timezone: string;
		readonly fromMonth: string;
		readonly untilMonth: string;
	},
): Promise<MinijobTerms> {
	const { organizationId, timezone } = input;
	const employeeIds = [...input.employeeIds];
	const rangeFrom = firstDayOf(input.fromMonth);
	const rangeUntil = firstDayOf(input.untilMonth);
	const months = monthsBetween(input.fromMonth, input.untilMonth);

	const termsRows = await db
		.select({
			employeeId: employeeEmploymentHistory.employeeId,
			validFrom: employeeEmploymentHistory.validFrom,
			validUntil: employeeEmploymentHistory.validUntil,
			validFromDate: employeeEmploymentHistory.validFromDate,
			validUntilDate: employeeEmploymentHistory.validUntilDate,
		})
		.from(employeeEmploymentHistory)
		.where(
			and(
				eq(employeeEmploymentHistory.organizationId, organizationId),
				inArray(employeeEmploymentHistory.employeeId, employeeIds),
				eq(employeeEmploymentHistory.reviewState, "confirmed"),
			),
		);
	const periodRows = await db
		.select({
			employeeId: employeeEmploymentPeriod.employeeId,
			startedAt: employeeEmploymentPeriod.startedAt,
			endedAt: employeeEmploymentPeriod.endedAt,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				inArray(employeeEmploymentPeriod.employeeId, employeeIds),
			),
		);

	// The resolver takes one list of dates for every employee: the month starts plus every
	// boundary inside the range.
	const samples = new Set(months.map(firstDayOf));
	const addBoundary = (date: string | null) => {
		if (!date) return;
		const day = parsePlainDate(date);
		for (let offset = -BOUNDARY_MARGIN_DAYS; offset <= BOUNDARY_MARGIN_DAYS; offset++) {
			const sample = day.add({ days: offset }).toString();
			if (sample >= rangeFrom && sample < rangeUntil) samples.add(sample);
		}
	};
	const localDate = (value: Date | null) =>
		value ? plainDateAt(instantFromDate(value), timezone).toString() : null;
	for (const row of termsRows) {
		addBoundary(row.validFromDate);
		addBoundary(row.validUntilDate);
		addBoundary(localDate(row.validFrom));
		addBoundary(localDate(row.validUntil));
	}
	for (const row of periodRows) {
		addBoundary(localDate(row.startedAt));
		addBoundary(localDate(row.endedAt));
	}
	const sampleDates = [...samples].sort();

	const contracts = await loadEffectiveContractsBatch(db, {
		organizationId,
		employeeIds,
		dates: sampleDates,
		timezoneOverride: timezone,
		organizationTimezone: timezone,
	});

	const contractOn = (employeeId: string, date: string) => {
		const index = latestAtOrBefore(sampleDates, date);
		return index < 0 ? undefined : contracts.get(employeeId)?.get(sampleDates[index]);
	};
	const minijobMonths = new Map<string, Set<string>>();
	for (const employeeId of employeeIds) {
		const days = contracts.get(employeeId);
		const covered = new Set<string>();
		for (const date of sampleDates) {
			if (isMinijobDay(days?.get(date))) covered.add(date.slice(0, 7));
		}
		minijobMonths.set(employeeId, covered);
	}
	return {
		contractOn,
		isMinijobMonth: (employeeId, month) => minijobMonths.get(employeeId)?.has(month) ?? false,
	};
}
