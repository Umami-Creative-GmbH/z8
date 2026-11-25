import { and, eq, inArray } from "drizzle-orm";
import { workPolicyAssignment, workPolicyVersion } from "@/db/schema";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { termsCalendarDate } from "@/lib/employment-history/terms-in-force";

/**
 * Per employee, the days (`YYYY-MM-DD`) on which the week of their own that
 * `loadEffectiveContractsBatch` resolves can change without a new terms row: an individual
 * work-policy assignment starts or ends (`workPolicySource = "employee_override"`), or a work
 * policy of their own (assigned to them or pinned on their terms) gets a new version
 * (`selectActivePolicyVersionOnDay`). Team and organization policies are not a week of their own
 * and are left out. A caller that reads the week over a span resolves it on these days (and on
 * its terms rows' starts) instead of on every day.
 */
export async function loadOwnWeekChangeDates(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly timezone: string;
		/** Per employee to look at, the work policies pinned on their terms. */
		readonly termsPolicyIds: ReadonlyMap<string, readonly string[]>;
	},
): Promise<Map<string, Set<string>>> {
	const employeeIds = [...input.termsPolicyIds.keys()];
	const datesByEmployee = new Map<string, Set<string>>();
	if (employeeIds.length === 0) return datesByEmployee;
	const datesOf = (employeeId: string) => {
		let dates = datesByEmployee.get(employeeId);
		if (!dates) {
			dates = new Set();
			datesByEmployee.set(employeeId, dates);
		}
		return dates;
	};

	const assignments = await db
		.select({
			employeeId: workPolicyAssignment.employeeId,
			policyId: workPolicyAssignment.policyId,
			effectiveFrom: workPolicyAssignment.effectiveFrom,
			effectiveUntil: workPolicyAssignment.effectiveUntil,
			effectiveFromDate: workPolicyAssignment.effectiveFromDate,
			effectiveUntilDate: workPolicyAssignment.effectiveUntilDate,
		})
		.from(workPolicyAssignment)
		.where(
			and(
				eq(workPolicyAssignment.organizationId, input.organizationId),
				eq(workPolicyAssignment.assignmentType, "employee"),
				inArray(workPolicyAssignment.employeeId, employeeIds),
				eq(workPolicyAssignment.isActive, true),
			),
		);
	const policyIdsByEmployee = new Map(
		[...input.termsPolicyIds].map(([employeeId, ids]) => [employeeId, new Set(ids)]),
	);
	for (const row of assignments) {
		if (!row.employeeId) continue;
		policyIdsByEmployee.get(row.employeeId)?.add(row.policyId);
		const dates = datesOf(row.employeeId);
		dates.add(row.effectiveFromDate);
		if (row.effectiveUntilDate) dates.add(row.effectiveUntilDate);
		// Legacy rows bounded by instants: the resolver reads their calendar day.
		for (const instant of [row.effectiveFrom, row.effectiveUntil]) {
			if (instant) dates.add(termsCalendarDate(instant, input.timezone).toString());
		}
	}

	const policyIds = [...new Set([...policyIdsByEmployee.values()].flatMap((ids) => [...ids]))];
	if (policyIds.length === 0) return datesByEmployee;
	const versions = await db
		.select({
			policyId: workPolicyVersion.policyId,
			effectiveFromDate: workPolicyVersion.effectiveFromDate,
		})
		.from(workPolicyVersion)
		.where(
			and(
				eq(workPolicyVersion.organizationId, input.organizationId),
				inArray(workPolicyVersion.policyId, policyIds),
			),
		);
	const versionDatesByPolicy = new Map<string, string[]>();
	for (const row of versions) {
		const list = versionDatesByPolicy.get(row.policyId);
		if (list) list.push(row.effectiveFromDate);
		else versionDatesByPolicy.set(row.policyId, [row.effectiveFromDate]);
	}
	for (const [employeeId, ids] of policyIdsByEmployee) {
		for (const policyId of ids) {
			for (const date of versionDatesByPolicy.get(policyId) ?? []) datesOf(employeeId).add(date);
		}
	}
	return datesByEmployee;
}
