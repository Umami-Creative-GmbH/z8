"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { requireActiveOrganizationActionActor } from "@/lib/auth/organization-action-authorization";
import { AuthorizationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { CustomFieldChange } from "@/lib/organization/custom-fields/definition-rules";
import {
	type CustomFieldChangeOutcome,
	type CustomFieldDefinitionView,
	changeCustomFields as changeCustomFieldsInStore,
	listCustomFieldDefinitions,
} from "@/lib/organization/custom-fields/definitions";

const ADMIN_ONLY = "Only owners and admins can manage custom fields";

/** The session's active organization, with the actor an owner or admin of it. */
const customFieldsActor = (action: string) =>
	Effect.gen(function* () {
		const authService = yield* AuthService;
		const session = yield* authService.getSession();
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* Effect.fail(
				new AuthorizationError({
					message: "Select an organization first",
					userId: session.user.id,
					resource: "customField",
					action,
				}),
			);
		}
		yield* requireActiveOrganizationActionActor({
			userId: session.user.id,
			organizationId,
			requiredRole: "admin",
			message: ADMIN_ONLY,
			resource: "customField",
			action,
		});
		return { organizationId, userId: session.user.id };
	});

/** Every custom field of the active organization, active and archived. Org admins only. */
export async function getCustomFieldDefinitions(): Promise<
	ServerActionResult<CustomFieldDefinitionView[]>
> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* customFieldsActor("read");
			const dbService = yield* DatabaseService;
			return yield* dbService.query("customFields.list", () =>
				listCustomFieldDefinitions(dbService.db, actor.organizationId),
			);
		}),
	);
}

/**
 * Applies one change to the custom fields of the active organization. Org
 * admins only. A refused change comes back as `{ ok: false, reason }`; an
 * accepted one returns every definition of the organization.
 */
export async function changeCustomFields(
	change: CustomFieldChange,
): Promise<ServerActionResult<CustomFieldChangeOutcome>> {
	return runServerActionSafe(
		Effect.gen(function* () {
			const actor = yield* customFieldsActor("change");
			const dbService = yield* DatabaseService;
			const outcome = yield* dbService.query("customFields.change", () =>
				changeCustomFieldsInStore(dbService.db, {
					organizationId: actor.organizationId,
					actorUserId: actor.userId,
					change,
				}),
			);
			if (outcome.ok) revalidatePath("/settings/custom-fields");
			return outcome;
		}),
	);
}
