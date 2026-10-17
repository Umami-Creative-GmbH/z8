import "server-only";

import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { absenceEntry, employee } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	type AbsenceDaysDatabase,
	loadWorkingDaysForEmployees,
} from "./absence-days-resolver";
import {
	loadEmployeeVacationOverrides,
	loadProratedVacationAllowances,
} from "./prorated-allowance-store";
import type {
	AbsenceWithCategory,
	VacationBalance,
	VacationBalanceConfiguration,
} from "./types";
import {
	loadVacationAdjustmentSums,
	type VacationAdjustmentSums,
	vacationAdjustmentTotal,
} from "./vacation-adjustments";
import { calculateVacationBalance } from "./vacation-calculator";
import {
	type EmployeeVacationPolicyPeriod,
	loadEmployeeVacationPolicyPeriods,
} from "./vacation-policy-history";
import { vacationPolicyCalculationsEnabled } from "./vacation-policy-rollout";
import {
	loadCompanyDefaultVacationPolicy,
	type VacationPolicy,
} from "./vacation-policy-store";
import { resolveWeightedVacationPolicy } from "./weighted-vacation-policy";

export interface VacationBalances {
	policies: Map<string, VacationPolicy>;
	configurations: Map<string, VacationBalanceConfiguration>;
	periods: Map<string, EmployeeVacationPolicyPeriod[]>;
	/** The organization's company default policy for the year; undefined when there is none. */
	policy: VacationPolicy | undefined;
	/** Only employees with complete policy coverage receive a numeric balance. */
	balances: Map<string, VacationBalance>;
	/** Each balance's adjustments by kind (#1105, #1106); same keys as `balances`. */
	adjustments: Map<string, VacationAdjustmentSums>;
}

/**
 * The vacation balance of each employee for a year (#1111): the one server-side computation behind
 * the employee's Absences page, the dashboard, the manager view, the admin vacation pages and the
 * proration notice, so they always agree.
 *
 * The admitted organization resolves dated employee policies; staged and earlier years retain the
 * company default. Each balance
 * starts from the prorated allowance (#1110), adds carryover and every adjustment (#1105, #1106),
 * subtracts approved and pending vacation in the calendar year, and reports overdrawn vacation.
 * `timezone` is the organization's, for the carryover expiry; `currentDate` decides whether the
 * carryover has expired and defaults to now.
 */
export async function loadVacationBalances(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeIds: readonly string[];
		year: number;
		timezone: string;
		currentDate?: Date;
		employeeEmploymentStartDateOverrides?: ReadonlyMap<string, string>;
		accrualDaysOverrides?: ReadonlyMap<string, number>;
		carryoverDaysOverrides?: ReadonlyMap<string, string>;
		/** Reviewed aggregate proposed by an authorized historical-usage preview. */
		previouslyTakenOverride?: { employeeId: string; days: number };
		/** Proposed dated history uses the production calculator during reconciliation review. */
		absenceChanges?: readonly {
			existingAbsenceId?: string;
			absence: AbsenceWithCategory;
		}[];
	},
): Promise<VacationBalances> {
	const { organizationId, year } = input;
	const policy = await loadCompanyDefaultVacationPolicy(database, {
		organizationId,
		year,
	});
	const requestedIds = [...new Set(input.employeeIds)];
	const employeeIds = requestedIds.length
		? (
				await database.query.employee.findMany({
					where: and(
						eq(employee.organizationId, organizationId),
						inArray(employee.id, requestedIds),
					),
					columns: { id: true },
				})
			).map((row) => row.id)
		: [];
	if (employeeIds.length === 0) {
		return {
			policy,
			policies: new Map(),
			configurations: new Map(),
			periods: new Map(),
			balances: new Map(),
			adjustments: new Map(),
		};
	}

	const startOfYear = Temporal.PlainDate.from({
		year,
		month: 1,
		day: 1,
	}).toString();
	const endOfYear = Temporal.PlainDate.from({
		year,
		month: 12,
		day: 31,
	}).toString();
	const periods = (await vacationPolicyCalculationsEnabled(
		database,
		organizationId,
		year,
	))
		? await loadEmployeeVacationPolicyPeriods(database, {
				organizationId,
				employeeIds,
				startDate: startOfYear,
				endDate: endOfYear,
			})
		: new Map(
				employeeIds.map((id) => [
					id,
					[
						{
							startDate: startOfYear,
							endDate: endOfYear,
							resolution: { status: "legacy" as const, policy },
						},
					],
				]),
			);
	const policies = new Map<string, VacationPolicy>();
	const configurations = new Map<string, VacationBalanceConfiguration>();
	for (const [employeeId, employeePeriods] of periods) {
		const result = resolveWeightedVacationPolicy(employeePeriods, { year });
		configurations.set(employeeId, result.configuration);
		if (result.policy) policies.set(employeeId, result.policy);
	}
	if (policies.size === 0)
		return {
			policy,
			policies,
			configurations,
			periods,
			balances: new Map(),
			adjustments: new Map(),
		};
	const overrides = await loadEmployeeVacationOverrides(database, {
		organizationId,
		employeeIds,
		year,
	});
	for (const [employeeId, days] of input.carryoverDaysOverrides ?? []) {
		overrides.set(employeeId, {
			customAnnualDays: null,
			...overrides.get(employeeId),
			customCarryoverDays: days,
		});
	}
	const [allowances, absences, workingDays, adjustmentSums] = await Promise.all(
		[
			// Only employees of the organization get an allowance, and so a balance.
			loadProratedVacationAllowances(database, {
				organizationId,
				employeeIds,
				year,
				policies,
				overrides,
				employeeEmploymentStartDateOverrides:
					input.employeeEmploymentStartDateOverrides,
			}),
			database.query.absenceEntry.findMany({
				where: and(
					or(
						isNull(absenceEntry.organizationId),
						eq(absenceEntry.organizationId, organizationId),
					),
					inArray(absenceEntry.employeeId, employeeIds),
					lte(absenceEntry.startDate, endOfYear),
					gte(absenceEntry.endDate, startOfYear),
				),
				with: { category: true },
			}),
			loadWorkingDaysForEmployees(database, {
				organizationId,
				employeeIds,
				startDate: startOfYear,
				endDate: endOfYear,
			}),
			loadVacationAdjustmentSums(database, {
				organizationId,
				employeeIds,
				year,
			}),
		],
	);

	const effectiveAbsences: AbsenceWithCategory[] = (
		absences as unknown as AbsenceWithCategory[]
	).filter(
		(row) =>
			!input.absenceChanges?.some(
				(change) => change.existingAbsenceId === row.id,
			),
	);
	effectiveAbsences.push(
		...(input.absenceChanges?.map((change) => change.absence) ?? []),
	);
	const absencesByEmployee = Map.groupBy(
		effectiveAbsences,
		(absence) => absence.employeeId,
	);
	const currentDate = input.currentDate ?? currentTimestamp();

	const balances = new Map<string, VacationBalance>();
	const adjustments = new Map<string, VacationAdjustmentSums>();
	for (const [employeeId, allowance] of allowances) {
		const employeePolicy = policies.get(employeeId);
		if (!employeePolicy) continue;
		const sums = adjustmentSums.get(employeeId) ?? { manual: 0, accrual: 0 };
		if (input.accrualDaysOverrides?.has(employeeId))
			sums.accrual = input.accrualDaysOverrides.get(employeeId) ?? sums.accrual;
		adjustments.set(employeeId, sums);
		balances.set(
			employeeId,
			calculateVacationBalance({
				organizationAllowance: {
					...employeePolicy,
					allowCarryover: policy?.allowCarryover ?? false,
					carryoverExpiryMonths: policy?.carryoverExpiryMonths ?? null,
				},
				employeeAllowance: overrides.get(employeeId) ?? null,
				allowance,
				absences: absencesByEmployee.get(employeeId) ?? [],
				isWorkingDay: workingDays.get(employeeId),
				currentDate,
				year,
				adjustmentTotal: vacationAdjustmentTotal(sums),
				previouslyTakenDays:
					input.previouslyTakenOverride?.employeeId === employeeId
						? input.previouslyTakenOverride.days
						: (sums.previouslyTaken ?? 0),
				timezone: input.timezone,
			}),
		);
	}
	return { policy, policies, configurations, periods, balances, adjustments };
}
