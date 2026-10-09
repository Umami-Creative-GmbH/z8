import "server-only";

import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { costRate, employee, employeeRateHistory } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import {
	dateFromInstant,
	type Instant,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import {
	type CostRate,
	type CostRatePeriod,
	type CostRatePeriodView,
	resolveCostRate,
	type SuggestedWage,
} from "./cost-rate";
import type { BillableCurrency } from "./currency";
import { formatRate, parseRate, type RateUnits, rateFromStored } from "./money";
import { writeRatePeriodChange } from "./rate-period-writer";
import type { RatePeriod, RatePeriodStore } from "./rate-periods";
import { lockBillableTimeSettings } from "./settings";

/**
 * Cost rates per employee (#899): writer and readers. The pure resolver is
 * `cost-rate.ts`. Cost rates are separate from the wage: nothing here reads
 * them into, or writes them from, wage history, payroll or hourly earnings
 * (the wage is only read to suggest a starting value, `getSuggestedWage`).
 */

export type CostRateReader = Pick<Transaction, "select">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an untrusted value is an employee id (a uuid). */
export function isEmployeeId(value: unknown): value is string {
	return typeof value === "string" && UUID_PATTERN.test(value);
}

const plainDate = (value: string) => Temporal.PlainDate.from(value);

function seriesCondition(organizationId: string, employeeId: string) {
	return and(eq(costRate.organizationId, organizationId), eq(costRate.employeeId, employeeId));
}

function periodFromRow(row: typeof costRate.$inferSelect): CostRatePeriod {
	return {
		id: row.id,
		employeeId: row.employeeId,
		from: plainDate(row.effectiveFrom),
		to: row.effectiveTo === null ? null : plainDate(row.effectiveTo),
		rate: rateFromStored(row.hourlyRate),
	};
}

function viewFromRow(row: typeof costRate.$inferSelect): CostRatePeriodView {
	return {
		id: row.id,
		effectiveFrom: row.effectiveFrom,
		effectiveTo: row.effectiveTo,
		hourlyRate: formatRate(rateFromStored(row.hourlyRate)),
	};
}

function costRateStore(
	tx: Transaction,
	input: { organizationId: string; employeeId: string; actorUserId: string },
): RatePeriodStore<RateUnits> {
	const inSeries = (id: string) =>
		and(eq(costRate.id, id), seriesCondition(input.organizationId, input.employeeId));
	return {
		async lockAndLoad(): Promise<RatePeriod<RateUnits>[]> {
			const rows = await tx
				.select()
				.from(costRate)
				.where(seriesCondition(input.organizationId, input.employeeId))
				.for("update");
			return rows.map((row) => {
				const period = periodFromRow(row);
				return { id: period.id, from: period.from, to: period.to, value: period.rate };
			});
		},
		async shorten(id, to) {
			await tx
				.update(costRate)
				.set({ effectiveTo: to.toString(), updatedAt: sql`now()`, updatedBy: input.actorUserId })
				.where(inSeries(id));
		},
		async remove(id) {
			await tx.delete(costRate).where(inSeries(id));
		},
		async updateValue(id, value) {
			await tx
				.update(costRate)
				.set({ hourlyRate: formatRate(value), updatedAt: sql`now()`, updatedBy: input.actorUserId })
				.where(inSeries(id));
		},
		async insert(from, to, value) {
			const [row] = await tx
				.insert(costRate)
				.values({
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					hourlyRate: formatRate(value),
					effectiveFrom: from.toString(),
					effectiveTo: to?.toString() ?? null,
					createdBy: input.actorUserId,
					updatedBy: input.actorUserId,
				})
				.returning({ id: costRate.id });
			return row.id;
		},
	};
}

/** Whether the employee belongs to the organization. */
export async function employeeExists(
	reader: CostRateReader,
	organizationId: string,
	employeeId: string,
): Promise<boolean> {
	const [row] = await reader
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
		.limit(1);
	return row !== undefined;
}

export type CostRateChange =
	| { kind: "set"; effectiveFrom: string; rate: string }
	| { kind: "end"; effectiveFrom: string };

export type CostRateRefusal =
	/** The module is off (or was never switched on): cost rates are read-only. */
	"billable_time_off" | "employee_not_found" | "invalid_rate" | "invalid_date";

export type CostRateOutcome =
	| { ok: true; changed: boolean; periods: CostRatePeriodView[] }
	| { ok: false; reason: CostRateRefusal };

function parseDate(value: string): PlainDate | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	try {
		return Temporal.PlainDate.from(value, { overflow: "reject" });
	} catch {
		return null;
	}
}

/**
 * Sets or ends an employee's cost rate from a date (#899), for any contract
 * type. Backdating is allowed. Never touches the wage. The caller authorizes
 * the actor as an org admin of `organizationId` first. Like every rate writer,
 * it does not take Time Tracking's organization configuration guard (Billable
 * Time ADR 0001).
 */
export async function changeCostRate(
	database: typeof db,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		change: CostRateChange;
	},
): Promise<CostRateOutcome> {
	const from = parseDate(input.change.effectiveFrom);
	if (!from) return { ok: false, reason: "invalid_date" };
	let rate: RateUnits | null = null;
	if (input.change.kind === "set") {
		const parsed = parseRate(input.change.rate);
		if (!parsed.ok) return { ok: false, reason: "invalid_rate" };
		rate = parsed.units;
	}

	return database.transaction(async (tx) => {
		const settings = await lockBillableTimeSettings(tx, input.organizationId, "share");
		if (!settings.enabled) return { ok: false, reason: "billable_time_off" } as const;
		if (!(await employeeExists(tx, input.organizationId, input.employeeId))) {
			return { ok: false, reason: "employee_not_found" } as const;
		}

		const applied = await writeRatePeriodChange(tx, {
			seriesKey: ["cost_rate", input.organizationId, input.employeeId].join(":"),
			store: costRateStore(tx, input),
			change: rate === null ? { kind: "end", from } : { kind: "set", from, value: rate },
			audit: {
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				entityType: "cost_rate",
				actions: { set: AuditAction.COST_RATE_SET, end: AuditAction.COST_RATE_ENDED },
				employeeId: input.employeeId,
				target: { employeeId: input.employeeId, currency: settings.currency },
				describe: (value) => formatRate(value),
			},
		});

		return {
			ok: true,
			changed: applied.changed,
			periods: await listCostRateHistory(tx, input.organizationId, input.employeeId),
		} as const;
	});
}

/** One employee's cost rate periods, newest first. */
export async function listCostRateHistory(
	reader: CostRateReader,
	organizationId: string,
	employeeId: string,
): Promise<CostRatePeriodView[]> {
	const rows = await reader
		.select()
		.from(costRate)
		.where(seriesCondition(organizationId, employeeId))
		.orderBy(desc(costRate.effectiveFrom));
	return rows.map(viewFromRow);
}

/**
 * Every cost rate period of the given employees, optionally only those in
 * effect on some day of `[fromDay, toDay]`. Set-based, for margin reports
 * (#902): pass the result to `resolveCostRate` or `costWorkPeriod`.
 */
export async function listCostRatesForWork(
	reader: CostRateReader,
	organizationId: string,
	scope: { employeeIds: readonly string[]; fromDay?: PlainDate; toDay?: PlainDate },
): Promise<CostRatePeriod[]> {
	if (scope.employeeIds.length === 0) return [];
	const conditions = [
		eq(costRate.organizationId, organizationId),
		inArray(costRate.employeeId, [...scope.employeeIds]),
	];
	if (scope.toDay) {
		conditions.push(lt(costRate.effectiveFrom, scope.toDay.add({ days: 1 }).toString()));
	}
	if (scope.fromDay) {
		const open = or(
			isNull(costRate.effectiveTo),
			gt(costRate.effectiveTo, scope.fromDay.toString()),
		);
		if (open) conditions.push(open);
	}
	const rows = await reader
		.select()
		.from(costRate)
		.where(and(...conditions))
		.orderBy(asc(costRate.employeeId), asc(costRate.effectiveFrom));
	return rows.map(periodFromRow);
}

/**
 * An employee's cost rate at an instant, read now: the period in effect on the
 * employee-local day of `at` at `offsetMinutes`, or unknown.
 */
export async function getCostRate(
	reader: CostRateReader,
	organizationId: string,
	input: { employeeId: string; at: Instant; offsetMinutes: number },
): Promise<CostRate> {
	const rates = await listCostRatesForWork(reader, organizationId, {
		employeeIds: [input.employeeId],
	});
	return resolveCostRate(input, rates);
}

/**
 * The wage of an hourly employee in effect now, from the wage history the
 * employee report reads (`employee_rate_history`), when it is in the billable
 * currency. Null for any other contract type, without a wage in effect, or for
 * a wage in another currency. Read-only: a suggestion for the cost rate form.
 */
export async function getSuggestedWage(
	reader: CostRateReader,
	organizationId: string,
	employeeId: string,
	currency: BillableCurrency,
	at: Instant = systemClock.nowInstant(),
): Promise<SuggestedWage | null> {
	const now = dateFromInstant(at);
	const [row] = await reader
		.select({ hourlyRate: employeeRateHistory.hourlyRate, currency: employeeRateHistory.currency })
		.from(employeeRateHistory)
		.innerJoin(
			employee,
			and(
				eq(employee.id, employeeRateHistory.employeeId),
				eq(employee.organizationId, employeeRateHistory.organizationId),
			),
		)
		.where(
			and(
				eq(employeeRateHistory.organizationId, organizationId),
				eq(employeeRateHistory.employeeId, employeeId),
				eq(employee.contractType, "hourly"),
				lte(employeeRateHistory.effectiveFrom, now),
				or(isNull(employeeRateHistory.effectiveTo), gt(employeeRateHistory.effectiveTo, now)),
			),
		)
		.orderBy(desc(employeeRateHistory.effectiveFrom))
		.limit(1);
	if (!row || row.currency !== currency) return null;
	const parsed = parseRate(row.hourlyRate);
	return parsed.ok ? { hourlyRate: formatRate(parsed.units) } : null;
}

/** An employee and their cost rate periods, for the settings overview. */
export interface EmployeeCostRates {
	employeeId: string;
	name: string;
	contractType: "fixed" | "hourly";
	isActive: boolean;
	/** Newest first. */
	periods: CostRatePeriodView[];
}

/**
 * The cost rates of every employee of an organization: active employees, and
 * inactive ones that have a cost rate.
 */
export async function listEmployeeCostRates(
	reader: CostRateReader,
	organizationId: string,
): Promise<EmployeeCostRates[]> {
	const [employees, rates] = await Promise.all([
		reader
			.select({
				id: employee.id,
				firstName: user.firstName,
				lastName: user.lastName,
				name: user.name,
				email: user.email,
				contractType: employee.contractType,
				isActive: employee.isActive,
			})
			.from(employee)
			.leftJoin(user, eq(user.id, employee.userId))
			.where(eq(employee.organizationId, organizationId)),
		reader
			.select()
			.from(costRate)
			.where(eq(costRate.organizationId, organizationId))
			.orderBy(desc(costRate.effectiveFrom)),
	]);
	const periodsByEmployee = new Map<string, CostRatePeriodView[]>();
	for (const row of rates) {
		const periods = periodsByEmployee.get(row.employeeId) ?? [];
		periods.push(viewFromRow(row));
		periodsByEmployee.set(row.employeeId, periods);
	}
	return employees
		.map((row) => ({
			employeeId: row.id,
			name: buildAuthUserDisplayName(row) || row.id,
			contractType: row.contractType,
			isActive: row.isActive,
			periods: periodsByEmployee.get(row.id) ?? [],
		}))
		.filter((entry) => entry.isActive || entry.periods.length > 0)
		.sort((left, right) => left.name.localeCompare(right.name));
}
