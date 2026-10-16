import "server-only";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { type employee, kiosk } from "@/db/schema";
import { type Clock, compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import { isEmployeeActivelyAssignedToLocation } from "../assigned-locations/queries";
import {
	type ClockChannel,
	type CloseActiveWorkWriter,
	kioskClockWriter,
	liveClockOutWriter,
} from "../close-active-work";
import { judgeKioskPinAttempt, type KioskPinAttempt } from "../kiosk/pin-store";
import { type KioskPinVerification, verifyKioskPin } from "../kiosk/verify-kiosk-pin";
import type {
	ClockCommandAt,
	ClockCommandFreshness,
	ClockCommandZone,
	ClockPosition,
	ClockPrincipal,
	ClockSubject,
	FrozenClockPayload,
	KioskPinProof,
	KioskTimeSource,
} from "./types";

type Employee = typeof employee.$inferSelect;

/**
 * Kiosk clocking (#860, glossary "Kiosk clocking"): the employee's own clocking,
 * authorized by an active kiosk of the organization together with the
 * employee's kiosk PIN, verified in this request. The employee must be assigned
 * to the kiosk's location. Kiosk commands are immediate (the server samples
 * their instant) and take the kiosk's zone as their device zone, except frozen
 * kiosk commands (#1289, offline kiosk clocking): queued on an offline kiosk,
 * they carry their occurred instant and payload, and their PIN is checked when
 * they arrive (ADR 0011).
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
	| { status: "verified"; proof: KioskPinProof }
	| Exclude<KioskPinVerification, { status: "verified" }>
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

/** A frozen kiosk command's PIN attempt: the sealed PIN, opened only when it is checked. */
export type FrozenKioskPinAttempt = {
	organizationId: string;
	kioskId: string;
	employeeId: string;
	operationId: string;
	occurredAt: Instant;
	timeSource: KioskTimeSource;
	pin: () => string | Promise<string>;
};

/**
 * Judges a frozen kiosk command's PIN on arrival (#1289, ADR 0011) at the
 * instant the command claims, as the lockout stood then (#1288), against the
 * employee's current PIN, in its own short transaction that commits the attempt
 * whatever Clocking then does: the PIN row's lock is released before any work
 * transaction starts, so it never takes a place in the work transaction's
 * acquisition order. When the PIN is right, issues the proof of that one
 * command. Queued attempts never count toward the online per-kiosk limit.
 */
export async function proveFrozenKioskPin(
	attempt: FrozenKioskPinAttempt,
	clock: Clock,
	judge: (attempt: KioskPinAttempt, clock: Clock) => Promise<KioskPinVerification> = (
		input,
		judgeClock,
	) => db.transaction((tx) => judgeKioskPinAttempt(tx, input, judgeClock)),
): Promise<
	| { status: "verified"; proof: KioskPinProof }
	| Exclude<KioskPinVerification, { status: "verified" }>
> {
	const verification = await judge(
		{
			organizationId: attempt.organizationId,
			employeeId: attempt.employeeId,
			at: attempt.occurredAt,
			offline: true,
			pin: attempt.pin,
		},
		clock,
	);
	if (verification.status !== "verified") return verification;
	const proof: KioskPinProof = Object.freeze({
		organizationId: attempt.organizationId,
		kioskId: attempt.kioskId,
		employeeId: attempt.employeeId,
		frozen: Object.freeze({
			operationId: attempt.operationId,
			occurredAt: attempt.occurredAt,
			timeSource: attempt.timeSource,
		}),
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
		? kioskClockWriter(command.principal.kioskId, command.principal.pin.frozen?.timeSource)
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
	freshness?: ClockCommandFreshness;
	payload?: FrozenClockPayload;
	legacy?: true;
	position?: ClockPosition;
};

/**
 * The kiosk channel is the kiosk principal's alone, and the kiosk principal
 * runs on it, in the kiosk's own zone, either immediate, live commands, or
 * (#1289) the one frozen command its frozen PIN proof names: occurred at the
 * proof's instant, with that command's payload and an age window. Never on
 * behalf, never legacy, never with a position.
 */
function isKioskCommandShape(query: KioskAuthorizationQuery, proof: KioskPinProof) {
	if (
		query.kind === undefined ||
		query.subject.onBehalf ||
		query.channel !== "kiosk" ||
		query.legacy !== undefined ||
		query.position !== undefined
	) {
		return false;
	}
	const { frozen } = proof;
	if (!frozen) return query.at?.kind === "now" && query.payload === undefined;
	return (
		query.at?.kind === "occurred" &&
		compareInstants(query.at.instant, frozen.occurredAt) === 0 &&
		query.payload !== undefined &&
		query.payload.operationId === frozen.operationId &&
		query.freshness !== undefined
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
	if (principal.kind !== "kiosk" || !isKioskCommandShape(query, principal.pin)) return null;
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
