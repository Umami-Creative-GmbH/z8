import "server-only";

import { db } from "@/db";
import { type Clock, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { proveKioskPin } from "@/lib/time-tracking/clocking/kiosk";
import type { KioskEmployeeProof } from "@/lib/time-tracking/clocking/types";
import type { AuthenticatedKiosk } from "./authenticate";
import { type KioskEmployee, readKioskEmployee } from "./kiosk-employee";
import { json } from "./kiosk-http";
import type { KioskPinVerification } from "./verify-kiosk-pin";

export type KioskPinAdmissionDeps = {
	clock: Clock;
	/** The per-kiosk PIN attempt limit (#860); every PIN-carrying call counts. */
	limitPinAttempts(kioskId: string): Promise<{ allowed: boolean; retryAfter: number }>;
	verifyPin?: (
		organizationId: string,
		employeeId: string,
		pin: string,
	) => Promise<KioskPinVerification>;
};

/**
 * The employee a kiosk PIN proves (#860), for clocking and for a fob
 * registration (#1505): within the kiosk's PIN attempt limit (429
 * `rate_limited`), an employee active and assigned to the kiosk's location
 * (403 with `notAssignedCode`, no PIN attempt), then their PIN, counted toward
 * their lockout (423 `pin_locked`, 403 `wrong_pin` / `no_pin`).
 */
export async function admitKioskPin(
	deps: KioskPinAdmissionDeps,
	kiosk: AuthenticatedKiosk,
	body: { employeeId: string; pin: string },
	notAssignedCode: string,
): Promise<{ response: Response } | { employee: KioskEmployee; proof: KioskEmployeeProof }> {
	const limit = await deps.limitPinAttempts(kiosk.kioskId);
	if (!limit.allowed) {
		return { response: json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429) };
	}
	const subject = await readKioskEmployee(db, kiosk, body.employeeId, deps.clock.nowInstant());
	if (!subject) return { response: json({ code: notAssignedCode }, 403) };
	const verification = await proveKioskPin(
		{
			organizationId: kiosk.organizationId,
			kioskId: kiosk.kioskId,
			employeeId: subject.id,
			pin: body.pin,
		},
		deps.verifyPin,
	);
	if (verification.status === "locked") {
		return {
			response: json(
				{ code: "pin_locked", lockedUntil: instantToCanonicalString(verification.until) },
				423,
			),
		};
	}
	if (verification.status !== "verified") {
		return { response: json({ code: verification.status }, 403) };
	}
	return { employee: subject, proof: verification.proof };
}
