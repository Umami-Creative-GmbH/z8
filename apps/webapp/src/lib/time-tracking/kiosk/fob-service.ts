import "server-only";

import { z } from "zod";
import { db } from "@/db";
import { type Clock, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import {
	type AuthenticatedKiosk,
	kioskRefusalResponse,
	resolveKioskFromRequest,
} from "./authenticate";
import { KioskFobRefusal, type KioskFobRefusalCode } from "./fob-errors";
import { normalizeKioskFobSerial } from "./fob-serial";
import { type KioskFobRegistration, registerKioskFob, resolveActiveKioskFob } from "./fob-store";
import { readKioskEmployee } from "./kiosk-employee";
import { readKioskFobReader } from "./kiosk-store";
import type { KioskFobLookup, KioskFobRegistrationResult } from "./protocol";
import { type KioskPinVerification, verifyKioskPin } from "./verify-kiosk-pin";

const logger = createLogger("KioskFobService");

/**
 * The kiosk fob endpoints (#1505, spec #1358, ADR 0014), authenticated as the
 * kiosk (its device token), never as a signed-in user. A fob's serial number
 * only selects an employee; their kiosk PIN still proves.
 *
 * - Lookup: the kiosk (token), the request, its fob reader switch, the serial
 *   number's format, the kiosk's lookup limit, then the active link and the
 *   employee's eligibility at the kiosk (the kiosk's name list). Binary and
 *   neutral (decision O1): `employee`, or `not_recognised` for everything else.
 * - Registration: the kiosk, the request, the switch, the serial number's
 *   format, the kiosk's PIN attempt limit, the employee's eligibility at the
 *   kiosk, their kiosk PIN (counted toward the lockout exactly like clocking),
 *   then the store. Online only.
 */
export type KioskFobServiceDeps = {
	clock: Clock;
	/** The per-kiosk PIN attempt limit (#860); every registration carries a PIN. */
	limitPinAttempts(kioskId: string): Promise<{ allowed: boolean; retryAfter: number }>;
	/** The per-kiosk fob lookup limit (#1505). */
	limitFobLookups(kioskId: string): Promise<{ allowed: boolean; retryAfter: number }>;
	verifyPin?: (
		organizationId: string,
		employeeId: string,
		pin: string,
	) => Promise<KioskPinVerification>;
	/**
	 * Runs after a registration committed (decision O3): the registration
	 * notification (#1507). A failure here never undoes or refuses the
	 * registration.
	 */
	onRegistered?: (registration: KioskFobRegistration) => Promise<void>;
};

const NO_STORE = { "Cache-Control": "no-store" };

const lookupRequest = z.object({ serial: z.unknown() });

const registrationRequest = z.object({
	serial: z.unknown(),
	employeeId: z.string().uuid(),
	pin: z.string().min(1).max(32),
});

const REFUSAL_STATUS: Record<KioskFobRefusalCode, number> = {
	fob_reader_disabled: 403,
	invalid_serial: 400,
	employee_not_eligible: 403,
	fob_linked_to_other_employee: 409,
};

function json(body: unknown, status = 200) {
	return Response.json(body, { status, headers: NO_STORE });
}

function refused(code: KioskFobRefusalCode) {
	return json({ code }, REFUSAL_STATUS[code]);
}

async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	try {
		const parsed = schema.safeParse(await request.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function createKioskFobService(deps: KioskFobServiceDeps) {
	const verifyPin = deps.verifyPin ?? verifyKioskPin;

	/** The kiosk and its canonical serial number, or the refusal: token, body, switch, format. */
	async function admit<T extends { serial: unknown }>(
		request: Request,
		schema: z.ZodType<T>,
	): Promise<{ response: Response } | { kiosk: AuthenticatedKiosk; body: T; serial: string }> {
		const authentication = await resolveKioskFromRequest(request, { clock: deps.clock });
		if (!authentication.ok) return { response: kioskRefusalResponse(authentication.reason) };
		const { kiosk } = authentication;
		const body = await readBody(request, schema);
		if (!body) return { response: json({ code: "invalid_request" }, 400) };
		if (!(await readKioskFobReader(db, kiosk))) return { response: refused("fob_reader_disabled") };
		const serial = normalizeKioskFobSerial(body.serial);
		if (!serial) return { response: refused("invalid_serial") };
		return { kiosk, body, serial };
	}

	return {
		/** `POST /api/kiosk/fob`: whom a read fob selects at this kiosk (`KioskFobLookup`). */
		async lookup(request: Request): Promise<Response> {
			const admitted = await admit(request, lookupRequest);
			if ("response" in admitted) return admitted.response;
			const { kiosk, serial } = admitted;
			const limit = await deps.limitFobLookups(kiosk.kioskId);
			if (!limit.allowed) {
				return json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429);
			}
			const now = deps.clock.nowInstant();
			const fob = await resolveActiveKioskFob(db, {
				organizationId: kiosk.organizationId,
				serial,
				now,
			});
			const subject = fob ? await readKioskEmployee(db, kiosk, fob.employeeId, now) : null;
			const answer: KioskFobLookup = subject
				? { outcome: "employee", employee: { id: subject.id, name: subject.name } }
				: { outcome: "not_recognised" };
			return json(answer);
		},

		/**
		 * `POST /api/kiosk/fob/registration`: links a fob to the employee who
		 * entered their kiosk PIN (`KioskFobRegistrationResult`).
		 */
		async register(request: Request): Promise<Response> {
			const admitted = await admit(request, registrationRequest);
			if ("response" in admitted) return admitted.response;
			const { kiosk, body, serial } = admitted;
			const limit = await deps.limitPinAttempts(kiosk.kioskId);
			if (!limit.allowed) {
				return json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429);
			}
			const subject = await readKioskEmployee(db, kiosk, body.employeeId, deps.clock.nowInstant());
			if (!subject) return refused("employee_not_eligible");
			const verification = await verifyPin(kiosk.organizationId, subject.id, body.pin);
			if (verification.status === "locked") {
				return json(
					{ code: "pin_locked", lockedUntil: instantToCanonicalString(verification.until) },
					423,
				);
			}
			if (verification.status !== "verified") return json({ code: verification.status }, 403);

			let registration: KioskFobRegistration;
			try {
				registration = await registerKioskFob(
					db,
					{
						organizationId: kiosk.organizationId,
						kioskId: kiosk.kioskId,
						employeeId: subject.id,
						serial,
					},
					deps.clock,
				);
			} catch (error) {
				if (error instanceof KioskFobRefusal) return refused(error.code);
				throw error;
			}
			try {
				await deps.onRegistered?.(registration);
			} catch (error) {
				logger.error(
					{ error, fobId: registration.fobId },
					"Kiosk fob registration follow-up failed",
				);
			}
			const result: KioskFobRegistrationResult = {
				outcome: registration.outcome,
				employee: { id: subject.id, name: subject.name },
				lastFour: registration.lastFour,
				replaced: registration.replacedFobId !== null,
			};
			return json(result);
		},
	};
}
