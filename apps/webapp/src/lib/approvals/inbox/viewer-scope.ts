import { db } from "@/db";
import { loadInboxCovers } from "@/lib/approvals/deputy/deputy-decision-store";
import { getEligibleApprovalScopesForManager } from "@/lib/approvals/policies/manager-eligibility-db";
import { type AppAbility, canAccessApprovalInbox, canOpenApprovalInbox } from "@/lib/authorization";
import { type Clock, systemClock } from "@/lib/datetime/temporal-core";
import { resolveComplianceExceptionInboxScope } from "./compliance-exception-inbox";
import type { ApprovalInboxListParams } from "./read-service";

/** What a viewer's Approval inbox reads: the same for its list, its badge and its summaries. */
export type ApprovalInboxViewerScope = Pick<
	ApprovalInboxListParams,
	| "approverId"
	| "organizationId"
	| "includeAllApprovers"
	| "eligibleApprovalScopes"
	| "covering"
	| "complianceExceptionsOnly"
	| "complianceExceptionScope"
>;

/**
 * The approvals and compliance exceptions this employee's inbox shows, or null when they may
 * not open it (#1977). With `manage Approval` every approval of the organization, else their
 * assignments, eligible manager scopes and the absent approvers they cover for; managing
 * Compliance alone shows only compliance exceptions.
 */
export async function resolveApprovalInboxViewerScope(input: {
	ability: AppAbility;
	employee: { id: string; organizationId: string; role: "admin" | "manager" | "employee" };
	clock?: Clock;
	/**
	 * False for a caller that shows no "Covering for" sections (the manager briefing, #1980): its
	 * deputy covers are not read. Defaults to true.
	 */
	includeCovering?: boolean;
}): Promise<ApprovalInboxViewerScope | null> {
	const { ability, employee } = input;
	if (!canOpenApprovalInbox(ability, employee)) return null;
	const canManageApprovals = ability.cannot("manage", "Approval") === false;
	// Managing Compliance alone reads compliance exceptions, never approvals.
	const approverAccess = canAccessApprovalInbox(ability, employee);
	const readsEligibility = approverAccess && !canManageApprovals;
	const eligibleApprovalScopes = readsEligibility
		? await getEligibleApprovalScopesForManager({
				db,
				managerEmployeeId: employee.id,
				organizationId: employee.organizationId,
			})
		: [];
	return {
		approverId: employee.id,
		organizationId: employee.organizationId,
		includeAllApprovers: canManageApprovals || undefined,
		eligibleApprovalScopes,
		// "Covering for": absent approvers this employee covers for now (#1016).
		covering:
			approverAccess && input.includeCovering !== false
				? await loadInboxCovers(db, {
						organizationId: employee.organizationId,
						deputyEmployeeId: employee.id,
						at: (input.clock ?? systemClock).nowInstant(),
					})
				: [],
		...(approverAccess ? {} : { complianceExceptionsOnly: true }),
		// ArbZG compliance exceptions this employee sees (ADR-0005), from the eligibility read
		// above when there was one.
		complianceExceptionScope: await resolveComplianceExceptionInboxScope({
			organizationId: employee.organizationId,
			employeeId: employee.id,
			canManageCompliance: ability.cannot("manage", "Compliance") === false,
			...(readsEligibility ? { eligibleApprovalScopes } : {}),
		}),
	};
}
