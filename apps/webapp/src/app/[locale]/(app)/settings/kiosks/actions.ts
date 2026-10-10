"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { location } from "@/db/schema";
import { requireOrganizationAdmin } from "@/lib/auth/current-organization-actor";
import { runRefusalAction } from "@/lib/effect/refusal-action";
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
import { isUuid } from "@/lib/validations/uuid";

export type KioskData = {
	id: string;
	name: string;
	locationId: string;
	locationName: string;
	timezone: string;
	boardEnabled: boolean;
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
};

const SETTINGS_PATH = "/settings/kiosks";

export async function getKioskAdminDataAction(): Promise<
	KioskSettingsActionResult<KioskAdminData>
> {
	return runRefusalAction("kiosk.adminData", KioskSettingsRefusal, async (db) => {
		const { organizationId } = await requireKioskAdmin();
		const [kiosks, locations] = await Promise.all([
			listKiosks(db, organizationId),
			db
				.select({ id: location.id, name: location.name })
				.from(location)
				.where(and(eq(location.organizationId, organizationId), eq(location.isActive, true)))
				.orderBy(asc(location.name)),
		]);
		return {
			kiosks: kiosks.map((row) => ({
				id: row.id,
				name: row.name,
				locationId: row.locationId,
				locationName: row.locationName,
				timezone: row.timezone,
				boardEnabled: row.boardEnabled,
				status: row.status,
				pairingCodeExpiresAt: row.pairingCodeExpiresAt?.toISOString() ?? null,
				pairedAt: row.pairedAt?.toISOString() ?? null,
				lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
				revokedAt: row.revokedAt?.toISOString() ?? null,
			})),
			locations,
		};
	});
}

export async function createKioskAction(
	input: CreateKioskInput,
): Promise<KioskSettingsActionResult<IssuedPairingCodeData>> {
	return runRefusalAction("kiosk.create", KioskSettingsRefusal, async (db) => {
		const { organizationId, userId } = await requireKioskAdmin();
		const locationId = parseUuid(input?.locationId, "location_not_found");
		const created = await db.transaction((tx) =>
			createKiosk(tx, {
				organizationId,
				actorUserId: userId,
				name: input?.name,
				locationId,
				timezone: input?.timezone,
			}),
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
		await db.transaction((tx) =>
			updateKiosk(tx, {
				organizationId,
				actorUserId: userId,
				kioskId,
				change: {
					name: input.name,
					locationId,
					timezone: input.timezone,
					boardEnabled: input.boardEnabled,
				},
			}),
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
		const issued = await db.transaction((tx) =>
			issueKioskPairingCode(tx, { organizationId, actorUserId: userId, kioskId }),
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
		await db.transaction((tx) => revokeKiosk(tx, { organizationId, actorUserId: userId, kioskId }));
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
