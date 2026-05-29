import { and, asc, eq, gte, isNotNull, isNull, lt, lte, min, or, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { employee, employeeWorkBalance, employeeWorkBalancePeriod, workPeriod } from "@/db/schema";
import { getDailyWorkRequirementsForEmployee } from "@/lib/calendar/work-policy-requirements";
import {
	computeEmployeePeriodBalance,
	rebuildEmployeeYearBalanceFromMonths,
	upsertEmployeeWorkBalancePeriod,
} from "./period-aggregation";
import { getHotWindowRange, getMonthPeriodsBetween } from "./periods";
import type { EmployeeWorkBalancePayload } from "./types";

const WORK_BALANCE_RESET_MARKER_DATE = "0001-01-01";

type WorkBalanceDbClient = Pick<typeof db, "delete" | "execute" | "insert" | "query" | "select">;

function isEmployeeWorkBalanceResetMarker(row: {
	computedFromDate: string;
	computedThroughDate: string;
	isDirty: boolean;
	dirtyFromDate: string | null;
	refreshRequestedAt: Date | null;
}) {
	return (
		row.computedFromDate === WORK_BALANCE_RESET_MARKER_DATE &&
		row.computedThroughDate === WORK_BALANCE_RESET_MARKER_DATE &&
		row.isDirty === true &&
		row.dirtyFromDate === null &&
		row.refreshRequestedAt !== null
	);
}

async function withEmployeeWorkBalanceLock<T>(
	input: { employeeId: string; organizationId: string },
	callback: (dbClient: WorkBalanceDbClient) => Promise<T>,
) {
	const lockKey = `work-balance:${input.organizationId}:${input.employeeId}`;
	return db.transaction(async (tx) => {
		const dbClient = tx as WorkBalanceDbClient;
		await dbClient.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
		return callback(dbClient);
	});
}

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

function toUtcIsoDate(value: Date | string | null | undefined) {
	if (!value) return null;
	const date =
		value instanceof Date
			? DateTime.fromJSDate(value, { zone: "utc" })
			: DateTime.fromISO(value, { zone: "utc" });
	return date.isValid ? date.toISODate() : null;
}

function maxIsoDate(left: string, right: string) {
	return left > right ? left : right;
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
	if (
		isEmployeeWorkBalanceResetMarker({
			computedFromDate: row.computedFromDate,
			computedThroughDate: row.computedThroughDate,
			isDirty: row.isDirty,
			dirtyFromDate: row.dirtyFromDate,
			refreshRequestedAt: row.refreshRequestedAt,
		})
	) {
		return null;
	}

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

async function getFirstRelevantDate(
	input: {
		employeeId: string;
		organizationId: string;
	},
	dbClient: WorkBalanceDbClient = db,
): Promise<string | null> {
	const scopedEmployee = await dbClient.query.employee.findFirst({
		where: and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		columns: { id: true, startDate: true },
	});
	if (!scopedEmployee) return null;

	const employeeStartDate = toUtcIsoDate(scopedEmployee.startDate);
	if (employeeStartDate) return employeeStartDate;

	const [firstWorkPeriod] = await dbClient
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

async function getEmployeeStartDate(
	input: {
		employeeId: string;
		organizationId: string;
	},
	dbClient: WorkBalanceDbClient = db,
): Promise<string | null> {
	const scopedEmployee = await dbClient.query.employee.findFirst({
		where: and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
		columns: { id: true, startDate: true },
	});
	if (!scopedEmployee) return null;

	return toUtcIsoDate(scopedEmployee.startDate);
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
	if (start > through) {
		const throughDate = through.toISODate()!;
		return buildWorkBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: 0,
			requiredMinutes: 0,
			computedFromDate: throughDate,
			computedThroughDate: throughDate,
			computedAt: input.now ?? new Date(),
		});
	}
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

async function sumClosedMonthlyPeriodTotalsBefore(
	input: {
		employeeId: string;
		organizationId: string;
		beforeDate: string;
		fromDate?: string | null;
	},
	dbClient: WorkBalanceDbClient = db,
) {
	const [row] = await dbClient
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
				...(input.fromDate ? [gte(employeeWorkBalancePeriod.periodEnd, input.fromDate)] : []),
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
	return withEmployeeWorkBalanceLock(input, (dbClient) =>
		refreshEmployeeWorkBalanceFromPeriodsLocked(input, dbClient),
	);
}

async function refreshEmployeeWorkBalanceFromPeriodsLocked(
	input: {
		employeeId: string;
		organizationId: string;
		dirtyFromDate?: string | null;
		forceFullRebuild?: boolean;
		now?: Date;
	},
	dbClient: WorkBalanceDbClient,
) {
	const now = input.now ?? new Date();
	const currentBalance = await dbClient.query.employeeWorkBalance.findFirst({
		where: and(
			eq(employeeWorkBalance.employeeId, input.employeeId),
			eq(employeeWorkBalance.organizationId, input.organizationId),
		),
	});
	const forceFullRebuild =
		input.forceFullRebuild === true ||
		!currentBalance ||
		isEmployeeWorkBalanceResetMarker({
			computedFromDate: currentBalance.computedFromDate,
			computedThroughDate: currentBalance.computedThroughDate,
			isDirty: currentBalance.isDirty,
			dirtyFromDate: currentBalance.dirtyFromDate,
			refreshRequestedAt: currentBalance.refreshRequestedAt,
		});
	const hotWindow = getHotWindowRange(now);
	const fullRebuildStartDate = forceFullRebuild ? await getFirstRelevantDate(input, dbClient) : null;
	const employeeStartDate = forceFullRebuild
		? null
		: await getEmployeeStartDate(input, dbClient);
	const calculationStartDate = employeeStartDate ?? fullRebuildStartDate;
	if (calculationStartDate && calculationStartDate > hotWindow.endDate) {
		await dbClient.delete(employeeWorkBalancePeriod).where(
			and(
				eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
				eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
			),
		);
		await upsertEmployeeWorkBalance(
			buildWorkBalanceValues({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				actualMinutes: 0,
				requiredMinutes: 0,
				computedFromDate: hotWindow.endDate,
				computedThroughDate: hotWindow.endDate,
				computedAt: now,
			}),
			{ dbClient, refreshStartedAt: now },
		);
		return { updated: true };
	}
	const requestedStartDate = fullRebuildStartDate ?? input.dirtyFromDate ?? hotWindow.startDate;
	const affectedStartDate = calculationStartDate
		? maxIsoDate(requestedStartDate, calculationStartDate)
		: requestedStartDate;
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
				dbClient,
				periodType: "month",
				periodStart: month.periodStart,
				periodEnd: month.periodEnd,
				calculationStartDate,
				isClosed: true,
				now,
			});
			await upsertEmployeeWorkBalancePeriod(values, { dbClient, refreshStartedAt: now });
			touchedYears.add(month.periodStart.slice(0, 4));
		}

		for (const year of touchedYears) {
			await rebuildEmployeeYearBalanceFromMonths({
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				dbClient,
				dateInYear: `${year}-01-01`,
				calculationStartDate,
				now,
			});
		}
	}

	const [hotWindowValues, closedTotals] = await Promise.all([
		computeEmployeePeriodBalance({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			dbClient,
			periodType: "month",
			periodStart: hotWindow.startDate,
			periodEnd: hotWindow.endDate,
			calculationStartDate,
			isClosed: false,
			now,
		}),
		sumClosedMonthlyPeriodTotalsBefore(
			{
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				beforeDate: hotWindow.startDate,
				fromDate: calculationStartDate,
			},
			dbClient,
		),
	]);

	await upsertEmployeeWorkBalance(
		buildWorkBalanceValues({
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: closedTotals.actualMinutes + hotWindowValues.actualMinutes,
			requiredMinutes: closedTotals.requiredMinutes + hotWindowValues.requiredMinutes,
			computedFromDate: calculationStartDate ?? closedTotals.firstPeriodStart ?? hotWindow.startDate,
			computedThroughDate: hotWindow.endDate,
			computedAt: now,
		}),
		{ dbClient, refreshStartedAt: now },
	);

	return { updated: true };
}

export async function upsertEmployeeWorkBalance(
	values: ReturnType<typeof buildWorkBalanceValues>,
	options?: { dbClient?: WorkBalanceDbClient; refreshStartedAt?: Date },
) {
	const dbClient = options?.dbClient ?? db;
	const refreshStartedAt = options?.refreshStartedAt ?? values.computedAt;
	await dbClient
		.insert(employeeWorkBalance)
		.values(values)
		.onConflictDoUpdate({
			target: [employeeWorkBalance.organizationId, employeeWorkBalance.employeeId],
			set: {
				actualMinutes: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.actualMinutes} else ${values.actualMinutes} end`,
				requiredMinutes: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.requiredMinutes} else ${values.requiredMinutes} end`,
				balanceMinutes: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.balanceMinutes} else ${values.balanceMinutes} end`,
				computedFromDate: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.computedFromDate} else ${values.computedFromDate} end`,
				computedThroughDate: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.computedThroughDate} else ${values.computedThroughDate} end`,
				computedAt: sql`case when ${employeeWorkBalance.refreshRequestedAt} is not null and ${employeeWorkBalance.refreshRequestedAt} > ${refreshStartedAt} then ${employeeWorkBalance.computedAt} else ${values.computedAt} end`,
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
	await withEmployeeWorkBalanceLock(input, async (tx) => {
		const requestedAt = new Date();
		const markerValues = {
			employeeId: input.employeeId,
			organizationId: input.organizationId,
			actualMinutes: 0,
			requiredMinutes: 0,
			balanceMinutes: 0,
			computedFromDate: WORK_BALANCE_RESET_MARKER_DATE,
			computedThroughDate: WORK_BALANCE_RESET_MARKER_DATE,
			computedAt: requestedAt,
			isDirty: true,
			dirtyFromDate: null,
			refreshRequestedAt: requestedAt,
			lastError: null,
			updatedAt: requestedAt,
		};

		await tx
			.delete(employeeWorkBalancePeriod)
			.where(
				and(
					eq(employeeWorkBalancePeriod.employeeId, input.employeeId),
					eq(employeeWorkBalancePeriod.organizationId, input.organizationId),
				),
			);

		await tx
			.insert(employeeWorkBalance)
			.values(markerValues)
			.onConflictDoUpdate({
				target: [employeeWorkBalance.organizationId, employeeWorkBalance.employeeId],
				set: {
					actualMinutes: markerValues.actualMinutes,
					requiredMinutes: markerValues.requiredMinutes,
					balanceMinutes: markerValues.balanceMinutes,
					computedFromDate: markerValues.computedFromDate,
					computedThroughDate: markerValues.computedThroughDate,
					computedAt: markerValues.computedAt,
					isDirty: markerValues.isDirty,
					dirtyFromDate: markerValues.dirtyFromDate,
					refreshRequestedAt: markerValues.refreshRequestedAt,
					lastError: markerValues.lastError,
					updatedAt: markerValues.updatedAt,
				},
			});
	});
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
			balanceId: employeeWorkBalance.id,
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
