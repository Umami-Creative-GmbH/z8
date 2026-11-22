import { Effect } from "effect";
import { organizationAbility } from "@/lib/authorization/organization-ability";
import { AuthorizationError } from "@/lib/effect/errors";
import type { OrganizationActor } from "@/lib/organization-action/organization-action";

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
		const ability = yield* organizationAbility({ userId: actor.userId, organizationId });
		if (ability.cannot("manage", "Approval")) {
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
