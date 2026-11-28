import "server-only";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import {
	auditLog,
	employee,
	employeeVacationAllowance,
	vacationAdjustment,
	vacationCarryoverTransfer,
	vacationEarningYearLeave,
} from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parsePlainDate,
	plainDateAt,
} from "@/lib/datetime/temporal-core";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import { loadEmployeeEmployments, loadEmployeeVacationOverrides } from "./prorated-allowance-store";
import type { VacationBalanceConfiguration } from "./types";
import {
	accruingEmployments,
	FIRST_ACCRUAL_CATCH_UP_YEAR,
	policyPeriodMonthlyAccrualDays,
} from "./vacation-accrual";
import { loadVacationBalances } from "./vacation-balance-store";
import { planYearEndCarryover } from "./earning-year-leave";
import type { EmployeeVacationPolicyPeriod } from "./vacation-policy-history";
import { isAccrualPolicy } from "./vacation-policy-settings";

export type EmploymentVacationRefresh = {
	accruals: Array<{
		id: string | null;
		year: number;
		month: number;
		days: string | null;
	}>;
	accrualSums: Map<number, number>;
	carryovers: Array<{
		id: string;
		year: number;
		days: string;
		transferId: string | null;
		/** The days of each earning year and portion the corrected transfer carries (#2080). */
		earningYears?: Array<{ earningYear: number; portion: string; days: string }>;
	}>;
	carryoverEvidence: unknown[];
	policyEvidence: Array<{
		year: number;
		configuration: VacationBalanceConfiguration | undefined;
		periods: EmployeeVacationPolicyPeriod[];
	}>;
};
/** Reuses the scheduled job's grant rule; only derived period grants may change. */
export async function planEmploymentVacationRefresh(
	client: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		employmentStartDate: string;
		timezone: string;
		now: Instant;
	},
): Promise<EmploymentVacationRefresh> {
	const today = plainDateAt(input.now, input.timezone);
	// One after another: `client` may be one connection, and pg@9 refuses a query while another is executing.
	const employment = await loadEmployeeEmployments(client, {
		organizationId: input.organizationId,
		employeeIds: [input.employeeId],
		employeeEmploymentStartDateOverrides: new Map([[input.employeeId, input.employmentStartDate]]),
	});
	const existing = await client
		.select({
			id: vacationAdjustment.id,
			year: vacationAdjustment.year,
			month: vacationAdjustment.accrualMonth,
			days: vacationAdjustment.days,
		})
		.from(vacationAdjustment)
		.innerJoin(employee, eq(employee.id, vacationAdjustment.employeeId))
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				eq(vacationAdjustment.employeeId, input.employeeId),
				eq(vacationAdjustment.kind, "accrual"),
			),
		);
	const person = employment.get(input.employeeId);
	const result: EmploymentVacationRefresh = {
		accruals: [],
		accrualSums: new Map(),
		carryovers: [],
		carryoverEvidence: [],
		policyEvidence: [],
	};
	if (!person) return result;
	for (
		let year = FIRST_ACCRUAL_CATCH_UP_YEAR;
		year <= Math.max(today.year, ...existing.map((row) => row.year));
		year++
	) {
		const resolved = await loadVacationBalances(client, {
			organizationId: input.organizationId,
			employeeIds: [input.employeeId],
			year,
			timezone: input.timezone,
			currentDate: dateFromInstant(input.now),
			employeeEmploymentStartDateOverrides: new Map([
				[input.employeeId, input.employmentStartDate],
			]),
		});
		const configuration = resolved.configurations.get(input.employeeId);
		const periods = resolved.periods.get(input.employeeId) ?? [];
		result.policyEvidence.push({ year, configuration, periods });
		const policy = resolved.policies.get(input.employeeId);
		if (!policy || !isAccrualPolicy(policy)) continue;
		const overrides = await loadEmployeeVacationOverrides(client, {
			organizationId: input.organizationId,
			employeeIds: [input.employeeId],
			year,
		});

		const months = new Set(
			existing.flatMap((row) => (row.year === year && row.month !== null ? [row.month] : [])),
		);
		const throughMonth = year < today.year ? 12 : year === today.year ? today.month : 0;
		for (let month = 1; month <= throughMonth; month++) months.add(month);
		let sum = existing
			.filter((row) => row.year === year && row.month === null)
			.reduce((total, row) => total + Number(row.days), 0);
		for (const month of [...months].sort((a, b) => a - b)) {
			const share = policyPeriodMonthlyAccrualDays({
				periods,
				workingWeeks: resolved.workingWeeks.get(input.employeeId),
				customAnnualDays: overrides.get(input.employeeId)?.customAnnualDays,
				year,
				month,
				employments: accruingEmployments(person),
			});
			const days = share === null ? null : share.toFixed(2);
			sum += Number(days ?? 0);
			result.accruals.push({
				id: existing.find((row) => row.year === year && row.month === month)?.id ?? null,
				year,
				month,
				days,
			});
		}
		result.accrualSums.set(year, sum);
	}

	const allowances = await client
		.select({
			id: employeeVacationAllowance.id,
			year: employeeVacationAllowance.year,
			days: employeeVacationAllowance.customCarryoverDays,
			updatedAt: employeeVacationAllowance.updatedAt,
		})
		.from(employeeVacationAllowance)
		.innerJoin(employee, eq(employee.id, employeeVacationAllowance.employeeId))
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
		)
		.orderBy(employeeVacationAllowance.year);
	const logs = await client
		.select({ metadata: auditLog.metadata, timestamp: auditLog.timestamp })
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, input.organizationId),
				eq(auditLog.entityId, input.employeeId),
				eq(auditLog.action, AuditAction.VACATION_CARRYOVER_APPLIED),
			),
		)
		.orderBy(desc(auditLog.timestamp));
	const transfers = await client
		.select()
		.from(vacationCarryoverTransfer)
		.where(
			and(
				eq(vacationCarryoverTransfer.organizationId, input.organizationId),
				eq(vacationCarryoverTransfer.employeeId, input.employeeId),
			),
		)
		.orderBy(vacationCarryoverTransfer.sourceYear);
	result.carryoverEvidence = [...logs, ...transfers];
	const carryoverOverrides = new Map<number, string>();
	for (const allowance of allowances) {
		if (allowance.days === null || allowance.year > today.year) continue;
		const transfer = transfers.find(
			(row) => row.sourceYear === allowance.year - 1 && row.outcome === "generated",
		);
		if (transfer) {
			// The durable system record proves only the last untouched derived amount.
			const derivedAt = transfer.reviewedAt ?? transfer.createdAt;
			if (
				transfer.expiredAt ||
				transfer.allowanceId !== allowance.id ||
				Number(transfer.days) !== Number(allowance.days) ||
				allowance.updatedAt.getTime() > derivedAt.getTime()
			)
				continue;
		} else {
			const source = logs.find((log) => {
				try {
					const meta = JSON.parse(log.metadata ?? "null");
					return meta?.toYear === allowance.year;
				} catch {
					return false;
				}
			});
			if (!source || allowance.updatedAt.getTime() > source.timestamp.getTime()) continue;
			const metadata = JSON.parse(source.metadata ?? "{}");
			// Legacy rows need audit provenance; later manual edits stay final.
			if (Number(metadata.carryoverApplied) !== Number(allowance.days)) continue;
		}
		const fromYear = allowance.year - 1;

		const currentDate = dateFromInstant(
			parsePlainDate(`${fromYear}-12-31`).toZonedDateTime(input.timezone).toInstant(),
		);
		const balances = await loadVacationBalances(client, {
			organizationId: input.organizationId,
			employeeIds: [input.employeeId],
			year: fromYear,
			timezone: input.timezone,
			currentDate,
			employeeEmploymentStartDateOverrides: new Map([
				[input.employeeId, input.employmentStartDate],
			]),
			accrualDaysOverrides: result.accrualSums.has(fromYear)
				? new Map([[input.employeeId, result.accrualSums.get(fromYear) ?? 0]])
				: undefined,
			carryoverDaysOverrides: carryoverOverrides.has(fromYear)
				? new Map([[input.employeeId, carryoverOverrides.get(fromYear) ?? "0"]])
				: undefined,
		});
		const sourcePeriods = balances.periods.get(input.employeeId) ?? [];
		result.policyEvidence.push({
			year: fromYear,
			configuration: balances.configurations.get(input.employeeId),
			periods: sourcePeriods,
		});
		const sourceResolution = sourcePeriods.find(
			(period) => period.startDate <= `${fromYear}-12-31` && period.endDate >= `${fromYear}-12-31`,
		)?.resolution;
		const policy =
			sourceResolution?.status === "resolved" || sourceResolution?.status === "legacy"
				? sourceResolution.policy
				: undefined;
		const balance = balances.balances.get(input.employeeId);
		const yearLeave = balances.yearLeave.get(input.employeeId);
		if (!balance || !policy || !yearLeave) continue;
		// The year-end rule: only leave governed by its earning policy's terms is capped (#2080).
		const value = planYearEndCarryover({
			sourceYear: fromYear,
			leave: yearLeave.leave,
			used: yearLeave.settledUsed,
			yearEnd: instantFromDate(currentDate),
			allowCarryover: policy.allowCarryover,
			maxCarryoverDays: policy.maxCarryoverDays === null ? null : Number(policy.maxCarryoverDays),
			receivingExpiry: null,
		});
		result.carryovers.push({
			id: allowance.id,
			year: allowance.year,
			days: String(value.applied),
			transferId: transfer?.id ?? null,
			earningYears: value.carried.map((row) => ({
				earningYear: row.earningYear,
				portion: row.portion,
				days: String(row.days),
			})),
		});
		carryoverOverrides.set(allowance.year, String(value.applied));
	}
	return result;
}
/** Caller owns the employee/configuration guards and transaction; manual adjustments stay intact. */
export async function applyEmploymentVacationRefresh(
	client: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		plan: EmploymentVacationRefresh;
		actorUserId: string;
		now: Instant;
		audit: AuditTrail;
	},
) {
	const [target] = await client
		.select({ id: employee.id })
		.from(employee)
		.where(
			and(eq(employee.organizationId, input.organizationId), eq(employee.id, input.employeeId)),
		);
	if (!target) throw new Error("Employee outside organization");
	for (const row of input.plan.accruals) {
		if (row.id) {
			const scope = and(
				eq(vacationAdjustment.id, row.id),
				eq(vacationAdjustment.employeeId, input.employeeId),
				eq(vacationAdjustment.kind, "accrual"),
				isNotNull(vacationAdjustment.accrualMonth),
			);
			if (row.days === null) await client.delete(vacationAdjustment).where(scope);
			else
				await client
					.update(vacationAdjustment)
					.set({
						days: row.days,
						reason: `Monthly accrual for ${row.year}-${String(row.month).padStart(2, "0")}: +${row.days} days (reviewed employment correction)`,
					})
					.where(scope);
		} else if (row.days !== null)
			await client.insert(vacationAdjustment).values({
				employeeId: input.employeeId,
				year: row.year,
				accrualMonth: row.month,
				days: row.days,
				kind: "accrual",
				adjustedBy: null,
				reason: `Monthly accrual for ${row.year}-${String(row.month).padStart(2, "0")}: +${row.days} days (reviewed employment correction)`,
			});
	}
	for (const row of input.plan.carryovers) {
		await client
			.update(employeeVacationAllowance)
			.set({
				customCarryoverDays: row.days,
				updatedAt: dateFromInstant(input.now),
			})
			.where(
				and(
					eq(employeeVacationAllowance.id, row.id),
					eq(employeeVacationAllowance.employeeId, input.employeeId),
					eq(employeeVacationAllowance.year, row.year),
				),
			);
		if (row.transferId) {
			await client
				.update(vacationCarryoverTransfer)
				.set({ days: row.days, reviewedAt: dateFromInstant(input.now) })
				.where(
					and(
						eq(vacationCarryoverTransfer.id, row.transferId),
						eq(vacationCarryoverTransfer.organizationId, input.organizationId),
						eq(vacationCarryoverTransfer.employeeId, input.employeeId),
						eq(vacationCarryoverTransfer.outcome, "generated"),
					),
				);
			await correctEarningYearLeave(client, {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				transferId: row.transferId,
				earningYears: row.earningYears ?? [],
			});
		}
		await input.audit.record(client, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			targetType: "employee",
			targetId: input.employeeId,
			employeeId: input.employeeId,
			action: AuditAction.VACATION_CARRYOVER_APPLIED,
			metadata: {
				source: "reviewed_employment_correction",
				fromYear: row.year - 1,
				toYear: row.year,
				carryoverApplied: Number(row.days),
				transferId: row.transferId,
			},
		});
	}
}

/**
 * Moves a corrected transfer's earning-year rows to the corrected days when each planned earning
 * year and portion matches exactly one untouched row. Otherwise the rows stay as committed and the
 * corrected amount reads as a final manual amount with the rows' strongest protection (#2080).
 */
async function correctEarningYearLeave(
	client: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		employeeId: string;
		transferId: string;
		earningYears: ReadonlyArray<{ earningYear: number; portion: string; days: string }>;
	},
) {
	const rows = await client
		.select()
		.from(vacationEarningYearLeave)
		.where(
			and(
				eq(vacationEarningYearLeave.organizationId, input.organizationId),
				eq(vacationEarningYearLeave.employeeId, input.employeeId),
				eq(vacationEarningYearLeave.transferId, input.transferId),
			),
		);
	const planned = new Map(
		input.earningYears.map((row) => [`${row.earningYear}:${row.portion}`, row.days]),
	);
	const matches =
		rows.length > 0 &&
		rows.every(
			(row) => row.expiredAt === null && planned.has(`${row.earningYear}:${row.portion}`),
		) &&
		planned.size === rows.length;
	if (!matches) return;
	for (const row of rows)
		await client
			.update(vacationEarningYearLeave)
			.set({ days: planned.get(`${row.earningYear}:${row.portion}`) ?? row.days })
			.where(
				and(
					eq(vacationEarningYearLeave.id, row.id),
					eq(vacationEarningYearLeave.organizationId, input.organizationId),
				),
			);
}
