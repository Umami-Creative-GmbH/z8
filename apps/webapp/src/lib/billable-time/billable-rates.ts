import "server-only";

import { and, asc, desc, eq, gt, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { billableRate, customer, employee, project } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { Instant, PlainDate } from "@/lib/datetime/temporal-core";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import {
	type ApplicableRate,
	type BillableRatePeriod,
	isRateLevel,
	type RateLevel,
	resolveApplicableRate,
	workDayOf,
} from "./applicable-rate";
import { formatRate, parseRate, type RateUnits, rateFromStored } from "./money";
import { writeRatePeriodChange } from "./rate-period-writer";
import type { RatePeriod, RatePeriodStore } from "./rate-periods";
import { lockBillableTimeSettings } from "./settings";

/** One rate series: a rate level and its target. */
export type BillableRateTarget =
	| { level: "employee_project"; employeeId: string; projectId: string }
	| { level: "project"; projectId: string }
	| { level: "customer"; customerId: string }
	| { level: "employee"; employeeId: string };

export type BillableRateReader = Pick<Transaction, "select">;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads an untrusted target (from a server action) into a typed one, or null. */
export function parseBillableRateTarget(input: unknown): BillableRateTarget | null {
	if (typeof input !== "object" || input === null) return null;
	const value = input as Record<string, unknown>;
	const id = (key: string) =>
		typeof value[key] === "string" && UUID_PATTERN.test(value[key] as string)
			? (value[key] as string)
			: null;
	if (!isRateLevel(value.level)) return null;
	switch (value.level) {
		case "employee_project": {
			const employeeId = id("employeeId");
			const projectId = id("projectId");
			return employeeId && projectId ? { level: value.level, employeeId, projectId } : null;
		}
		case "project": {
			const projectId = id("projectId");
			return projectId ? { level: value.level, projectId } : null;
		}
		case "customer": {
			const customerId = id("customerId");
			return customerId ? { level: value.level, customerId } : null;
		}
		case "employee": {
			const employeeId = id("employeeId");
			return employeeId ? { level: value.level, employeeId } : null;
		}
	}
}

function targetColumns(target: BillableRateTarget) {
	return {
		employeeId: "employeeId" in target ? target.employeeId : null,
		projectId: "projectId" in target ? target.projectId : null,
		customerId: "customerId" in target ? target.customerId : null,
	};
}

function seriesCondition(organizationId: string, target: BillableRateTarget): SQL {
	const columns = targetColumns(target);
	const sameId = (
		column:
			| typeof billableRate.employeeId
			| typeof billableRate.projectId
			| typeof billableRate.customerId,
		value: string | null,
	) =>
		value === null ? isNull(column) : eq(column, value);
	return and(
		eq(billableRate.organizationId, organizationId),
		eq(billableRate.level, target.level),
		sameId(billableRate.employeeId, columns.employeeId),
		sameId(billableRate.projectId, columns.projectId),
		sameId(billableRate.customerId, columns.customerId),
	) as SQL;
}

function seriesKey(organizationId: string, target: BillableRateTarget): string {
	const columns = targetColumns(target);
	return [
		"billable_rate",
		organizationId,
		target.level,
		columns.employeeId ?? "",
		columns.projectId ?? "",
		columns.customerId ?? "",
	].join(":");
}

const plainDate = (value: string) => Temporal.PlainDate.from(value);

type BillableRateRow = typeof billableRate.$inferSelect;

function periodFromRow(row: BillableRateRow): BillableRatePeriod {
	if (!isRateLevel(row.level)) throw new Error(`Unknown rate level: ${row.level}`);
	return {
		id: row.id,
		level: row.level,
		employeeId: row.employeeId,
		projectId: row.projectId,
		customerId: row.customerId,
		from: plainDate(row.effectiveFrom),
		to: row.effectiveTo === null ? null : plainDate(row.effectiveTo),
		rate: rateFromStored(row.hourlyRate),
	};
}

function billableRateStore(
	tx: Transaction,
	input: { organizationId: string; target: BillableRateTarget; actorUserId: string },
): RatePeriodStore<RateUnits> {
	const inSeries = (id: string) =>
		and(eq(billableRate.id, id), seriesCondition(input.organizationId, input.target));
	return {
		async lockAndLoad(): Promise<RatePeriod<RateUnits>[]> {
			const rows = await tx
				.select()
				.from(billableRate)
				.where(seriesCondition(input.organizationId, input.target))
				.for("update");
			return rows.map((row) => {
				const period = periodFromRow(row);
				return { id: period.id, from: period.from, to: period.to, value: period.rate };
			});
		},
		async shorten(id, to) {
			await tx
				.update(billableRate)
				.set({ effectiveTo: to.toString(), updatedAt: sql`now()`, updatedBy: input.actorUserId })
				.where(inSeries(id));
		},
		async remove(id) {
			await tx.delete(billableRate).where(inSeries(id));
		},
		async updateValue(id, value) {
			await tx
				.update(billableRate)
				.set({ hourlyRate: formatRate(value), updatedAt: sql`now()`, updatedBy: input.actorUserId })
				.where(inSeries(id));
		},
		async insert(from, to, value) {
			const [row] = await tx
				.insert(billableRate)
				.values({
					organizationId: input.organizationId,
					level: input.target.level,
					...targetColumns(input.target),
					hourlyRate: formatRate(value),
					effectiveFrom: from.toString(),
					effectiveTo: to?.toString() ?? null,
					createdBy: input.actorUserId,
					updatedBy: input.actorUserId,
				})
				.returning({ id: billableRate.id });
			return row.id;
		},
	};
}

/** Whether the target of a series exists in the organization. */
async function targetExists(
	tx: Transaction,
	organizationId: string,
	target: BillableRateTarget,
): Promise<boolean> {
	const columns = targetColumns(target);
	if (columns.employeeId !== null) {
		const [row] = await tx
			.select({ id: employee.id })
			.from(employee)
			.where(and(eq(employee.id, columns.employeeId), eq(employee.organizationId, organizationId)))
			.limit(1);
		if (!row) return false;
	}
	if (columns.projectId !== null) {
		const [row] = await tx
			.select({ id: project.id })
			.from(project)
			.where(and(eq(project.id, columns.projectId), eq(project.organizationId, organizationId)))
			.limit(1);
		if (!row) return false;
	}
	if (columns.customerId !== null) {
		const [row] = await tx
			.select({ id: customer.id })
			.from(customer)
			.where(and(eq(customer.id, columns.customerId), eq(customer.organizationId, organizationId)))
			.limit(1);
		if (!row) return false;
	}
	return true;
}

export type BillableRateChange =
	| { kind: "set"; effectiveFrom: string; rate: string }
	| { kind: "end"; effectiveFrom: string };

export type BillableRateRefusal =
	/** The module is off (or was never switched on): rates are read-only. */
	"billable_time_off" | "target_not_found" | "invalid_rate" | "invalid_date";

export type BillableRateOutcome =
	| { ok: true; changed: boolean; periods: BillableRatePeriodView[] }
	| { ok: false; reason: BillableRateRefusal };

/** A rate period as the settings UI shows it (wire-safe). */
export interface BillableRatePeriodView {
	id: string;
	effectiveFrom: string;
	/** Exclusive; null while open. */
	effectiveTo: string | null;
	/** Two-decimal string in the billable currency. */
	hourlyRate: string;
}

function parseDate(value: string): PlainDate | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	try {
		return Temporal.PlainDate.from(value, { overflow: "reject" });
	} catch {
		return null;
	}
}

/**
 * Sets or ends a billable rate from a date, for one rate level and target of
 * one organization (#898). Backdating is allowed. The caller authorizes the
 * actor as an org admin of `organizationId` first.
 */
export async function changeBillableRate(
	database: typeof db,
	input: {
		organizationId: string;
		actorUserId: string;
		target: BillableRateTarget;
		change: BillableRateChange;
	},
): Promise<BillableRateOutcome> {
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
		if (!(await targetExists(tx, input.organizationId, input.target))) {
			return { ok: false, reason: "target_not_found" } as const;
		}

		const columns = targetColumns(input.target);
		const applied = await writeRatePeriodChange(tx, {
			seriesKey: seriesKey(input.organizationId, input.target),
			store: billableRateStore(tx, input),
			change: rate === null ? { kind: "end", from } : { kind: "set", from, value: rate },
			audit: {
				organizationId: input.organizationId,
				actorUserId: input.actorUserId,
				entityType: "billable_rate",
				actions: { set: AuditAction.BILLABLE_RATE_SET, end: AuditAction.BILLABLE_RATE_ENDED },
				employeeId: columns.employeeId,
				target: { level: input.target.level, ...columns, currency: settings.currency },
				describe: (value) => formatRate(value),
			},
		});

		return {
			ok: true,
			changed: applied.changed,
			periods: await listBillableRateHistory(tx, input.organizationId, input.target),
		} as const;
	});
}

/** One series' periods, newest first. */
export async function listBillableRateHistory(
	reader: BillableRateReader,
	organizationId: string,
	target: BillableRateTarget,
): Promise<BillableRatePeriodView[]> {
	const rows = await reader
		.select()
		.from(billableRate)
		.where(seriesCondition(organizationId, target))
		.orderBy(desc(billableRate.effectiveFrom));
	return rows.map((row) => ({
		id: row.id,
		effectiveFrom: row.effectiveFrom,
		effectiveTo: row.effectiveTo,
		hourlyRate: formatRate(rateFromStored(row.hourlyRate)),
	}));
}

/**
 * Every rate period that can apply to work of the given employees, projects and
 * customers, optionally only those in effect on some day of `[fromDay, toDay]`.
 * Set-based, for reports (#902) and hand-off (#903): pass the result to the
 * resolver or `priceWorkPeriod`.
 */
export async function listBillableRatesForWork(
	reader: BillableRateReader,
	organizationId: string,
	scope: {
		employeeIds: readonly string[];
		projectIds: readonly string[];
		customerIds: readonly string[];
		fromDay?: PlainDate;
		toDay?: PlainDate;
	},
): Promise<BillableRatePeriod[]> {
	const targets: SQL[] = [];
	if (scope.employeeIds.length > 0) {
		targets.push(inArray(billableRate.employeeId, [...scope.employeeIds]));
	}
	if (scope.projectIds.length > 0) {
		targets.push(inArray(billableRate.projectId, [...scope.projectIds]));
	}
	if (scope.customerIds.length > 0) {
		targets.push(inArray(billableRate.customerId, [...scope.customerIds]));
	}
	if (targets.length === 0) return [];

	const conditions: (SQL | undefined)[] = [
		eq(billableRate.organizationId, organizationId),
		or(...targets),
	];
	if (scope.toDay) {
		conditions.push(lt(billableRate.effectiveFrom, scope.toDay.add({ days: 1 }).toString()));
	}
	if (scope.fromDay) {
		conditions.push(
			or(isNull(billableRate.effectiveTo), gt(billableRate.effectiveTo, scope.fromDay.toString())),
		);
	}
	const rows = await reader
		.select()
		.from(billableRate)
		.where(and(...conditions))
		.orderBy(asc(billableRate.effectiveFrom));
	return rows.map(periodFromRow);
}

/**
 * The applicable rate of one piece of work, read now (Billable Time ADR 0001):
 * the project's current customer, then the winning level's rate in effect on
 * the employee-local day the work started.
 */
export async function getApplicableRate(
	reader: BillableRateReader,
	organizationId: string,
	work: {
		employeeId: string;
		projectId: string | null;
		startedAt: Instant;
		startOffsetMinutes: number;
	},
): Promise<ApplicableRate> {
	let customerId: string | null = null;
	if (work.projectId !== null) {
		const [row] = await reader
			.select({ customerId: project.customerId })
			.from(project)
			.where(and(eq(project.id, work.projectId), eq(project.organizationId, organizationId)))
			.limit(1);
		if (!row) return { kind: "unpriced" };
		customerId = row.customerId;
	}
	const day = workDayOf(work.startedAt, work.startOffsetMinutes);
	const rates = await listBillableRatesForWork(reader, organizationId, {
		employeeIds: [work.employeeId],
		projectIds: work.projectId === null ? [] : [work.projectId],
		customerIds: customerId === null ? [] : [customerId],
		fromDay: day,
		toDay: day,
	});
	return resolveApplicableRate({ ...work, customerId }, rates);
}

/** A rate series with its current or next rate, for the settings overview. */
export interface BillableRateSeriesSummary {
	level: RateLevel;
	employeeId: string | null;
	projectId: string | null;
	customerId: string | null;
	employeeName: string | null;
	projectName: string | null;
	customerName: string | null;
	/** The rate in effect today, or null. */
	current: BillableRatePeriodView | null;
	/** The latest period of the series. */
	latest: BillableRatePeriodView;
}

/** Every rate series of an organization, with the rate in effect on `today`. */
export async function listBillableRateSeries(
	reader: BillableRateReader,
	organizationId: string,
	today: PlainDate,
): Promise<BillableRateSeriesSummary[]> {
	const rows = await reader
		.select({
			rate: billableRate,
			employeeFirstName: employee.firstName,
			employeeLastName: employee.lastName,
			userName: user.name,
			projectName: project.name,
			customerName: customer.name,
		})
		.from(billableRate)
		.leftJoin(
			employee,
			and(
				eq(employee.id, billableRate.employeeId),
				eq(employee.organizationId, billableRate.organizationId),
			),
		)
		.leftJoin(user, eq(user.id, employee.userId))
		.leftJoin(
			project,
			and(
				eq(project.id, billableRate.projectId),
				eq(project.organizationId, billableRate.organizationId),
			),
		)
		.leftJoin(
			customer,
			and(
				eq(customer.id, billableRate.customerId),
				eq(customer.organizationId, billableRate.organizationId),
			),
		)
		.where(eq(billableRate.organizationId, organizationId))
		.orderBy(asc(billableRate.effectiveFrom));

	const series = new Map<string, BillableRateSeriesSummary>();
	for (const row of rows) {
		const period = row.rate;
		if (!isRateLevel(period.level)) continue;
		const view: BillableRatePeriodView = {
			id: period.id,
			effectiveFrom: period.effectiveFrom,
			effectiveTo: period.effectiveTo,
			hourlyRate: formatRate(rateFromStored(period.hourlyRate)),
		};
		const key = [period.level, period.employeeId, period.projectId, period.customerId].join(":");
		const inEffect =
			Temporal.PlainDate.compare(plainDate(period.effectiveFrom), today) <= 0 &&
			(period.effectiveTo === null ||
				Temporal.PlainDate.compare(today, plainDate(period.effectiveTo)) < 0);
		const existing = series.get(key);
		if (existing) {
			existing.latest = view;
			if (inEffect) existing.current = view;
			continue;
		}
		const employeeName = [row.employeeFirstName, row.employeeLastName].filter(Boolean).join(" ");
		series.set(key, {
			level: period.level,
			employeeId: period.employeeId,
			projectId: period.projectId,
			customerId: period.customerId,
			employeeName: period.employeeId ? employeeName || row.userName || null : null,
			projectName: row.projectName,
			customerName: row.customerName,
			current: inEffect ? view : null,
			latest: view,
		});
	}
	return [...series.values()];
}
