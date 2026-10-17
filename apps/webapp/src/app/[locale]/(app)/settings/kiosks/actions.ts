"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { location } from "@/db/schema";
import { withAuditTrail } from "@/lib/audit-trail";
import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import type { KioskTimeSource } from "@/lib/time-tracking/clocking/types";
import type {
	KioskFrozenAction,
	KioskFrozenRefusalReason,
} from "@/lib/time-tracking/kiosk/frozen-command";
import { listKioskFrozenRefusals } from "@/lib/time-tracking/kiosk/frozen-refusal-store";
import {
	type KioskSettingsActionResult,
	KioskSettingsRefusal,
} from "@/lib/time-tracking/kiosk/kiosk-settings-errors";
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
};

const SETTINGS_PATH = "/settings/kiosks";

export async function getKioskAdminDataAction(): Promise<
	KioskSettingsActionResult<KioskAdminData>
> {
	return runRefusalAction("kiosk.adminData", KioskSettingsRefusal, async (db) => {
		const { organizationId } = await requireKioskAdmin();
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
	});
}

export async function createKioskAction(
	input: CreateKioskInput,
): Promise<KioskSettingsActionResult<IssuedPairingCodeData>> {
	return runRefusalAction("kiosk.create", KioskSettingsRefusal, async (db) => {
		const { organizationId, userId } = await requireKioskAdmin();
		const locationId = parseUuid(input?.locationId, "location_not_found");
		const created = await withAuditTrail((audit) =>
			db.transaction((tx) =>
				createKiosk(tx, audit, {
					organizationId,
					actorUserId: userId,
					name: input?.name,
					locationId,
					timezone: input?.timezone,
				}),
			),
		);
		revalidatePath(SETTINGS_PATH);
		return {
			kioskId: created.kioskId,
			pairingCode: created.pairingCode,
			expiresAt: created.expiresAt.toISOString(),
		};
	});
}

export async function updateKioskAction(
	input: UpdateKioskInput,
): Promise<KioskSettingsActionResult<{ kioskId: string }>> {
	return runRefusalAction("kiosk.update", KioskSettingsRefusal, async (db) => {
		const { organizationId, userId } = await requireKioskAdmin();
		const kioskId = parseUuid(input?.kioskId, "kiosk_not_found");
		const locationId =
			input?.locationId === undefined
				? undefined
				: parseUuid(input.locationId, "location_not_found");
		if (input?.boardEnabled !== undefined && typeof input.boardEnabled !== "boolean") {
			throw new KioskSettingsRefusal("invalid_selection", "The board switch must be on or off.");
		}
		if (input?.offlineModeEnabled !== undefined && typeof input.offlineModeEnabled !== "boolean") {
			throw new KioskSettingsRefusal("invalid_selection", "Offline mode must be on or off.");
		}
		if (
			input?.badgeScannerEnabled !== undefined &&
			typeof input.badgeScannerEnabled !== "boolean"
		) {
			throw new KioskSettingsRefusal("invalid_selection", "Scanner input must be on or off.");
		}
		if (input?.badgeCameraEnabled !== undefined && typeof input.badgeCameraEnabled !== "boolean") {
			throw new KioskSettingsRefusal("invalid_selection", "Camera input must be on or off.");
		}
		await withAuditTrail((audit) =>
			db.transaction((tx) =>
				updateKiosk(tx, audit, {
					organizationId,
					actorUserId: userId,
					kioskId,
					change: {
						name: input.name,
						locationId,
						timezone: input.timezone,
						boardEnabled: input.boardEnabled,
						offlineModeEnabled: input.offlineModeEnabled,
						badgeScannerEnabled: input.badgeScannerEnabled,
						badgeCameraEnabled: input.badgeCameraEnabled,
					},
				}),
			),
		);
		revalidatePath(SETTINGS_PATH);
		return { kioskId };
	});
}

/** Issues a new pairing code; a paired kiosk's token is rotated away at once. */
export async function issueKioskPairingCodeAction(input: {
	kioskId: string;
}): Promise<KioskSettingsActionResult<IssuedPairingCodeData>> {
	return runRefusalAction("kiosk.issuePairingCode", KioskSettingsRefusal, async (db) => {
		const { organizationId, userId } = await requireKioskAdmin();
		const kioskId = parseUuid(input?.kioskId, "kiosk_not_found");
		const issued = await withAuditTrail((audit) =>
			db.transaction((tx) =>
				issueKioskPairingCode(tx, audit, { organizationId, actorUserId: userId, kioskId }),
			),
		);
		revalidatePath(SETTINGS_PATH);
		return { kioskId, pairingCode: issued.pairingCode, expiresAt: issued.expiresAt.toISOString() };
	});
}

export async function revokeKioskAction(input: {
	kioskId: string;
}): Promise<KioskSettingsActionResult<{ kioskId: string }>> {
	return runRefusalAction("kiosk.revoke", KioskSettingsRefusal, async (db) => {
		const { organizationId, userId } = await requireKioskAdmin();
		const kioskId = parseUuid(input?.kioskId, "kiosk_not_found");
		await withAuditTrail((audit) =>
			db.transaction((tx) =>
				revokeKiosk(tx, audit, { organizationId, actorUserId: userId, kioskId }),
			),
		);
		revalidatePath(SETTINGS_PATH);
		return { kioskId };
	});
}

/** Organization owners and admins of the active organization only. */
function requireKioskAdmin() {
	return requireOrganizationAdmin(
		() =>
			new KioskSettingsRefusal(
				"admin_only",
				"Only organization owners and admins can manage kiosks.",
			),
	);
}

function parseUuid(value: unknown, code: "kiosk_not_found" | "location_not_found"): string {
	if (!isUuid(value)) throw new KioskSettingsRefusal(code, "Not found in this organization.");
	return value;
}
