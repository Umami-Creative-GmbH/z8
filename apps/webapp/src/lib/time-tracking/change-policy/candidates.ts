import { and, eq, or } from "drizzle-orm";
import { changePolicy, changePolicyAssignment } from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { ChangePolicyCandidate, ChangePolicySubject } from "./resolution";

/** A candidate with the policy values its callers apply. */
export type ChangePolicyCandidateRow = ChangePolicyCandidate & {
	policyId: string;
	policyName: string;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired: boolean;
	notifyAllManagers: boolean;
};

/**
 * The organization's change-policy assignments that could apply to `subject`: its default and the
 * subject's employee and team assignments, in any state. `resolveChangePolicy` picks among them.
 */
export async function loadChangePolicyCandidates(
	reader: Pick<DatabaseClient, "select">,
	subject: ChangePolicySubject,
): Promise<ChangePolicyCandidateRow[]> {
	const rows = await reader
		.select({
			assignmentId: changePolicyAssignment.id,
			level: changePolicyAssignment.assignmentType,
			organizationId: changePolicyAssignment.organizationId,
			employeeId: changePolicyAssignment.employeeId,
			teamId: changePolicyAssignment.teamId,
			assignmentActive: changePolicyAssignment.isActive,
			effectiveFrom: changePolicyAssignment.effectiveFrom,
			effectiveUntil: changePolicyAssignment.effectiveUntil,
			policyOrganizationId: changePolicy.organizationId,
			policyActive: changePolicy.isActive,
			policyId: changePolicy.id,
			policyName: changePolicy.name,
			selfServiceDays: changePolicy.selfServiceDays,
			approvalDays: changePolicy.approvalDays,
			noApprovalRequired: changePolicy.noApprovalRequired,
			notifyAllManagers: changePolicy.notifyAllManagers,
		})
		.from(changePolicyAssignment)
		.innerJoin(
			changePolicy,
			and(
				eq(changePolicy.id, changePolicyAssignment.policyId),
				eq(changePolicy.organizationId, subject.organizationId),
			),
		)
		.where(
			and(
				eq(changePolicyAssignment.organizationId, subject.organizationId),
				or(
					eq(changePolicyAssignment.assignmentType, "organization"),
					subject.teamId === null ? undefined : eq(changePolicyAssignment.teamId, subject.teamId),
					subject.employeeId === null
						? undefined
						: eq(changePolicyAssignment.employeeId, subject.employeeId),
				),
			),
		);
	return rows.map((row) => ({
		...row,
		effectiveFrom: row.effectiveFrom ? instantFromDate(row.effectiveFrom) : null,
		effectiveUntil: row.effectiveUntil ? instantFromDate(row.effectiveUntil) : null,
	}));
}
