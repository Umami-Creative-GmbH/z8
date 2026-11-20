import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { employee } from "@/db/schema";
import { getAssignedHolidaysForEmployees } from "@/lib/calendar/assigned-holidays";
import {
	loadDailyWorkRequirementsForEmployees,
	type RequirementEmployee,
} from "@/lib/calendar/work-policy-range-requirements";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { runtime } from "@/lib/effect/runtime";
import { listDepartedEmployeesCoveredForExport } from "@/lib/payroll-access/adjustment-coverage";
import {
	intersectPayrollScope,
	resolvePayrollAccessibleEmployeeIds,
} from "@/lib/payroll-access/permissions";
import { loadEmployeeTrackingContexts } from "@/lib/time-tracking/tracking-start";
import { loadPeriodSources } from "./legacy-sources";
import { buildPayrollPeriodRead } from "./period-read";
import { loadActiveSettledDays } from "./settled-days-store";
import type {
	PayrollPeriodActor,
	PayrollPeriodHolidaySource,
	PayrollPeriodRange,
	PayrollPeriodRead,
	PayrollPeriodScope,
} from "./types";

/** Requirement reads run per employee batch, as the analytics range reader does. */
const REQUIREMENT_BATCH_SIZE = 64;
/** Widest zone offsets: every employee-local period day lies inside this widened UTC range. */
const MAX_ZONE_OFFSET_HOURS = 14;

/**
 * The payroll period read model (#1891): for each employee in the actor's payroll
 * access grant scope, one entry per local day with credited minutes, required minutes,
 * the difference, absences and holidays, plus totals, the absence list, blockers and the
 * Overview summary built from the same rows.
 *
 * `scope.employeeIds` narrows the grant's scope and never widens it. Employees of the
 * grant who left during or after the period are read when they have data in it, with
 * their last working day (#1894). Every read is filtered by `organizationId`; an actor
 * without an active grant in the organization reads nobody.
 */
export async function readPeriod(
	organizationId: string,
	actor: PayrollPeriodActor,
	period: PayrollPeriodRange,
	scope: PayrollPeriodScope = {},
): Promise<PayrollPeriodRead> {
	return readPeriodForEmployees(organizationId, actor, period, {
		employeeIds: await resolvePeriodEmployeeIds(organizationId, actor, period.startDate, scope),
	});
}

/** The grant holder resolving a scope; a caller that knows their user saves a lookup. */
type ScopeActor = Pick<PayrollPeriodActor, "employeeId"> & { userId?: string };

/**
 * Which of the grant's employees who left a scope covers (#1894): those who left after
 * the start of a period's first day, or everyone who left, whenever (the settlement
 * records of a day the grant could settle stay reachable).
 */
export type DepartedEmployees = { leftAfterStartOf: string } | { anyDeparture: true };

/**
 * The employees a payroll period read covers: the actor's payroll access grant scope,
 * plus the grant's employees who left during or after the period (#1894), as the
 * payroll export covers them. `scope.employeeIds` narrows it and never widens it.
 */
export async function resolvePeriodEmployeeIds(
	organizationId: string,
	actor: ScopeActor,
	startDate: string,
	scope: PayrollPeriodScope = {},
): Promise<string[]> {
	return resolveGrantEmployeeIds(organizationId, actor, { leftAfterStartOf: startDate }, scope);
}

/** The grant's scope plus the employees who left that `departed` names, narrowed by `scope`. */
export async function resolveGrantEmployeeIds(
	organizationId: string,
	actor: ScopeActor,
	departed: DepartedEmployees,
	scope: PayrollPeriodScope = {},
): Promise<string[]> {
	const [allowedEmployeeIds, departedEmployeeIds] = await Promise.all([
		resolvePayrollAccessibleEmployeeIds({
			organizationId,
			payrollEmployeeId: actor.employeeId,
		}),
		listDepartedGrantEmployees(organizationId, actor, departed),
	]);
	return intersectPayrollScope({
		allowedEmployeeIds: [...allowedEmployeeIds, ...departedEmployeeIds],
		requestedEmployeeIds: scope.employeeIds ? [...scope.employeeIds] : undefined,
	});
}

/**
 * The grant's employees who left that `departed` names (#1894): the one source of the
 * employees who left that payroll period reads, settling, workspace actions and exports
 * cover.
 */
export async function listDepartedGrantEmployees(
	organizationId: string,
	actor: ScopeActor,
	departed: DepartedEmployees,
): Promise<string[]> {
	const { db } = await import("@/db");
	let actorUserId = actor.userId;
	if (!actorUserId) {
		const [row] = await db
			.select({ userId: employee.userId })
			.from(employee)
			.where(and(eq(employee.organizationId, organizationId), eq(employee.id, actor.employeeId)))
			.limit(1);
		if (!row) return [];
		actorUserId = row.userId;
	}
	return listDepartedEmployeesCoveredForExport(db, {
		organizationId,
		actorUserId,
		fromDate:
			"leftAfterStartOf" in departed ? parsePlainDate(departed.leftAfterStartOf).toString() : null,
	});
}

/** `readPeriod` for employees already resolved through the payroll access grant. */
export async function readPeriodForEmployees(
	organizationId: string,
	actor: PayrollPeriodActor,
	period: PayrollPeriodRange,
	scope: { employeeIds: readonly string[] },
): Promise<PayrollPeriodRead> {
	const { period: payrollPeriod, sources } = await loadPeriodSources(
		organizationId,
		scope.employeeIds,
		period,
	);
	const employeeIds = sources.employees.map((row) => row.id);
	const [requirements, holidays, settledDays] = await Promise.all([
		loadRequirements(organizationId, employeeIds, period),
		loadHolidays(organizationId, employeeIds, period),
		loadSettledDays(organizationId, employeeIds, period),
	]);

	return buildPayrollPeriodRead({
		organizationId,
		period: payrollPeriod,
		generatedAt: Temporal.Now.instant(),
		generatedBy: { id: actor.employeeId, name: actor.name },
		sources: { ...sources, requirements, holidays, settledDays },
	});
}

async function loadSettledDays(
	organizationId: string,
	employeeIds: readonly string[],
	period: PayrollPeriodRange,
) {
	const { db } = await import("@/db");
	return loadActiveSettledDays(db, {
		organizationId,
		employeeIds,
		startDate: period.startDate,
		endDate: period.endDate,
	});
}

async function loadRequirements(
	organizationId: string,
	employeeIds: readonly string[],
	period: PayrollPeriodRange,
): Promise<Map<string, Record<string, { requiredMinutes: number }>>> {
	const result = new Map<string, Record<string, { requiredMinutes: number }>>();
	if (employeeIds.length === 0) return result;
	const { db } = await import("@/db");
	// Requirement keys are each employee's local dates; the builder picks the period's.
	const startDate = dateFromInstant(
		localDayRange(period.startDate, "UTC").start.subtract({ hours: MAX_ZONE_OFFSET_HOURS }),
	);
	const endDate = dateFromInstant(
		localDayRange(period.endDate, "UTC")
			.endExclusive.add({ hours: MAX_ZONE_OFFSET_HOURS })
			.subtract({ milliseconds: 1 }),
	);

	for (let offset = 0; offset < employeeIds.length; offset += REQUIREMENT_BATCH_SIZE) {
		const batch = employeeIds.slice(offset, offset + REQUIREMENT_BATCH_SIZE);
		const [people, trackingByEmployee] = await Promise.all([
			db.query.employee.findMany({
				where: and(eq(employee.organizationId, organizationId), inArray(employee.id, batch)),
				columns: {
					id: true,
					organizationId: true,
					teamId: true,
					startDate: true,
					contractType: true,
				},
				with: {
					user: { columns: { createdAt: true } },
					userSettings: { columns: { timezone: true } },
					organization: { columns: { timezone: true } },
				},
			}),
			loadEmployeeTrackingContexts(db, { organizationId, employeeIds: batch }),
		]);
		const loaded = await runtime.runPromise(
			loadDailyWorkRequirementsForEmployees({
				organizationId,
				employees: people satisfies readonly RequirementEmployee[],
				startDate,
				endDate,
				trackingByEmployee,
			}),
		);
		for (const [employeeId, days] of loaded.requirements) {
			result.set(
				employeeId,
				Object.fromEntries(
					Object.entries(days).map(([date, day]) => [
						date,
						{ requiredMinutes: day.requiredMinutes },
					]),
				),
			);
		}
	}
	return result;
}

async function loadHolidays(
	organizationId: string,
	employeeIds: readonly string[],
	period: PayrollPeriodRange,
): Promise<Map<string, PayrollPeriodHolidaySource[]>> {
	if (employeeIds.length === 0) return new Map();
	const { db } = await import("@/db");
	const people = await db
		.select({
			id: employee.id,
			organizationId: employee.organizationId,
			teamId: employee.teamId,
		})
		.from(employee)
		.where(
			and(eq(employee.organizationId, organizationId), inArray(employee.id, [...employeeIds])),
		);
	// Holidays are calendar dates, stored at UTC midnight.
	const holidays = await getAssignedHolidaysForEmployees({
		organizationId,
		employeeIds: people.map((row) => row.id),
		employees: people,
		startDate: new Date(`${period.startDate}T00:00:00.000Z`),
		endDate: new Date(`${period.endDate}T00:00:00.000Z`),
		database: db,
	});
	return new Map(
		[...holidays].map(([employeeId, ranges]) => [
			employeeId,
			ranges.flatMap((range) => {
				const startDate = laterDate(range.startDate.toISOString().slice(0, 10), period.startDate);
				const endDate = earlierDate(range.endDate.toISOString().slice(0, 10), period.endDate);
				return startDate <= endDate ? [{ name: range.name, startDate, endDate }] : [];
			}),
		]),
	);
}

function laterDate(left: string, right: string): string {
	return left > right ? left : right;
}

function earlierDate(left: string, right: string): string {
	return left < right ? left : right;
}
