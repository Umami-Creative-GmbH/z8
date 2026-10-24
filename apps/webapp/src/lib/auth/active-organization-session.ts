import "server-only";

import { Effect } from "effect";
import { AuthorizationError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { canAccessOrganization } from "@/lib/organization-mfa/organization-access";

/** Fresh admission for scoped public callers; legacy member-only accounts remain eligible. */
export const activeOrganizationSession = Effect.gen(function* () {
	const authentication = yield* AuthService;
	const session = yield* authentication.getSession();
	const organizationId = session.session.activeOrganizationId;
	if (!organizationId) return session;
	const database = yield* DatabaseService;
	const allowed = yield* database.query(
		"activeOrganizationSession.admission",
		async () => {
			if (
				!(await canAccessOrganization(
					session.session,
					organizationId,
					database.db,
				))
			)
				return false;
			const access = await resolveEmployeeOrganizationAccess(database.db, {
				userId: session.user.id,
				organizationId,
			});
			return access.allowed;
		},
	);
	if (!allowed)
		return yield* Effect.fail(
			new AuthorizationError({ message: "Organization access required" }),
		);
	return session;
});
