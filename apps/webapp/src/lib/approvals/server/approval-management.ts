import { defineAbilityFor } from "@/lib/authorization/ability";
import {
	loadOrganizationPrincipalContext,
	type PrincipalLoaderExecutor,
} from "@/lib/authorization/principal-loader";

/**
 * Whether the user is a manager of approvals in the organization, read from
 * their membership, employee record and roles through the caller's executor
 * (the decision's transaction), never from a session (Approvals ADR 0003). A
 * platform administrator's session-wide access does not count here.
 */
export async function holdsApprovalManagement(
	executor: PrincipalLoaderExecutor,
	input: { organizationId: string; userId: string },
): Promise<boolean> {
	const principal = await loadOrganizationPrincipalContext(executor, input);
	if (!principal.orgMembership) return false;
	return defineAbilityFor(principal).cannot("manage", "Approval") === false;
}
