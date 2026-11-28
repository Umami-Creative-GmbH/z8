import "server-only";

import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { absenceEntry, employee } from "@/db/schema";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { mondayToFriday } from "./absence-days";
import {
	type AbsenceDaysDatabase,
	loadWorkingDaysForEmployees,
	loadWorkingWeekPeriodsForEmployees,
} from "./absence-days-resolver";
import { FIRST_WORKING_WEEK_YEAR, outsideVacationInYear } from "./prorated-allowance";
import {
	loadEmployeeEmployments,
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
import {
	allocateLeaveCharges,
	type EarningYearLeave,
	establishesExpiry,
	establishedExpiry,
} from "./earning-year-leave";
import {
	loadCarriedEarningYearLeave,
	loadLeaveExpiryClassifications,
	type StoredEarningYearLeave,
} from "./earning-year-leave-store";
import {
	type CarriedEarningYearLeave,
	calculateVacationBalance,
	type OwnYearLeaveTerms,
	ownYearLeave,
	startingAllowanceDays,
	vacationCharges,
} from "./vacation-calculator";
import { loadFrozenCarryoverTerms } from "./vacation-carryover-terms";
import {
	type EmployeeVacationPolicyPeriod,
	loadEmployeeVacationPolicyPeriods,
} from "./vacation-policy-history";
import { vacationPolicyCalculationsEnabled } from "./vacation-policy-rollout";
import {
	loadCompanyDefaultVacationPolicy,
	type VacationPolicy,
} from "./vacation-policy-store";
import {
	resolveWeightedVacationPolicy,
	type WeightedVacationPolicy,
} from "./weighted-vacation-policy";
import type { WorkingWeekPeriod } from "./working-days";

export interface VacationBalances {
	/**
	 * Each employee's policy for the year: reference amounts weighted by month, with the combined
	 * policy/working-week rates the allowance converts (Absences ADR 0003).
	 */
	policies: Map<string, WeightedVacationPolicy>;
	configurations: Map<string, VacationBalanceConfiguration>;
	periods: Map<string, EmployeeVacationPolicyPeriod[]>;
	/** Each employee's working days per week over the year, for accrual postings. */
	workingWeeks: Map<string, WorkingWeekPeriod[]>;
	/** The organization's company default policy for the year; undefined when there is none. */
	policy: VacationPolicy | undefined;
	/** Only employees with complete policy coverage receive a numeric balance. */
	balances: Map<string, VacationBalance>;
	/** Each balance's adjustments by kind (#1105, #1106); same keys as `balances`. */
	adjustments: Map<string, VacationAdjustmentSums>;
	/**
	 * Requested people outside vacation for the year (#1996, `outsideVacationInYear`): only ever
	 * External Contractors, or External Contractors at some point without an employee day in the
	 * year. They have no vacation that year: no policy coverage, configuration or balance, so no
	 * coverage gap is reported for them, and no carry-over leaves or enters the year.
	 */
	externalContractors: Set<string>;
	/**
	 * Each balance's earning-year leave (#2080): the leave carried in by committed transfers plus
	 * the year's own leave, and the days of each charged with settled usage (approved and
	 * historical, not pending). The year-end transfer plans from this.
	 */
	yearLeave: Map<
		string,
		{
			carried: CarriedEarningYearLeave[];
			leave: EarningYearLeave[];
			/** Charged with approved and pending vacation, as the balance counts it. */
			used: Map<string, number>;
			settledUsed: Map<string, number>;
		}
	>;
}

/**
 * The carried leave a balance counts: the stored rows while the receiving allowance still holds
 * exactly their days. A later manual amount is final; it is read as one item of the earliest
 * earning year with the strongest protection among the rows, and the expiry job never touches it.
 */
function carriedLeaveForBalance(
	stored: readonly StoredEarningYearLeave[],
	liveDays: number,
): CarriedEarningYearLeave[] {
	const round2 = (value: number) => Math.round(value * 100) / 100;
	const storedDays = round2(stored.reduce((sum, row) => sum + row.capacity, 0));
	if (storedDays === round2(liveDays))
		return stored.map((row) => ({ ...row, debited: row.expiredAt !== null }));
	const protectedRow = stored.find((row) => !establishesExpiry(row.protection));
	const datedExpiry = stored
		.map((row) => establishedExpiry(row))
		.filter((expiry) => expiry !== null)
		.toSorted((a, b) => a.epochMilliseconds - b.epochMilliseconds)[0];
	const first = stored.toSorted((a, b) => a.earningYear - b.earningYear)[0];
	return [
		{
			...first,
			key: `manual:${first.transferId}`,
			portion: "all",
			protection: protectedRow?.protection ?? "policy_terms",
			capacity: Math.max(0, round2(liveDays)),
			configuredExpiry: protectedRow ? first.configuredExpiry : (datedExpiry ?? null),
			debited: false,
		},
	];
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
	const organizationEmployeeIds = requestedIds.length
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
	// An External Contractor has no vacation in a year without an employee day (#1996).
	const externalContractors = new Set<string>();
	if (organizationEmployeeIds.length > 0) {
		for (const [employeeId, employments] of await loadEmployeeEmployments(database, {
			organizationId,
			employeeIds: organizationEmployeeIds,
		})) {
			if (outsideVacationInYear(employments, year)) externalContractors.add(employeeId);
		}
	}
	const employeeIds = organizationEmployeeIds.filter((id) => !externalContractors.has(id));
	if (employeeIds.length === 0) {
		return {
			policy,
			policies: new Map(),
			configurations: new Map(),
			periods: new Map(),
			workingWeeks: new Map(),
			balances: new Map(),
			adjustments: new Map(),
			externalContractors,
			yearLeave: new Map(),
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
	// One after another: `database` may be one connection, and pg@9 refuses a query while another is executing.
	const policyCalculationsEnabled = await vacationPolicyCalculationsEnabled(
		database,
		organizationId,
		year,
	);
	const workingWeeks =
		year >= FIRST_WORKING_WEEK_YEAR
			? await loadWorkingWeekPeriodsForEmployees(database, {
					organizationId,
					employeeIds,
					startDate: startOfYear,
					endDate: endOfYear,
				})
			: new Map<string, WorkingWeekPeriod[]>();
	const periods = policyCalculationsEnabled
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
	const policies = new Map<string, WeightedVacationPolicy>();
	const configurations = new Map<string, VacationBalanceConfiguration>();
	for (const [employeeId, employeePeriods] of periods) {
		const result = resolveWeightedVacationPolicy(employeePeriods, {
			year,
			workingWeeks: workingWeeks.get(employeeId),
		});
		configurations.set(employeeId, result.configuration);
		if (result.policy) policies.set(employeeId, result.policy);
	}
	if (policies.size === 0)
		return {
			policy,
			policies,
			configurations,
			periods,
			workingWeeks,
			balances: new Map(),
			adjustments: new Map(),
			externalContractors,
			yearLeave: new Map(),
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
	// Only employees of the organization get an allowance, and so a balance.
	const allowances = await loadProratedVacationAllowances(database, {
		organizationId,
		employeeIds,
		year,
		policies,
		overrides,
		employeeEmploymentStartDateOverrides:
			input.employeeEmploymentStartDateOverrides,
	});
	const absences = await database.query.absenceEntry.findMany({
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
	});
	const workingDays = await loadWorkingDaysForEmployees(database, {
		organizationId,
		employeeIds,
		startDate: startOfYear,
		endDate: endOfYear,
	});
	const adjustmentSums = await loadVacationAdjustmentSums(database, {
		organizationId,
		employeeIds,
		year,
	});
	const frozenCarryovers = await loadFrozenCarryoverTerms(database, {
		organizationId,
		employeeIds,
		year,
	});
	const carriedLeave = await loadCarriedEarningYearLeave(database, {
		organizationId,
		employeeIds,
		receivingYear: year,
	});
	// The year's own leave is earned under the policy in effect on its last day.
	const earningPolicyIds = new Map(
		[...periods].map(([employeeId, employeePeriods]) => {
			const last = employeePeriods.findLast((period) => period.endDate >= endOfYear)?.resolution;
			return [
				employeeId,
				last?.status === "resolved" || last?.status === "legacy" ? (last.policy?.id ?? null) : null,
			];
		}),
	);
	const classifications = await loadLeaveExpiryClassifications(database, {
		organizationId,
		policyIds: [...earningPolicyIds.values(), policy?.id],
	});
	const legacyCarryoverProtected = policy
		? classifications.get(policy.id)?.expiryRules !== "policy_terms"
		: true;

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
	const yearLeave: VacationBalances["yearLeave"] = new Map();
	for (const [employeeId, allowance] of allowances) {
		const employeePolicy = policies.get(employeeId);
		if (!employeePolicy) continue;
		const sums = adjustmentSums.get(employeeId) ?? { manual: 0, accrual: 0 };
		if (input.accrualDaysOverrides?.has(employeeId))
			sums.accrual = input.accrualDaysOverrides.get(employeeId) ?? sums.accrual;
		adjustments.set(employeeId, sums);
		const frozenCarryover =
			frozenCarryovers.get(employeeId)?.allowanceId === overrides.get(employeeId)?.allowanceId &&
			frozenCarryovers.has(employeeId)
				? frozenCarryovers.get(employeeId)
				: undefined;
		const earningPolicyId = earningPolicyIds.get(employeeId) ?? null;
		const ownYear: OwnYearLeaveTerms = {
			earningPolicyId,
			classification: earningPolicyId ? classifications.get(earningPolicyId) : undefined,
			statutoryRatio:
				Number(employeePolicy.defaultAnnualDays) > 0
					? Number(employeePolicy.statutoryMinimumDays) / Number(employeePolicy.defaultAnnualDays)
					: 1,
		};
		// Rows that carried nothing (everything forfeited at year-end) stay history only.
		const stored = frozenCarryover
			? (carriedLeave.get(employeeId) ?? []).filter((row) => row.days > 0)
			: [];
		const carried = stored.length
			? carriedLeaveForBalance(stored, Number(overrides.get(employeeId)?.customCarryoverDays ?? 0))
			: [];
		const previouslyTakenDays =
			input.previouslyTakenOverride?.employeeId === employeeId
				? input.previouslyTakenOverride.days
				: (sums.previouslyTaken ?? 0);
		const isWorkingDay = workingDays.get(employeeId);
		const employeeAbsences = absencesByEmployee.get(employeeId) ?? [];
		const allowanceDays = startingAllowanceDays({
			policy: employeePolicy,
			allowance,
			employeeAllowance: overrides.get(employeeId) ?? null,
		});
		const leave = [
			...carried,
			...ownYearLeave(year, allowanceDays + vacationAdjustmentTotal(sums), ownYear),
		];
		const chargesOf = (settledOnly: boolean) =>
			allocateLeaveCharges(
				leave,
				vacationCharges({
					absences: employeeAbsences,
					year,
					isWorkingDay: isWorkingDay ?? mondayToFriday,
					previouslyTakenDays,
					settledOnly,
				}),
				input.timezone,
			).used;
		yearLeave.set(employeeId, {
			carried,
			leave,
			used: chargesOf(false),
			settledUsed: chargesOf(true),
		});
		balances.set(
			employeeId,
			calculateVacationBalance({
				frozenCarryover,
				earningYearLeave: carried.length ? { carried, ownYear } : undefined,
				legacyCarryoverProtected,
				organizationAllowance: {
					...employeePolicy,
					allowCarryover: policy?.allowCarryover ?? false,
					carryoverExpiryMonths: policy?.carryoverExpiryMonths ?? null,
				},
				employeeAllowance: overrides.get(employeeId) ?? null,
				allowance,
				absences: employeeAbsences,
				isWorkingDay,
				currentDate,
				year,
				adjustmentTotal: vacationAdjustmentTotal(sums),
				previouslyTakenDays,
				timezone: input.timezone,
			}),
		);
	}
	return {
		policy,
		policies,
		configurations,
		periods,
		workingWeeks,
		balances,
		adjustments,
		externalContractors,
		yearLeave,
	};
}
