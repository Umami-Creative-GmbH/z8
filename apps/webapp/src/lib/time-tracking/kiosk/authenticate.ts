import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { kiosk, kioskRetiredToken } from "@/db/schema";
import { type Clock, dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { hashKioskSecret } from "./credentials";
import type { KioskClient, PairedKiosk } from "./kiosk-store";
import { KIOSK_TOKEN_HEADER, type KioskRefusalCode } from "./protocol";

/**
 * Kiosk authentication (#859). Every kiosk request carries the device token in
 * the `x-kiosk-token` header (see `protocol.ts`). It is deliberately not
 * `Authorization: Bearer`, which Better Auth's bearer plugin turns into a user
 * session. Kiosk endpoints live under `/api/kiosk/*`, which the proxy and the
 * service worker leave alone.
 */
export { KIOSK_TOKEN_HEADER };

/** The kiosk a request authenticated as. All later queries filter by its organization. */
export type AuthenticatedKiosk = PairedKiosk;

/**
 * Why a kiosk request was refused: `unknown` for a missing, wrong, rotated-away
 * or re-paired token (the device should pair again), `revoked` for a token of a
 * revoked kiosk (the device shows "kiosk revoked, contact your admin").
 */
export type KioskAuthenticationRefusal = "unknown" | "revoked";

export type KioskAuthentication =
	| { ok: true; kiosk: AuthenticatedKiosk }
	| { ok: false; reason: KioskAuthenticationRefusal };

/** The columns every authenticated kiosk is read with. */
const pairedKioskColumns = {
	kioskId: kiosk.id,
	organizationId: kiosk.organizationId,
	locationId: kiosk.locationId,
	name: kiosk.name,
	timezone: kiosk.timezone,
	boardEnabled: kiosk.boardEnabled,
};

/** The stored hash of a device token, or null when the value cannot be one. */
function kioskTokenHash(token: string | null | undefined): string | null {
	if (typeof token !== "string" || token.length === 0 || token.length > 256) return null;
	return hashKioskSecret(token);
}

/**
 * The kiosk a token hash names on `kiosk`: active (and now seen), revoked, or
 * none. One lookup behind both online authentication and frozen commands.
 */
async function lookUpKioskToken(
	tokenHash: string,
	options: { client?: KioskClient; clock?: Clock },
): Promise<{ status: "active" | "revoked"; kiosk: AuthenticatedKiosk } | null> {
	const client = options.client ?? db;
	const now = dateFromInstant((options.clock ?? systemClock).nowInstant());
	const [active] = await client
		.update(kiosk)
		.set({ lastSeenAt: now })
		.where(and(eq(kiosk.tokenHash, tokenHash), isNull(kiosk.revokedAt)))
		.returning(pairedKioskColumns);
	if (active) return { status: "active", kiosk: active };
	const [revoked] = await client
		.select(pairedKioskColumns)
		.from(kiosk)
		.where(eq(kiosk.tokenHash, tokenHash))
		.limit(1);
	return revoked ? { status: "revoked", kiosk: revoked } : null;
}

/**
 * Resolves a device token to its active kiosk and records that the kiosk was
 * seen. Revocation, rotation and re-pairing take effect on the next call.
 */
export async function resolveKioskFromToken(
	token: string | null | undefined,
	options: { client?: KioskClient; clock?: Clock } = {},
): Promise<KioskAuthentication> {
	const tokenHash = kioskTokenHash(token);
	const found = tokenHash ? await lookUpKioskToken(tokenHash, options) : null;
	if (found?.status === "active") return { ok: true, kiosk: found.kiosk };
	return { ok: false, reason: found ? "revoked" : "unknown" };
}

/**
 * The kiosk a frozen command's token names (#1289). An active kiosk is seen as
 * by `resolveKioskFromToken`. A revoked kiosk's token, and a token rotated away
 * (`kiosk_retired_token`), still name their kiosk, so the commands that kiosk
 * queued offline are refused and listed for it rather than dropped as unknown.
 */
export type FrozenCommandKiosk =
	| { status: "active"; kiosk: AuthenticatedKiosk; tokenHash: string }
	| { status: "revoked" | "rotated"; kiosk: AuthenticatedKiosk; tokenHash: string }
	| { status: "unknown" };

export async function resolveFrozenCommandKiosk(
	token: string | null | undefined,
	options: { client?: KioskClient; clock?: Clock } = {},
): Promise<FrozenCommandKiosk> {
	const tokenHash = kioskTokenHash(token);
	if (!tokenHash) return { status: "unknown" };
	const found = await lookUpKioskToken(tokenHash, options);
	if (found) return { ...found, tokenHash };
	const [rotated] = await (options.client ?? db)
		.select(pairedKioskColumns)
		.from(kioskRetiredToken)
		.innerJoin(
			kiosk,
			and(
				eq(kiosk.id, kioskRetiredToken.kioskId),
				eq(kiosk.organizationId, kioskRetiredToken.organizationId),
			),
		)
		.where(eq(kioskRetiredToken.tokenHash, tokenHash))
		.limit(1);
	return rotated ? { status: "rotated", kiosk: rotated, tokenHash } : { status: "unknown" };
}

/** Resolves the kiosk of a request from its `x-kiosk-token` header. */
export function resolveKioskFromRequest(
	request: Request,
	options: { client?: KioskClient; clock?: Clock } = {},
): Promise<KioskAuthentication> {
	return resolveKioskFromToken(request.headers.get(KIOSK_TOKEN_HEADER), options);
}

/** The 401 a kiosk endpoint answers a refused token with; the device reads `code`. */
export function kioskRefusalResponse(reason: KioskAuthenticationRefusal): Response {
	const code: KioskRefusalCode = reason === "revoked" ? "kiosk_revoked" : "kiosk_unknown";
	return Response.json(
		{ error: reason === "revoked" ? "Kiosk revoked" : "Kiosk not paired", code },
		{ status: 401, headers: { "Cache-Control": "no-store" } },
	);
}
