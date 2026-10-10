"use server";

import { runKioskPinAction } from "@/lib/time-tracking/kiosk/kiosk-pin-action";
import type { KioskPinActionResult } from "@/lib/time-tracking/kiosk/pin-errors";
import { readOwnKioskPinStatus, setOwnKioskPin } from "@/lib/time-tracking/kiosk/pin-store";

/** Whether the signed-in user is an employee of the active organization and has a kiosk PIN. */
export async function getOwnKioskPinStatusAction(): Promise<
	KioskPinActionResult<{ hasEmployee: boolean; hasPin: boolean }>
> {
	return runKioskPinAction("kiosk.ownPinStatus", (db, actor) =>
		readOwnKioskPinStatus(db, { organizationId: actor.organizationId, userId: actor.userId }),
	);
}

/** Sets or changes the signed-in employee's own kiosk PIN (4 to 6 digits). */
export async function setOwnKioskPinAction(
	pin: string,
): Promise<KioskPinActionResult<{ saved: true }>> {
	return runKioskPinAction("kiosk.setOwnPin", async (db, actor) => {
		await setOwnKioskPin(db, {
			organizationId: actor.organizationId,
			userId: actor.userId,
			pin: typeof pin === "string" ? pin : "",
		});
		return { saved: true as const };
	});
}
