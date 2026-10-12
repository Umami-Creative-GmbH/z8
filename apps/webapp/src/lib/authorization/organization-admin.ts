import { defineAbilityFor } from "./ability";
import { loadOrganizationPrincipalContext, type PrincipalLoaderExecutor } from "./principal-loader";
import type { PrincipalContext } from "./types";

/** Whether the organization principal is an owner or admin: it manages the organization's settings. */
export function isOrganizationAdminPrincipal(principal: PrincipalContext): boolean {
	return defineAbilityFor(principal).can("manage", "OrgSettings");
}

/**
 * Whether the user is an owner or admin of the organization, for stores that
 * take the acting user instead of reading the session.
 */
export async function isOrganizationAdmin(
	executor: PrincipalLoaderExecutor,
	input: { userId: string; organizationId: string },
): Promise<boolean> {
	return isOrganizationAdminPrincipal(await loadOrganizationPrincipalContext(executor, input));
}
