import "server-only";

import {
	type OrganizationActor,
	requireOrganizationActor,
} from "@/lib/auth/current-organization-actor";
import {
	type ActionRefusal,
	type RefusalActionResult,
	runRefusalAction,
} from "@/lib/effect/refusal-action";
import type { DatabaseClient } from "@/lib/effect/services/database.service";

/**
 * Runs a kiosk credential management server action (kiosk badges #1364, kiosk
 * fobs #1508) for the signed-in user in their active organization. Refusals of
 * `refusal`'s class come back with their stable code, a signed-out user with
 * the one `signInRequired` makes; authorization is the store's.
 */
export function runKioskManagementAction<Code extends string, T>(
	name: string,
	refusal: abstract new (...args: never[]) => ActionRefusal<Code>,
	signInRequired: () => ActionRefusal<Code>,
	action: (db: DatabaseClient, actor: OrganizationActor) => Promise<T>,
): Promise<RefusalActionResult<T, Code>> {
	return runRefusalAction(name, refusal, async (db) =>
		action(db, await requireOrganizationActor(signInRequired)),
	);
}
