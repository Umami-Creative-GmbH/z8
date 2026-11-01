import "server-only";

import type { OrganizationActor } from "@/lib/auth/current-organization-actor";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { type KioskFobActionResult, KioskFobManagementRefusal } from "./fob-errors";
import { runKioskManagementAction } from "./kiosk-management-action";

/**
 * Runs a kiosk fob management server action (#1508) for the signed-in user in
 * their active organization. Refusals come back with their stable code;
 * authorization is the fob store's.
 */
export function runKioskFobAction<T>(
	name: string,
	action: (db: DatabaseClient, actor: OrganizationActor) => Promise<T>,
): Promise<KioskFobActionResult<T>> {
	return runKioskManagementAction(
		name,
		KioskFobManagementRefusal,
		() => new KioskFobManagementRefusal("sign_in_required", "Sign in to continue."),
		action,
	);
}
