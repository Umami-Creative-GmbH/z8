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
};

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
	return {
		workPeriods,
		hasManager: Boolean(managerId),
		canApproveTimeEntries:
			context.membershipRole === "admin" || context.membershipRole === "owner",
	};
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
