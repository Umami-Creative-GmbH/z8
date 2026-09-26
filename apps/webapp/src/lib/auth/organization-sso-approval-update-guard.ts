import { APIError } from "better-auth/api";

/**
 * SSO provisioning reads `ssoRequiresApproval` inside its user-guarded
 * transaction, but Better Auth's organization update cannot join organization
 * configuration protection, and no z8 writer offers the setting. A change
 * through the update endpoint is therefore refused, which retires its only
 * unprotected writer (#318). The value set at creation (default: approval
 * required) stays in force.
 */
export function rejectOrganizationSsoApprovalUpdate(data: Record<string, unknown>) {
	if ("ssoRequiresApproval" in data && data.ssoRequiresApproval !== undefined) {
		throw new APIError("BAD_REQUEST", {
			code: "ORGANIZATION_SSO_APPROVAL_PROTECTED",
			message: "The SSO approval setting cannot be changed through the organization update",
		});
	}
}
