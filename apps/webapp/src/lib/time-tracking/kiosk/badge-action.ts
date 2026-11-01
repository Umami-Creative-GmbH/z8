import "server-only";

import type { OrganizationActor } from "@/lib/auth/current-organization-actor";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { type KioskBadgeActionResult, KioskBadgeRefusal } from "./badge-errors";
import { runKioskManagementAction } from "./kiosk-management-action";

/**
 * Runs a kiosk badge management server action (#1364) for the signed-in user
 * in their active organization. Refusals come back with their stable code;
 * authorization is the badge store's.
 */
export function runKioskBadgeAction<T>(
	name: string,
	action: (db: DatabaseClient, actor: OrganizationActor) => Promise<T>,
): Promise<KioskBadgeActionResult<T>> {
	return runKioskManagementAction(
		name,
		KioskBadgeRefusal,
		() => new KioskBadgeRefusal("sign_in_required", "Sign in to continue."),
		action,
	);
}
