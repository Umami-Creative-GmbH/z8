"use server";

import { runKioskFobAction } from "@/lib/time-tracking/kiosk/fob-action";
import type { KioskFobActionResult } from "@/lib/time-tracking/kiosk/fob-errors";
import {
	type KioskFobViewState,
	kioskFobViewState,
	readOwnKioskFobStatus,
	removeOwnKioskFob,
} from "@/lib/time-tracking/kiosk/fob-management";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

/** The signed-in employee's own kiosk fob (#1508); never the serial number. */
export type OwnKioskFobState = {
	fob: KioskFobViewState | null;
	/** Whether any kiosk of the organization reads fobs, so registering one is possible. */
	fobReaderInUse: boolean;
	/** The organization's zone, in which the registration date is shown. */
	timezone: string;
};

/** The signed-in user's own kiosk fob; null when they are no employee of the active organization. */
export async function getOwnKioskFobStatusAction(): Promise<
	KioskFobActionResult<OwnKioskFobState | null>
> {
	return runKioskFobAction("kiosk.ownFobStatus", async (db, actor) => {
		const [status, timezone] = await Promise.all([
			readOwnKioskFobStatus(db, { organizationId: actor.organizationId, userId: actor.userId }),
			loadOrganizationTimezone(db, actor.organizationId),
		]);
		if (!status) return null;
		return {
			fob: status.active && kioskFobViewState(status.active),
			fobReaderInUse: status.fobReaderInUse,
			timezone,
		};
	});
}

/**
 * Removes the signed-in employee's own kiosk fob they saw (`expectedFobId`), for
 * example after losing it: kiosks stop recognising it at once. Their kiosk PIN
 * and kiosk badge are unchanged.
 */
export async function removeOwnKioskFobAction(
	expectedFobId: string,
): Promise<KioskFobActionResult<{ removed: true }>> {
	return runKioskFobAction("kiosk.removeOwnFob", async (db, actor) => {
		await removeOwnKioskFob(db, {
			organizationId: actor.organizationId,
			userId: actor.userId,
			expectedFobId: typeof expectedFobId === "string" ? expectedFobId : "",
		});
		return { removed: true as const };
	});
}
