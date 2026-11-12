"use server";

import { z } from "zod";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import { KioskFobManagementRefusal } from "@/lib/time-tracking/kiosk/fob-errors";
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
export const getOwnKioskFobStatusAction = organizationAction(
	{ name: "kiosk.ownFobStatus", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		storeStep(
			"kiosk.ownFobStatus",
			async (db): Promise<OwnKioskFobState | null> => {
				const [status, timezone] = await Promise.all([
					readOwnKioskFobStatus(db, { organizationId, userId: actor.userId }),
					loadOrganizationTimezone(db, organizationId),
				]);
				if (!status) return null;
				return {
					fob: status.active && kioskFobViewState(status.active),
					fobReaderInUse: status.fobReaderInUse,
					timezone,
				};
			},
			{ refusal: KioskFobManagementRefusal },
		),
);

/**
 * Removes the signed-in employee's own kiosk fob they saw (`expectedFobId`), for
 * example after losing it: kiosks stop recognising it at once. Their kiosk PIN
 * and kiosk badge are unchanged.
 */
export const removeOwnKioskFobAction = organizationAction(
	{ name: "kiosk.removeOwnFob", requires: "member", schema: z.string() },
	({ actor, organizationId, input: expectedFobId }) =>
		storeStep(
			"kiosk.removeOwnFob",
			async (db) => {
				await removeOwnKioskFob(db, { organizationId, userId: actor.userId, expectedFobId });
				return { removed: true as const };
			},
			{ refusal: KioskFobManagementRefusal },
		),
);
