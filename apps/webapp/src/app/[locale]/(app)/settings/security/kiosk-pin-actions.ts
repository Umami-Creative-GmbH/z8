"use server";

import { z } from "zod";
import { queryOrRefuse } from "@/lib/effect/refusal-query";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { KioskPinRefusal } from "@/lib/time-tracking/kiosk/pin-errors";
import { readOwnKioskPinStatus, setOwnKioskPin } from "@/lib/time-tracking/kiosk/pin-store";

/** Whether the signed-in user is an employee of the active organization and has a kiosk PIN. */
export const getOwnKioskPinStatusAction = organizationAction(
	{ name: "kiosk.ownPinStatus", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		queryOrRefuse("kiosk.ownPinStatus", KioskPinRefusal, (db) =>
			readOwnKioskPinStatus(db, { organizationId, userId: actor.userId }),
		),
);

/**
 * Sets or changes the signed-in employee's own kiosk PIN. The store refuses a
 * PIN that is not 4 to 6 digits with `invalid_pin`.
 */
export const setOwnKioskPinAction = organizationAction(
	{ name: "kiosk.setOwnPin", requires: "member", schema: z.string() },
	({ actor, organizationId, input: pin }) =>
		queryOrRefuse("kiosk.setOwnPin", KioskPinRefusal, async (db) => {
			await setOwnKioskPin(db, { organizationId, userId: actor.userId, pin });
			return { saved: true as const };
		}),
);
