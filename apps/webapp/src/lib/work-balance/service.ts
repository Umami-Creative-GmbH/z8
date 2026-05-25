import { and, asc, eq, gte, isNotNull, isNull, lt, lte, min, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, employeeWorkBalance, employeeWorkBalancePeriod, workPeriod } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import {
	computeEmployeePeriodBalance,
	markEmployeeWorkBalanceFullRebuildRequested,
	rebuildEmployeeYearBalanceFromMonths,
	upsertEmployeeWorkBalancePeriod,
} from "./period-aggregation";
import { getHotWindowRange, getMonthPeriodsBetween } from "./periods";
import type { EmployeeWorkBalancePayload } from "./types";

export function buildWorkBalanceValues(input: {
	employeeId: string;
	organizationId: string;
	actualMinutes: number;
	requiredMinutes: number;
	computedFromDate: string;
	computedThroughDate: string;
	computedAt: Date;
}) {
	return {
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		actualMinutes: input.actualMinutes,
		requiredMinutes: input.requiredMinutes,
		balanceMinutes: input.actualMinutes - input.requiredMinutes,
		computedFromDate: input.computedFromDate,
		computedThroughDate: input.computedThroughDate,
		computedAt: input.computedAt,
		isDirty: false,
		dirtyFromDate: null,
		refreshRequestedAt: null,
		lastError: null,
		updatedAt: input.computedAt,
	};
}

export function buildEmptyWorkBalanceValues(input: {
	employeeId: string;
	organizationId: string;
	computedAt: Date;
}) {
	const todayDate = getWorkBalanceBatchCutoffDate(input.computedAt);

	return buildWorkBalanceValues({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		actualMinutes: 0,
		requiredMinutes: 0,
		computedFromDate: todayDate,
		computedThroughDate: todayDate,
		computedAt: input.computedAt,
	});
}

export function getWorkBalanceBatchCutoffDate(now = new Date()): string {
	return DateTime.fromJSDate(now, { zone: "utc" }).toISODate()!;
}

export function shouldIncludeWorkBalanceInBatch(
	balance: { isDirty: boolean; computedThroughDate: string } | null,
	todayDate: string,
): boolean {
	return !balance || balance.isDirty || balance.computedThroughDate < todayDate;
}

export async function getEmployeeWorkBalance(input: {
	employeeId: string;
	organizationId: string;
}): Promise<EmployeeWorkBalancePayload | null> {
	const row = await db.query.employeeWorkBalance.findFirst({
		where: and(
			eq(employeeWorkBalance.employeeId, input.employeeId),
			eq(employeeWorkBalance.organizationId, input.organizationId),
		),
	});

	if (!row) return null;

	return {
		employeeId: row.employeeId,
		organizationId: row.organizationId,
		actualMinutes: row.actualMinutes,
		requiredMinutes: row.requiredMinutes,
		balanceMinutes: row.balanceMinutes,
		computedFromDate: row.computedFromDate,
		computedThroughDate: row.computedThroughDate,
		computedAt: row.computedAt,
	};
}

async function getFirstRelevantDate(input: {
	employeeId: string;
	organizationId: string;
}): Promise<string | null> {
	const scopedEmployee = await db.query.employee.findFirst({
		where: and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		columns: { id: true },
	});
	if (!scopedEmployee) return null;

	const [firstWorkPeriod] = await db
		.select({ value: min(workPeriod.startTime) })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.organizationId, input.organizationId),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
			),
		);

	const workDate = firstWorkPeriod?.value
		? DateTime.fromJSDate(firstWorkPeriod.value, { zone: "utc" }).toISODate()
		: null;

	return workDate;
}

async function getActualMinutes(input: {
	employeeId: string;
	organizationId: string;
	startDate: Date;
	endDate: Date;
}): Promise<number> {
	const [row] = await db
		.select({ totalMinutes: sql<number>`coalesce(sum(${workPeriod.durationMinutes}), 0)` })
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.organizationId, input.organizationId),
				isNotNull(workPeriod.endTime),
				isNotNull(workPeriod.durationMinutes),
				gte(workPeriod.startTime, input.startDate),
				lte(workPeriod.startTime, input.endDate),
			),
		);

	return Number(row?.totalMinutes ?? 0);
}

export async function computeEmployeeWorkBalance(input: {
	employeeId: string;
	organizationId: string;
	now?: Date;
}) {
	const firstDate = await getFirstRelevantDate(input);
	if (!firstDate) return null;

	const through = DateTime.fromJSDate(input.now ?? new Date(), { zone: "utc" }).startOf("day");
	const start = DateTime.fromISO(firstDate, { zone: "utc" }).startOf("day");
	const startDate = start.toJSDate();
	const endDate = through.endOf("day").toJSDate();

	const [actualMinutes, requirements] = await Promise.all([
		getActualMinutes({ ...input, startDate, endDate }),
		getDailyWorkRequirementsForEmployee({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			startDate,
			endDate,
		}),
	]);

	const requiredMinutes = Object.values(requirements).reduce(
		(total, requirement) => total + requirement.requiredMinutes,
		0,
	);

	return buildWorkBalanceValues({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		actualMinutes,
		requiredMinutes,
		computedFromDate: start.toISODate()!,
		computedThroughDate: through.toISODate()!,
		computedAt: input.now ?? new Date(),
	});
}

async function sumClosedMonthlyPeriodTotalsBefore(input: {
	employeeId: string;
	organizationId: string;
	beforeDate: string;
}) {
	const [row] = await db
		.select({
			actualMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.actualMinutes}), 0)`,
			requiredMinutes: sql<number>`coalesce(sum(${employeeWorkBalancePeriod.requiredMinutes}), 0)`,
			firstPeriodStart: min(employeeWorkBalancePeriod.periodStart),
		})
		.from(employeeWorkBalancePeriod)
		.where(
			and(
				eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
				eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
				eq(employeeWorkBalancePeriod.periodType, "month"),
				eq(employeeWorkBalancePeriod.isClosed, true),
				lt(employeeWorkBalancePeriod.periodStart, input.beforeDate),
			),
		);

	return {
		actualMinutes: Number(row?.actualMinutes ?? 0),
		requiredMinutes: Number(row?.requiredMinutes ?? 0),
		firstPeriodStart: row?.firstPeriodStart ?? null,
	};
}

export async function refreshEmployeeWorkBalanceFromPeriods(input: {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string | null;
	forceFullRebuild?: boolean;
	now?: Date;
}) {
	const now = input.now ?? new Date();
	const hotWindow = getHotWindowRange(now);
	const fullRebuildStartDate = input.forceFullRebuild ? await getFirstRelevantDate(input) : null;
	const affectedStartDate = fullRebuildStartDate ?? input.dirtyFromDate ?? hotWindow.startDate;
	const closedMonthEnd = DateTime.fromISO(hotWindow.startDate, { zone: "utc" })
		.minus({ days: 1 })
		.toISODate()!;

	if (affectedStartDate < hotWindow.startDate) {
		const touchedYears = new Set<string>();
		const months = getMonthPeriodsBetween(affectedStartDate, closedMonthEnd);
		for (const month of months) {
			const values = await computeEmployeePeriodBalance({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				periodType: "month",
				periodStart: month.periodStart,
				periodEnd: month.periodEnd,
				isClosed: true,
				now,
			});
			await upsertEmployeeWorkBalancePeriod(values, { refreshStartedAt: now });
			touchedYears.add(month.periodStart.slice(0, 4));
		}

		for (const year of touchedYears) {
			await rebuildEmployeeYearBalanceFromMonths({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				dateInYear: `${year}-01-01`,
				now,
			});
		}
	}

	const hotWindowValues = await computeEmployeePeriodBalance({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		periodType: "month",
		periodStart: hotWindow.startDate,
		periodEnd: hotWindow.endDate,
		isClosed: false,
		now,
	});
	const closedTotals = await sumClosedMonthlyPeriodTotalsBefore({
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		beforeDate: hotWindow.startDate,
	});

	await upsertEmployeeWorkBalance(
		buildWorkBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: closedTotals.actualMinutes + hotWindowValues.actualMinutes,
			requiredMinutes: closedTotals.requiredMinutes + hotWindowValues.requiredMinutes,
			computedFromDate: closedTotals.firstPeriodStart ?? hotWindow.startDate,
			computedThroughDate: hotWindow.endDate,
			computedAt: now,
		}),
		{ refreshStartedAt: now },
	);

	return { updated: true };
}

export async function upsertEmployeeWorkBalance(
	values: ReturnType<typeof buildWorkBalanceValues>,
	options?: { refreshStartedAt?: Date },
) {
	const refreshStartedAt = options?.refreshStartedAt ?? values.computedAt;
	await db
		.insert(employeeWorkBalance)
		.values(values)
		.onConflictDoUpdate({
			target: [employeeWorkBalance.organizationId, employeeWorkBalance.employeeId],
			set: {
				actualMinutes: values.actualMinutes,
				requiredMinutes: values.requiredMinutes,
				balanceMinutes: values.balanceMinutes,
				computedFromDate: values.computedFromDate,
				computedThroughDate: values.computedThroughDate,
				computedAt: values.computedAt,
				isDirty: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then true else false end`,
				dirtyFromDate: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.dirtyFromDate} else null end`,
				refreshRequestedAt: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.refreshRequestedAt} else null end`,
				lastError: null,
				updatedAt: values.updatedAt,
			},
		});
}

export async function markEmployeeWorkBalanceDirty(input: {
	employeeId: string;
	organizationId: string;
	dirtyFromDate?: string;
}) {
	const requestedAt = new Date();
	const dirtyFromDate = input.dirtyFromDate ?? null;
	await db
		.insert(employeeWorkBalance)
		.values({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
			computedFromDate: dirtyFromDate ?? "1970-01-01",
			computedThroughDate: dirtyFromDate ?? "1970-01-01",
			computedAt: requestedAt,
			isDirty: true,
			dirtyFromDate,
			refreshRequestedAt: requestedAt,
			updatedAt: requestedAt,
		})
		.onConflictDoUpdate({
			target: [employeeWorkBalance.organizationId, employeeWorkBalance.employeeId],
			set: {
				isDirty: true,
				dirtyFromDate: dirtyFromDate
					? sql`case when ${employeeWorkBalance.isDirty} = true and ${employeeWorkBalance.dirtyFromDate} is null then null when ${employeeWorkBalance.dirtyFromDate} is null or ${employeeWorkBalance.dirtyFromDate} > ${dirtyFromDate} then ${dirtyFromDate} else ${employeeWorkBalance.dirtyFromDate} end`
					: sql`${employeeWorkBalance.dirtyFromDate}`,
				refreshRequestedAt: requestedAt,
				updatedAt: requestedAt,
			},
		});
}

export async function markOrganizationWorkBalancesDirty(input: { organizationId: string }) {
	const requestedAt = new Date();
	await db
		.update(employeeWorkBalance)
		.set({
			isDirty: true,
			refreshRequestedAt: requestedAt,
			updatedAt: requestedAt,
		})
		.where(eq(employeeWorkBalance.organizationId, input.organizationId));
}

export async function markEmployeeWorkBalanceFailed(input: {
	employeeId: string;
	organizationId: string;
	error: string;
}) {
	await db
		.update(employeeWorkBalance)
		.set({ lastError: input.error, updatedAt: new Date() })
		.where(
			and(
				eq(employeeWorkBalance.employeeId, input.employeeId),
				eq(employeeWorkBalance.organizationId, input.organizationId),
			),
		);
}

export async function requestEmployeeWorkBalanceFullRebuild(input: {
	employeeId: string;
	organizationId: string;
}) {
	await markEmployeeWorkBalanceFullRebuildRequested(input);
}

export async function deleteEmployeeWorkBalance(input: {
	employeeId: string;
	organizationId: string;
}) {
	await db
		.delete(employeeWorkBalance)
		.where(
			and(
				eq(employeeWorkBalance.employeeId, input.employeeId),
				eq(employeeWorkBalance.organizationId, input.organizationId),
			),
		);
}

export async function listEmployeesForWorkBalanceBatch(limit = 1000, now = new Date()) {
	const todayDate = getWorkBalanceBatchCutoffDate(now);

	return db
		.select({
			id: employee.id,
			organizationId: employee.organizationId,
			isDirty: employeeWorkBalance.isDirty,
			dirtyFromDate: employeeWorkBalance.dirtyFromDate,
			refreshRequestedAt: employeeWorkBalance.refreshRequestedAt,
		})
		.from(employee)
		.leftJoin(
			employeeWorkBalance,
			and(
				eq(employeeWorkBalance.employeeId, employee.id),
				eq(employeeWorkBalance.organizationId, employee.organizationId),
			),
		)
		.where(
			and(
				eq(employee.isActive, true),
				isNotNull(employee.organizationId),
				or(
					isNull(employeeWorkBalance.id),
					eq(employeeWorkBalance.isDirty, true),
					lt(employeeWorkBalance.computedThroughDate, todayDate),
				),
			),
		)
		.orderBy(asc(employeeWorkBalance.refreshRequestedAt), asc(employee.id))
		.limit(limit);
}
