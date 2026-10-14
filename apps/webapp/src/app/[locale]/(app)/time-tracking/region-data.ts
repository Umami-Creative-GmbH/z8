import "server-only";

import { unstable_rethrow } from "next/navigation";
import { db } from "@/db";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { dateToDB } from "@/lib/datetime/drizzle-adapter";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type EmployeePeriodView,
	loadEmployeePeriodView,
} from "@/lib/time-tracking/period-submissions/employee-period-view-store";
import { getWeekRangeInTimezone } from "@/lib/time-tracking/timezone-utils";
import type { TimeSummary } from "@/lib/time-tracking/types";
import {
	type DrivingDetailsMissingWork,
	listDrivingDetailsMissing,
} from "@/lib/time-tracking/vehicle-use/driving-details-missing-store";
import { getEmployeeWorkBalance } from "@/lib/work-balance/service";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import {
	type EmployeeReadScope,
	readTimeSummary,
	readWorkPeriods,
} from "./read-queries";
import type { EmployeeRenderContext } from "./render-context";
import type { WorkPeriodWithEntries } from "./types";

export type SummaryRegionData = {
	summary: TimeSummary;
	workBalance: EmployeeWorkBalancePayload | null;
};

export type HistoryRegionData = {
	workPeriods: WorkPeriodWithEntries[];
	hasManager: boolean;
	canApproveTimeEntries: boolean;
	/** The listed work periods showing driving details missing (#1127). */
	drivingDetailsMissingIds: string[];
};

export type DrivingRegionData = {
	work: DrivingDetailsMissingWork[];
	truncated: boolean;
};

/** How many of the employee's flagged work periods the notice lists. */
const DRIVING_NOTICE_LIMIT = 20;

export async function readSummaryRegion(
	context: EmployeeRenderContext,
): Promise<SummaryRegionData> {
	const scope: EmployeeReadScope = {
		employeeId: context.employee.id,
		organizationId: context.employee.organizationId,
	};
	const [summary, workBalance] = await Promise.all([
		readTimeSummary(scope, context.timezone, context.weekStartDay),
		getSafeEmployeeWorkBalance(scope),
	]);
	return { summary, workBalance };
}

export async function readHistoryRegion(
	context: EmployeeRenderContext,
): Promise<HistoryRegionData> {
	const scope: EmployeeReadScope = {
		employeeId: context.employee.id,
		organizationId: context.employee.organizationId,
	};
	const { start, end } = getWeekRangeInTimezone(
		new Date(),
		context.timezone,
		context.weekStartDay,
	);
	const [workPeriods, managerId] = await Promise.all([
		readWorkPeriods(scope, dateToDB(start)!, dateToDB(end)!),
		getPrimaryEligibleManagerIdForRequester({
			db,
			requesterEmployeeId: scope.employeeId,
			organizationId: scope.organizationId,
		}),
	]);
	const flagged = await listDrivingDetailsMissing(db, {
		...drivingScope(scope),
		workPeriodIds: workPeriods.map((period) => period.id),
	});
	return {
		workPeriods,
		drivingDetailsMissingIds: flagged.map((work) => work.workPeriodId),
		hasManager: Boolean(managerId),
		canApproveTimeEntries:
			context.membershipRole === "admin" || context.membershipRole === "owner",
	};
}

/**
 * The employee's own work showing driving details missing (#1127), newest first; empty unless
 * vehicle use is expected of them.
 */
export async function readDrivingRegion(
	context: EmployeeRenderContext,
): Promise<DrivingRegionData> {
	const work = await listDrivingDetailsMissing(db, {
		...drivingScope({
			employeeId: context.employee.id,
			organizationId: context.employee.organizationId,
		}),
		limit: DRIVING_NOTICE_LIMIT + 1,
	});
	return {
		work: work.slice(0, DRIVING_NOTICE_LIMIT),
		truncated: work.length > DRIVING_NOTICE_LIMIT,
	};
}

function drivingScope(scope: EmployeeReadScope) {
	return { organizationId: scope.organizationId, employeeIds: [scope.employeeId] };
}

/** The employee's period submissions (#1059); null when the organization collects none. */
export async function readPeriodsRegion(
	context: EmployeeRenderContext,
): Promise<EmployeePeriodView | null> {
	return loadEmployeePeriodView(db, {
		organizationId: context.employee.organizationId,
		employeeId: context.employee.id,
		now: systemClock.nowInstant(),
	});
}

export async function getSafeEmployeeWorkBalance(
	scope: EmployeeReadScope,
): Promise<EmployeeWorkBalancePayload | null> {
	try {
		return await getEmployeeWorkBalance(scope);
	} catch (error) {
		unstable_rethrow(error);
		console.error("Failed to load employee work balance", {
			employeeId: scope.employeeId,
			organizationId: scope.organizationId,
		});
		return null;
	}
}
