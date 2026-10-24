import type { AuthContext } from "@/lib/auth-helpers";

/** Internal server evidence: approved membership and current employment, if any.
 * Never deserialize this from browser input or use it instead of a public guard.
 */
export interface AuthorizedOrganizationIdentity {
	userId: string;
	organizationId: string;
	membershipRole: string;
	employee: AuthContext["employee"];
}
