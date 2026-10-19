import "server-only";

import { calendarYearAt, instantFromDate } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { type AbsenceDayRange, absenceDaysByYear, type IsWorkingDay } from "./absence-days";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import { loadVacationBalances } from "./vacation-balance-store";
import {
	type VacationYearBalanceEvidence,
	type VacationYearImpact,
	vacationYearImpacts,
	yearsExceedingBalance,
} from "./vacation-year-balance";

const logger = createLogger("VacationYearBalances");

/**
 * One employee's recorded vacation balance for each year, read with the shared balance computation
 * at one evaluation time. Each year stands alone: a missing or conflicting policy, or a failed
 * read, makes only that year unavailable.
 */
export async function loadVacationYearBalances(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		years: readonly number[];
		/** The organization's zone, for the carryover expiry. */
		timezone: string;
		/** The evaluation time; it decides whether carryover has expired. */
		currentDate: Date;
	},
): Promise<VacationYearBalanceEvidence[]> {
	return Promise.all(
		input.years.map(async (year): Promise<VacationYearBalanceEvidence> => {
			try {
				const { balances, configurations } = await loadVacationBalances(database, {
					organizationId: input.organizationId,
					employeeIds: [input.employeeId],
					year,
					timezone: input.timezone,
					currentDate: input.currentDate,
				});
				const balance = balances.get(input.employeeId);
				if (balance) return { year, status: "available", balance };
				return {
					year,
					status: "unavailable",
					reason:
						configurations.get(input.employeeId)?.status === "conflict"
							? "conflicting_policy"
							: "missing_policy",
				};
			} catch (error) {
				logger.error(
					{ error, organizationId: input.organizationId, employeeId: input.employeeId, year },
					"Failed to read vacation balance for year",
				);
				return { year, status: "unavailable", reason: "read_failed" };
			}
		}),
	);
}

/**
 * The years whose recorded remaining vacation balance a requested absence exceeds, judged per
 * calendar year on the employee's working days. Years with unavailable balance evidence, and years
 * the absence charges nothing, never block.
 */
export async function findYearsExceedingBalance(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		/** The absence as stored: an explicit partial day is its start day only. */
		absence: AbsenceDayRange;
		/** The employee's working days over the absence, as the caller already read them. */
		isWorkingDay: IsWorkingDay;
		currentDate: Date;
	},
): Promise<VacationYearImpact[]> {
	const charges = absenceDaysByYear(input.absence, input.isWorkingDay).filter(
		(charge) => charge.absenceDays > 0,
	);
	if (charges.length === 0) return [];
	const timezone = await loadOrganizationTimezone(database, input.organizationId);
	const evidence = await loadVacationYearBalances(database, {
		organizationId: input.organizationId,
		employeeId: input.employeeId,
		years: charges.map((charge) => charge.year),
		timezone,
		currentDate: input.currentDate,
	});
	return yearsExceedingBalance(
		vacationYearImpacts({
			charges,
			evidence,
			currentYear: calendarYearAt(instantFromDate(input.currentDate), timezone),
		}),
	);
}
