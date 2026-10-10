import "server-only";

import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { auditLog, kiosk, location, organizationNotificationSettings } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { type Clock, dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { parseIanaTimeZone } from "@/lib/timezone/validation";
import { ALL_LANGUAGES, DEFAULT_LANGUAGE } from "@/tolgee/shared";
import {
	formatPairingCode,
	generateDeviceToken,
	generatePairingCode,
	hashKioskSecret,
	normalizePairingCode,
	PAIRING_CODE_TTL_MS,
} from "./credentials";
import { KioskSettingsRefusal } from "./kiosk-settings-errors";
import type { KioskDeviceInfo } from "./protocol";

/**
 * Kiosk enrolment writes and reads (#859). Management functions take the
 * caller's client (a transaction, so each write and its audit entry commit
 * together) and are always filtered by `organizationId`. Pairing is the one
 * write without an organization: the pairing code itself names the kiosk.
 */
export type KioskClient = Pick<DatabaseClient, "select" | "insert" | "update">;

export const KIOSK_NAME_MAX_LENGTH = 100;

export type KioskStatus = "awaiting_pairing" | "paired" | "revoked";

export type KioskListing = {
	id: string;
	name: string;
	locationId: string;
	locationName: string;
	timezone: string;
	boardEnabled: boolean;
	status: KioskStatus;
	pairingCodeExpiresAt: Date | null;
	pairedAt: Date | null;
	lastSeenAt: Date | null;
	revokedAt: Date | null;
	createdAt: Date;
};

export type IssuedPairingCode = {
	/** Shown once to the admin, as text and as a QR code: `ABCDE-FGHJK`. */
	pairingCode: string;
	expiresAt: Date;
};

type Actor = { organizationId: string; actorUserId: string };

function parseKioskName(value: unknown): string {
	const name = typeof value === "string" ? value.trim() : "";
	if (name.length === 0 || name.length > KIOSK_NAME_MAX_LENGTH) {
		throw new KioskSettingsRefusal("invalid_name", "A kiosk name has 1 to 100 characters.");
	}
	return name;
}

function parseKioskZone(value: unknown): string {
	try {
		return parseIanaTimeZone(value);
	} catch {
		throw new KioskSettingsRefusal("invalid_timezone", "Choose a named IANA time zone.");
	}
}

async function requireOrganizationLocation(
	client: KioskClient,
	organizationId: string,
	locationId: string,
): Promise<{ id: string; name: string }> {
	const [found] = await client
		.select({ id: location.id, name: location.name })
		.from(location)
		.where(
			and(
				eq(location.organizationId, organizationId),
				eq(location.id, locationId),
				eq(location.isActive, true),
			),
		)
		.limit(1);
	if (!found) {
		throw new KioskSettingsRefusal(
			"location_not_found",
			"Location not found in this organization.",
		);
	}
	return found;
}

function newPairingCode(clock: Clock): { code: string; hash: string; expiresAt: Date } {
	const code = generatePairingCode();
	const expiresAt = dateFromInstant(clock.nowInstant().add({ milliseconds: PAIRING_CODE_TTL_MS }));
	return { code: formatPairingCode(code), hash: hashKioskSecret(code), expiresAt };
}

/** The kiosks of an organization, revoked ones included, ordered by name. */
export async function listKiosks(
	client: KioskClient,
	organizationId: string,
): Promise<KioskListing[]> {
	const rows = await client
		.select({
			id: kiosk.id,
			name: kiosk.name,
			locationId: kiosk.locationId,
			locationName: location.name,
			timezone: kiosk.timezone,
			boardEnabled: kiosk.boardEnabled,
			hasToken: kiosk.tokenHash,
			pairingCodeExpiresAt: kiosk.pairingCodeExpiresAt,
			pairedAt: kiosk.pairedAt,
			lastSeenAt: kiosk.lastSeenAt,
			revokedAt: kiosk.revokedAt,
			createdAt: kiosk.createdAt,
		})
		.from(kiosk)
		.innerJoin(
			location,
			and(eq(location.id, kiosk.locationId), eq(location.organizationId, kiosk.organizationId)),
		)
		.where(eq(kiosk.organizationId, organizationId))
		.orderBy(asc(kiosk.name), asc(kiosk.createdAt));
	return rows.map(({ hasToken, ...row }) => ({
		...row,
		status: row.revokedAt ? "revoked" : hasToken ? "paired" : "awaiting_pairing",
	}));
}

/** Creates a kiosk on a location of the organization and issues its first pairing code. */
export async function createKiosk(
	tx: KioskClient,
	input: Actor & { name: unknown; locationId: string; timezone: unknown },
	clock: Clock = systemClock,
): Promise<IssuedPairingCode & { kioskId: string }> {
	const name = parseKioskName(input.name);
	const timezone = parseKioskZone(input.timezone);
	const site = await requireOrganizationLocation(tx, input.organizationId, input.locationId);
	const pairing = newPairingCode(clock);

	const [created] = await tx
		.insert(kiosk)
		.values({
			organizationId: input.organizationId,
			locationId: site.id,
			name,
			timezone,
			pairingCodeHash: pairing.hash,
			pairingCodeExpiresAt: pairing.expiresAt,
			pairingCodeIssuedBy: input.actorUserId,
			createdBy: input.actorUserId,
			updatedBy: input.actorUserId,
		})
		.returning({ id: kiosk.id });

	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "kiosk",
		entityId: created.id,
		action: AuditAction.KIOSK_CREATED,
		performedBy: input.actorUserId,
		changes: JSON.stringify({
			from: null,
			to: { name, locationId: site.id, timezone, boardEnabled: false },
		}),
	});

	return { kioskId: created.id, pairingCode: pairing.code, expiresAt: pairing.expiresAt };
}

async function lockManagedKiosk(tx: KioskClient, organizationId: string, kioskId: string) {
	const [found] = await tx
		.select({
			id: kiosk.id,
			name: kiosk.name,
			locationId: kiosk.locationId,
			timezone: kiosk.timezone,
			boardEnabled: kiosk.boardEnabled,
			tokenHash: kiosk.tokenHash,
			revokedAt: kiosk.revokedAt,
		})
		.from(kiosk)
		.where(and(eq(kiosk.organizationId, organizationId), eq(kiosk.id, kioskId)))
		.for("update")
		.limit(1);
	if (!found) throw new KioskSettingsRefusal("kiosk_not_found", "Kiosk not found.");
	if (found.revokedAt) throw new KioskSettingsRefusal("kiosk_revoked", "This kiosk is revoked.");
	return found;
}

export type KioskConfigurationChange = Partial<{
	name: unknown;
	locationId: string;
	timezone: unknown;
	boardEnabled: boolean;
}>;

/** Renames a kiosk, moves it to another location of the organization, changes its zone or board. */
export async function updateKiosk(
	tx: KioskClient,
	input: Actor & { kioskId: string; change: KioskConfigurationChange },
): Promise<void> {
	const current = await lockManagedKiosk(tx, input.organizationId, input.kioskId);
	const { change } = input;
	const next = {
		name: change.name === undefined ? current.name : parseKioskName(change.name),
		timezone: change.timezone === undefined ? current.timezone : parseKioskZone(change.timezone),
		locationId:
			change.locationId === undefined
				? current.locationId
				: (await requireOrganizationLocation(tx, input.organizationId, change.locationId)).id,
		boardEnabled: change.boardEnabled === undefined ? current.boardEnabled : change.boardEnabled,
	};
	const from: Record<string, unknown> = {};
	const to: Record<string, unknown> = {};
	for (const key of ["name", "timezone", "locationId", "boardEnabled"] as const) {
		if (next[key] !== current[key]) {
			from[key] = current[key];
			to[key] = next[key];
		}
	}
	if (Object.keys(to).length === 0) return;

	await tx
		.update(kiosk)
		.set({ ...next, updatedAt: new Date(), updatedBy: input.actorUserId })
		.where(and(eq(kiosk.organizationId, input.organizationId), eq(kiosk.id, input.kioskId)));
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "kiosk",
		entityId: input.kioskId,
		action: AuditAction.KIOSK_UPDATED,
		performedBy: input.actorUserId,
		changes: JSON.stringify({ from, to }),
	});
}

/**
 * Issues a new pairing code for a kiosk. A paired kiosk's device token stops
 * working at once (this is how a token is rotated); the device, or a
 * replacement, pairs again with the new code.
 */
export async function issueKioskPairingCode(
	tx: KioskClient,
	input: Actor & { kioskId: string },
	clock: Clock = systemClock,
): Promise<IssuedPairingCode> {
	const current = await lockManagedKiosk(tx, input.organizationId, input.kioskId);
	const pairing = newPairingCode(clock);
	await tx
		.update(kiosk)
		.set({
			tokenHash: null,
			pairedAt: null,
			pairingCodeHash: pairing.hash,
			pairingCodeExpiresAt: pairing.expiresAt,
			pairingCodeIssuedBy: input.actorUserId,
			updatedAt: new Date(),
			updatedBy: input.actorUserId,
		})
		.where(and(eq(kiosk.organizationId, input.organizationId), eq(kiosk.id, input.kioskId)));
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "kiosk",
		entityId: input.kioskId,
		action: current.tokenHash
			? AuditAction.KIOSK_TOKEN_ROTATED
			: AuditAction.KIOSK_PAIRING_CODE_ISSUED,
		performedBy: input.actorUserId,
		metadata: JSON.stringify({ pairingCodeExpiresAt: pairing.expiresAt.toISOString() }),
	});
	return { pairingCode: pairing.code, expiresAt: pairing.expiresAt };
}

/**
 * Revokes a kiosk for good: its next request is refused. The token hash stays
 * so the device can be told it was revoked; any open pairing code is dropped.
 */
export async function revokeKiosk(tx: KioskClient, input: Actor & { kioskId: string }) {
	await lockManagedKiosk(tx, input.organizationId, input.kioskId);
	const now = new Date();
	await tx
		.update(kiosk)
		.set({
			revokedAt: now,
			revokedBy: input.actorUserId,
			pairingCodeHash: null,
			pairingCodeExpiresAt: null,
			updatedAt: now,
			updatedBy: input.actorUserId,
		})
		.where(and(eq(kiosk.organizationId, input.organizationId), eq(kiosk.id, input.kioskId)));
	await tx.insert(auditLog).values({
		organizationId: input.organizationId,
		entityType: "kiosk",
		entityId: input.kioskId,
		action: AuditAction.KIOSK_REVOKED,
		performedBy: input.actorUserId,
	});
}

/** An active, paired kiosk as its device token resolves it. */
export type PairedKiosk = {
	kioskId: string;
	organizationId: string;
	locationId: string;
	name: string;
	/** IANA zone: the device zone of the kiosk's clock commands. */
	timezone: string;
	boardEnabled: boolean;
};

/** What the device may show about the kiosk it authenticated as. */
export async function readKioskDeviceInfo(
	client: KioskClient,
	authenticated: PairedKiosk,
): Promise<KioskDeviceInfo> {
	const [site] = await client
		.select({ name: location.name, language: organizationNotificationSettings.defaultLanguage })
		.from(location)
		.leftJoin(
			organizationNotificationSettings,
			eq(organizationNotificationSettings.organizationId, location.organizationId),
		)
		.where(
			and(
				eq(location.organizationId, authenticated.organizationId),
				eq(location.id, authenticated.locationId),
			),
		)
		.limit(1);
	return {
		id: authenticated.kioskId,
		name: authenticated.name,
		locationId: authenticated.locationId,
		locationName: site?.name ?? "",
		timezone: authenticated.timezone,
		boardEnabled: authenticated.boardEnabled,
		language: kioskLanguage(site?.language),
	};
}

/** The kiosk opens in its organization's default language (#862), English when none is usable. */
function kioskLanguage(language: string | null | undefined): string {
	return language && ALL_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

export type KioskPairingOutcome =
	| { status: "paired"; token: string; kiosk: PairedKiosk }
	| { status: "invalid_code" };

/**
 * Exchanges a pairing code for a new device token. The code is consumed
 * atomically: an expired, used, wrong or revoked kiosk's code is refused the
 * same way. The pairing is audited as the admin who issued the code.
 */
export async function pairKiosk(
	tx: KioskClient,
	input: { code: unknown; ipAddress?: string | null; userAgent?: string | null },
	clock: Clock = systemClock,
): Promise<KioskPairingOutcome> {
	const code = normalizePairingCode(input.code);
	if (!code) return { status: "invalid_code" };
	const token = generateDeviceToken();
	const now = dateFromInstant(clock.nowInstant());

	const [paired] = await tx
		.update(kiosk)
		.set({
			tokenHash: hashKioskSecret(token),
			pairedAt: now,
			lastSeenAt: now,
			pairingCodeHash: null,
			pairingCodeExpiresAt: null,
		})
		.where(
			and(
				eq(kiosk.pairingCodeHash, hashKioskSecret(code)),
				gt(kiosk.pairingCodeExpiresAt, now),
				isNull(kiosk.revokedAt),
			),
		)
		.returning({
			kioskId: kiosk.id,
			organizationId: kiosk.organizationId,
			locationId: kiosk.locationId,
			name: kiosk.name,
			timezone: kiosk.timezone,
			boardEnabled: kiosk.boardEnabled,
			issuedBy: kiosk.pairingCodeIssuedBy,
			createdBy: kiosk.createdBy,
		});
	if (!paired) return { status: "invalid_code" };

	const { issuedBy, createdBy, ...pairedKiosk } = paired;
	await tx.insert(auditLog).values({
		organizationId: paired.organizationId,
		entityType: "kiosk",
		entityId: paired.kioskId,
		action: AuditAction.KIOSK_PAIRED,
		performedBy: issuedBy ?? createdBy,
		metadata: JSON.stringify({ pairedBy: "kiosk_device", pairingCodeIssuedBy: issuedBy }),
		ipAddress: input.ipAddress ?? null,
		userAgent: input.userAgent ?? null,
	});
	return { status: "paired", token, kiosk: pairedKiosk };
}
