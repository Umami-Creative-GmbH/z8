import { Effect } from "effect";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { AuthorizationError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
/** Same active-organization owner/admin boundary as vehicle details. */
export const vehiclePhotosActor = (action: string) =>
	Effect.gen(function* () {
		const session = yield* (yield* AuthService).getSession();
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId)
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Select an organization first",
					userId: session.user.id,
					resource: "vehicle",
					action,
				}),
			);
		yield* requireActiveOrganizationActionActor({
			userId: session.user.id,
			organizationId,
			requiredRole: "admin",
			message: "Only owners and admins can manage vehicle photos",
			resource: "vehicle",
			action,
		});
		return { organizationId, userId: session.user.id };
	});
