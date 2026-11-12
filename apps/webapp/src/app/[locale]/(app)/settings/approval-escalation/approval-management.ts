import { Effect } from "effect";
import { defineAbilityFor } from "@/lib/authorization/ability";
import { loadOrganizationPrincipalContext } from "@/lib/authorization/principal-loader";
import { AuthorizationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";

/** The `DatabaseService.query` name the actor's CASL principal loads under; tests answer it. */
export const APPROVAL_MANAGEMENT_PRINCIPAL_QUERY = "approvalEscalation.principal";

/**
 * Escalation and deputy decisions are approval-management concerns, not
 * settings tiers: the actor needs CASL `manage Approval` in the organization,
 * which workforce admins and custom-role grants give and an org membership
 * alone does not. Holding an approval assignment or being an eligible manager
 * is not sufficient. The settings actions declare `member` and fail here.
 */
export function approvalManagementRefusal(
	actor: OrganizationActor,
	organizationId: string,
	message = "You do not have permission to manage approval escalation.",
) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const principal = yield* dbService.query(APPROVAL_MANAGEMENT_PRINCIPAL_QUERY, () =>
			loadOrganizationPrincipalContext(dbService.db, { userId: actor.userId, organizationId }),
		);
		if (defineAbilityFor(principal).cannot("manage", "Approval")) {
			return yield* Effect.fail(
				new AuthorizationError({
					message,
					userId: actor.userId,
					resource: "approval_escalation",
					action: "manage",
				}),
			);
		}
	});
}
