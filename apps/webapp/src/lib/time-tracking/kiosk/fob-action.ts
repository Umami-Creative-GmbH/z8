import "server-only";

import {
	type OrganizationActor,
	requireOrganizationActor,
} from "@/lib/auth/current-organization-actor";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { type KioskFobActionResult, KioskFobManagementRefusal } from "./fob-errors";

/**
 * Runs a kiosk fob management server action (#1508) for the signed-in user in
 * their active organization. Refusals come back with their stable code;
 * authorization is the fob store's.
 */
export function runKioskFobAction<T>(
	name: string,
	action: (db: DatabaseClient, actor: OrganizationActor) => Promise<T>,
): Promise<KioskFobActionResult<T>> {
	return runRefusalAction(name, KioskFobManagementRefusal, async (db) =>
		action(
			db,
			await requireOrganizationActor(
				() => new KioskFobManagementRefusal("sign_in_required", "Sign in to continue."),
			),
		),
	);
}
