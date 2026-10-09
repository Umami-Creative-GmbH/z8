import "server-only";
import { loadCurrentPersonnelFileAccess } from "./current-access";

/**
 * The signed-in owner or admin administering personnel files (#866): who may
 * grant personnel file officer access. Officers themselves never may, and
 * nobody may while personnel files are off.
 */
export async function requirePersonnelFileAdministrator(): Promise<
	{ organizationId: string; userId: string } | { error: string }
> {
	const current = await loadCurrentPersonnelFileAccess();
	if (current.status === "unauthenticated") return { error: "Not authenticated" };
	if (
		current.status !== "resolved" ||
		!current.access.grants.some((grant) => grant.source === "organization_admin")
	) {
		return { error: "Only owners and admins can manage personnel file officers" };
	}
	return { organizationId: current.access.organizationId, userId: current.access.userId };
}
