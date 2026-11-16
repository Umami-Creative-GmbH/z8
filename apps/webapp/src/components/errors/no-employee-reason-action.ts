"use server";

import { Effect } from "effect";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";

/** Why the viewer has no employee in their active organization, when it is worth saying. */
export type NoEmployeeReason = "former_employee" | null;

/**
 * "former_employee" when the viewer holds an approved membership in their
 * active organization but their employment there ended: a former employee who
 * regained the membership and needs a rehire (#1672, spec #1664 decision 4).
 * Reads only the viewer's own state in the session's active organization,
 * behind its SSO/MFA gate.
 */
export async function getNoEmployeeReason(): Promise<ServerActionResult<NoEmployeeReason>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const authentication = yield* AuthService;
			const session = yield* authentication.getSession();
			const organizationId = session.session.activeOrganizationId;
			if (!organizationId) return null;
			const database = yield* DatabaseService;
			return yield* database.query("noEmployeeReason.read", async (): Promise<NoEmployeeReason> => {
				if (!(await canAccessOrganization(session.session, organizationId, database.db))) {
					return null;
				}
				const access = await resolveEmployeeOrganizationAccess(database.db, {
					userId: session.user.id,
					organizationId,
				});
				return !access.allowed && access.reason === "offboarded" ? "former_employee" : null;
			});
		}),
	);
}
