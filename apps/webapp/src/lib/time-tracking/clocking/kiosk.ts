import "server-only";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { type employee, kiosk } from "@/db/schema";
import { isEmployeeActivelyAssignedToLocation } from "../assigned-locations/queries";
import {
	type ClockChannel,
	type CloseActiveWorkWriter,
	kioskClockWriter,
	liveClockOutWriter,
} from "../close-active-work";
import { type KioskPinVerification, verifyKioskPin } from "../kiosk/verify-kiosk-pin";
import type {
	ClockCommandAt,
	ClockCommandZone,
	ClockPosition,
	ClockPrincipal,
	ClockSubject,
	FrozenClockPayload,
	KioskPinProof,
} from "./types";

type Employee = typeof employee.$inferSelect;

/**
 * Kiosk clocking (#860, glossary "Kiosk clocking"): the employee's own clocking,
 * authorized by an active kiosk of the organization together with the
 * employee's kiosk PIN, verified in this request. The employee must be assigned
 * to the kiosk's location. Kiosk commands are immediate (the server samples
 * their instant) and take the kiosk's zone as their device zone.
 */

/** How long a PIN proof authorizes commands: one request's worth. */
const PIN_PROOF_LIFETIME_MS = 60_000;

/** Proofs this process issued, with when (monotonic) it issued them. */
const issuedProofs = new WeakMap<KioskPinProof, number>();

/**
 * Checks an employee's kiosk PIN at a kiosk and, when it is right, issues the
 * proof a kiosk principal carries. Failures count toward the employee's
 * lockout (#857); the per-kiosk attempt limit is the caller's.
 */
export async function proveKioskPin(
	input: { organizationId: string; kioskId: string; employeeId: string; pin: string },
	verify: (
		organizationId: string,
		employeeId: string,
		pin: string,
	) => Promise<KioskPinVerification> = verifyKioskPin,
): Promise<
	{ status: "verified"; proof: KioskPinProof } | Exclude<KioskPinVerification, { status: "verified" }>
> {
	const verification = await verify(input.organizationId, input.employeeId, input.pin);
	if (verification.status !== "verified") return verification;
	const proof: KioskPinProof = Object.freeze({
		organizationId: input.organizationId,
		kioskId: input.kioskId,
		employeeId: input.employeeId,
	});
	issuedProofs.set(proof, performance.now());
	return { status: "verified", proof };
}

function isLiveProof(proof: KioskPinProof, expected: KioskPinProof) {
	const issuedAt = issuedProofs.get(proof);
	return (
		issuedAt !== undefined &&
		performance.now() - issuedAt <= PIN_PROOF_LIFETIME_MS &&
		proof.organizationId === expected.organizationId &&
		proof.kioskId === expected.kioskId &&
		proof.employeeId === expected.employeeId
	);
}

/** The receipt writer of a command: a kiosk's own, else its channel's. */
export function clockWriterOf(command: {
	principal: ClockPrincipal;
	channel: ClockChannel;
}): CloseActiveWorkWriter {
	return command.principal.kind === "kiosk"
		? kioskClockWriter(command.principal.kioskId)
		: liveClockOutWriter(command.channel);
}

/**
 * The kiosk a kiosk command's receipt command names, so the same identity from
 * another kiosk is a collision rather than a replay.
 */
export function kioskReceiptEvidence(command: { principal: ClockPrincipal }): {
	kioskId?: string;
} {
	return command.principal.kind === "kiosk" ? { kioskId: command.principal.kioskId } : {};
}

/** What the kiosk branch of authorization reads of a command, besides its subject. */
export type KioskAuthorizationQuery = {
	organizationId: string;
	principal: ClockPrincipal;
	subject: ClockSubject;
	/** Absent for a lookup, which a kiosk never answers. */
	kind?: string;
	channel?: ClockChannel;
	at?: ClockCommandAt;
	zone?: ClockCommandZone;
	payload?: FrozenClockPayload;
	legacy?: true;
	position?: ClockPosition;
};

/**
 * The kiosk channel is the kiosk principal's alone, and the kiosk principal
 * runs only immediate, live commands on it, in the kiosk's own zone.
 */
function isKioskCommandShape(query: KioskAuthorizationQuery) {
	return (
		query.kind !== undefined &&
		!query.subject.onBehalf &&
		query.channel === "kiosk" &&
		query.at?.kind === "now" &&
		query.payload === undefined &&
		query.legacy === undefined &&
		query.position === undefined
	);
}

/** Whether a command claims the kiosk channel or principal at all. */
export function isKioskCommand(query: Pick<KioskAuthorizationQuery, "principal" | "channel">) {
	return query.principal.kind === "kiosk" || query.channel === "kiosk";
}

/**
 * The subject of a kiosk command when every kiosk condition holds, else null:
 * the kiosk principal on the kiosk channel, a live PIN proof issued for this
 * kiosk and employee, an active (paired, unrevoked) kiosk of the command's
 * organization whose zone is the command's device zone, and the employee's own
 * record, active and assigned to the kiosk's location.
 */
export async function authorizedKioskSubject(
	query: KioskAuthorizationQuery,
	row: Employee,
): Promise<Employee | null> {
	const { principal } = query;
	if (principal.kind !== "kiosk" || !isKioskCommandShape(query)) return null;
	if (row.userId !== principal.userId) return null;
	if (
		!isLiveProof(principal.pin, {
			organizationId: query.organizationId,
			kioskId: principal.kioskId,
			employeeId: row.id,
		})
	) {
		return null;
	}
	const [active] = await db
		.select({ locationId: kiosk.locationId, timezone: kiosk.timezone })
		.from(kiosk)
		.where(
			and(
				eq(kiosk.id, principal.kioskId),
				eq(kiosk.organizationId, query.organizationId),
				isNull(kiosk.revokedAt),
				isNotNull(kiosk.tokenHash),
			),
		)
		.limit(1);
	if (!active || query.zone?.device !== active.timezone) return null;
	const assigned = await isEmployeeActivelyAssignedToLocation(db, {
		organizationId: query.organizationId,
		employeeId: row.id,
		locationId: active.locationId,
	});
	return assigned ? row : null;
}
