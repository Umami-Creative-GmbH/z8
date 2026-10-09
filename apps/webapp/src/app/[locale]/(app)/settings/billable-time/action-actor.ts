import "server-only";

import { Effect } from "effect";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { AuthorizationError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";

/**
 * The actor of a Billable Time server action. Every Billable Time read and write
 * acts on the session's active organization only; `requiredRole: "admin"`
 * admits owners and admins.
 */
export const activeOrganizationActor = (input: {
	requiredRole: "owner" | "admin";
	message: string;
	action: string;
}) =>
	Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Select an organization first",
					userId: session.user.id,
					resource: "billableTime",
					action: input.action,
				}),
			);
		}
		yield* requireActiveOrganizationActionActor({
			userId: session.user.id,
			organizationId,
			requiredRole: input.requiredRole,
			message: input.message,
			resource: "billableTime",
			action: input.action,
		});
		return { organizationId, userId: session.user.id };
	});
