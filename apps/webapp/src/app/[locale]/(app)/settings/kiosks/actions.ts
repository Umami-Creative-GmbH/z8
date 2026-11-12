"use server";

import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { location } from "@/db/schema";
import { withAuditTrail } from "@/lib/audit-trail";
import { ValidationError } from "@/lib/effect/errors";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { storeStep } from "@/lib/organization-action/store-step";
import type { KioskTimeSource } from "@/lib/time-tracking/clocking/types";
import type {
	KioskFrozenAction,
	KioskFrozenRefusalReason,
} from "@/lib/time-tracking/kiosk/frozen-command";
import { listKioskFrozenRefusals } from "@/lib/time-tracking/kiosk/frozen-refusal-store";
import { KioskSettingsRefusal } from "@/lib/time-tracking/kiosk/kiosk-settings-errors";
import {
	createKiosk,
	issueKioskPairingCode,
	type KioskStatus,
	listKiosks,
	revokeKiosk,
	updateKiosk,
} from "@/lib/time-tracking/kiosk/kiosk-store";
import { readAppendAdmission } from "@/lib/time-tracking/work-transaction";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { isUuid } from "@/lib/validations/uuid";

export type KioskData = {
	id: string;
	name: string;
	locationId: string;
	locationName: string;
	timezone: string;
	boardEnabled: boolean;
	/** The stored switch (#1287); it takes effect only while the organization is adopted. */
	offlineModeEnabled: boolean;
	/** Whether badges read by an attached QR scanner identify employees (#1366). */
	badgeScannerEnabled: boolean;
	/** Whether badges read with the kiosk's own camera identify employees (#1367). */
	badgeCameraEnabled: boolean;
	/** Whether kiosk fobs read by an attached NFC reader select employees (#1505). */
	nfcFobReaderEnabled: boolean;
	status: KioskStatus;
	/** ISO instants. */
	pairingCodeExpiresAt: string | null;
	pairedAt: string | null;
	lastSeenAt: string | null;
	revokedAt: string | null;
};

export type KioskLocationOption = { id: string; name: string };

export type KioskAdminData = {
	kiosks: KioskData[];
	locations: KioskLocationOption[];
	/** The organization's zone, the default zone of a new kiosk (locations carry no zone). */
	organizationTimezone: string;
	/**
	 * Whether the organization is adopted (`append` admission, ADR 0002): only
	 * then can a kiosk's offline mode be switched on (#1287).
	 */
	organizationAdopted: boolean;
	/** Refused offline kiosk commands (#1290), newest first, for owners and admins only. */
	refusals: KioskRefusalData[];
};

/** A frozen kiosk clock command Z8 refused on arrival (#1290). */
export type KioskRefusalData = {
	id: string;
	kioskId: string;
	kioskName: string;
	/** Null when the command named no employee of the organization. */
	employeeName: string | null;
	action: KioskFrozenAction;
	/** ISO instants. */
	claimedAt: string;
	/** The zone the kiosk recorded the command in: the claimed instant is shown in it. */
	timezone: string;
	timeSource: KioskTimeSource;
	reason: KioskFrozenRefusalReason;
	refusedAt: string;
};

export type IssuedPairingCodeData = {
	kioskId: string;
	/** Shown once: `ABCDE-FGHJK`. */
	pairingCode: string;
	/** ISO instant. */
	expiresAt: string;
};

export type CreateKioskInput = { name: string; locationId: string; timezone: string };

export type UpdateKioskInput = {
	kioskId: string;
	name?: string;
	locationId?: string;
	timezone?: string;
	boardEnabled?: boolean;
	offlineModeEnabled?: boolean;
	badgeScannerEnabled?: boolean;
	badgeCameraEnabled?: boolean;
	nfcFobReaderEnabled?: boolean;
};

const SETTINGS_PATH = "/settings/kiosks";

/**
 * Kiosk and location IDs are plain strings here: a malformed one is refused
 * like another organization's, as not found (`notFound`). The store checks
 * names and zones itself.
 */
const kioskIdSchema = z.strictObject({ kioskId: z.string("Kiosk not found.") });

const createKioskSchema = z.strictObject({
	name: z.string("Enter a name."),
	locationId: z.string("Choose a location."),
	timezone: z.string("Choose a time zone."),
}) satisfies z.ZodType<CreateKioskInput>;

const updateKioskSchema = z.strictObject({
	kioskId: z.string("Kiosk not found."),
	name: z.string("Enter a name.").optional(),
	locationId: z.string("Choose a location.").optional(),
	timezone: z.string("Choose a time zone.").optional(),
	boardEnabled: z.boolean("The board switch must be on or off.").optional(),
	offlineModeEnabled: z.boolean("Offline mode must be on or off.").optional(),
	badgeScannerEnabled: z.boolean("Scanner input must be on or off.").optional(),
	badgeCameraEnabled: z.boolean("Camera input must be on or off.").optional(),
	nfcFobReaderEnabled: z.boolean("The NFC fob reader must be on or off.").optional(),
}) satisfies z.ZodType<UpdateKioskInput>;

export const getKioskAdminDataAction = organizationAction(
	{ name: "kiosk.adminData", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		storeStep(
			"kiosk.adminData",
			async (db): Promise<KioskAdminData> => {
				const [kiosks, locations, organizationTimezone, admission, refusals] = await Promise.all([
					listKiosks(db, organizationId),
					db
						.select({ id: location.id, name: location.name })
						.from(location)
						.where(and(eq(location.organizationId, organizationId), eq(location.isActive, true)))
						.orderBy(asc(location.name)),
					loadOrganizationTimezone(db, organizationId),
					readAppendAdmission(db, organizationId),
					listKioskFrozenRefusals(db, { organizationId }),
				]);
				return {
					kiosks: kiosks.map((row) => ({
						id: row.id,
						name: row.name,
						locationId: row.locationId,
						locationName: row.locationName,
						timezone: row.timezone,
						boardEnabled: row.boardEnabled,
						offlineModeEnabled: row.offlineModeEnabled,
						badgeScannerEnabled: row.badgeScannerEnabled,
						badgeCameraEnabled: row.badgeCameraEnabled,
						nfcFobReaderEnabled: row.nfcFobReaderEnabled,
						status: row.status,
						pairingCodeExpiresAt: row.pairingCodeExpiresAt?.toISOString() ?? null,
						pairedAt: row.pairedAt?.toISOString() ?? null,
						lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
						revokedAt: row.revokedAt?.toISOString() ?? null,
					})),
					locations,
					organizationTimezone,
					organizationAdopted: admission === "append",
					refusals: refusals.map((row) => ({
						...row,
						claimedAt: row.claimedAt.toISOString(),
						refusedAt: row.refusedAt.toISOString(),
					})),
				};
			},
			{ refusal: KioskSettingsRefusal },
		),
);

export const createKioskAction = organizationAction(
	{ name: "kiosk.create", requires: "orgAdmin", schema: createKioskSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const locationId = yield* notFound(input.locationId, "location_not_found");
			const created = yield* storeStep(
				"kiosk.create",
				(db) =>
					withAuditTrail((audit) =>
						db.transaction((tx) =>
							createKiosk(tx, audit, {
								organizationId,
								actorUserId: actor.userId,
								name: input.name,
								locationId,
								timezone: input.timezone,
							}),
						),
					),
				{ refusal: KioskSettingsRefusal },
			);
			revalidatePath(SETTINGS_PATH);
			return {
				kioskId: created.kioskId,
				pairingCode: created.pairingCode,
				expiresAt: created.expiresAt.toISOString(),
			} satisfies IssuedPairingCodeData;
		}),
);

export const updateKioskAction = organizationAction(
	{ name: "kiosk.update", requires: "orgAdmin", schema: updateKioskSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const kioskId = yield* notFound(input.kioskId, "kiosk_not_found");
			const locationId =
				input.locationId === undefined
					? undefined
					: yield* notFound(input.locationId, "location_not_found");
			yield* storeStep(
				"kiosk.update",
				(db) =>
					withAuditTrail((audit) =>
						db.transaction((tx) =>
							updateKiosk(tx, audit, {
								organizationId,
								actorUserId: actor.userId,
								kioskId,
								change: {
									name: input.name,
									locationId,
									timezone: input.timezone,
									boardEnabled: input.boardEnabled,
									offlineModeEnabled: input.offlineModeEnabled,
									badgeScannerEnabled: input.badgeScannerEnabled,
									badgeCameraEnabled: input.badgeCameraEnabled,
									nfcFobReaderEnabled: input.nfcFobReaderEnabled,
								},
							}),
						),
					),
				{ refusal: KioskSettingsRefusal },
			);
			revalidatePath(SETTINGS_PATH);
			return { kioskId };
		}),
);

/** Issues a new pairing code; a paired kiosk's token is rotated away at once. */
export const issueKioskPairingCodeAction = organizationAction(
	{ name: "kiosk.issuePairingCode", requires: "orgAdmin", schema: kioskIdSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const kioskId = yield* notFound(input.kioskId, "kiosk_not_found");
			const issued = yield* storeStep(
				"kiosk.issuePairingCode",
				(db) =>
					withAuditTrail((audit) =>
						db.transaction((tx) =>
							issueKioskPairingCode(tx, audit, {
								organizationId,
								actorUserId: actor.userId,
								kioskId,
							}),
						),
					),
				{ refusal: KioskSettingsRefusal },
			);
			revalidatePath(SETTINGS_PATH);
			return {
				kioskId,
				pairingCode: issued.pairingCode,
				expiresAt: issued.expiresAt.toISOString(),
			} satisfies IssuedPairingCodeData;
		}),
);

export const revokeKioskAction = organizationAction(
	{ name: "kiosk.revoke", requires: "orgAdmin", schema: kioskIdSchema },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			const kioskId = yield* notFound(input.kioskId, "kiosk_not_found");
			yield* storeStep(
				"kiosk.revoke",
				(db) =>
					withAuditTrail((audit) =>
						db.transaction((tx) =>
							revokeKiosk(tx, audit, { organizationId, actorUserId: actor.userId, kioskId }),
						),
					),
				{ refusal: KioskSettingsRefusal },
			);
			revalidatePath(SETTINGS_PATH);
			return { kioskId };
		}),
);

/** A malformed ID names no row of the organization: refused as not found. */
function notFound(
	value: string,
	refusal: "kiosk_not_found" | "location_not_found",
): Effect.Effect<string, ValidationError> {
	return isUuid(value)
		? Effect.succeed(value)
		: Effect.fail(new ValidationError({ message: "Not found in this organization.", refusal }));
}
