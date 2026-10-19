import "server-only";

import {
	type OrganizationActor,
	requireOrganizationActor,
} from "@/lib/auth/current-organization-actor";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { type KioskBadgeActionResult, KioskBadgeRefusal } from "./badge-errors";

/**
 * Runs a kiosk badge management server action (#1364) for the signed-in user
 * in their active organization. Refusals come back with their stable code;
 * authorization is the badge store's.
 */
export function runKioskBadgeAction<T>(
	name: string,
	action: (db: DatabaseClient, actor: OrganizationActor) => Promise<T>,
): Promise<KioskBadgeActionResult<T>> {
	return runRefusalAction(name, KioskBadgeRefusal, async (db) =>
		action(
			db,
			await requireOrganizationActor(
				() => new KioskBadgeRefusal("sign_in_required", "Sign in to continue."),
			),
		),
	);
}
