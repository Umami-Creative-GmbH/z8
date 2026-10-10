import "server-only";

import {
	type OrganizationActor,
	requireOrganizationActor,
} from "@/lib/auth/current-organization-actor";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { type KioskPinActionResult, KioskPinRefusal } from "./pin-errors";

/**
 * Runs a kiosk PIN or kiosk-only employee server action (#857) for the
 * signed-in user in their active organization. Refusals come back with their
 * stable code (`runRefusalAction`); authorization is the store's.
 */
export function runKioskPinAction<T>(
	name: string,
	action: (db: DatabaseClient, actor: OrganizationActor) => Promise<T>,
): Promise<KioskPinActionResult<T>> {
	return runRefusalAction(name, KioskPinRefusal, async (db) =>
		action(
			db,
			await requireOrganizationActor(
				() => new KioskPinRefusal("sign_in_required", "Sign in to continue."),
			),
		),
	);
}
