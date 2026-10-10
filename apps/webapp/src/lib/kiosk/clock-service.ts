import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { type Clock, instantToCanonicalString } from "@/lib/datetime/temporal-core";
import { isEmployeeActivelyAssignedToLocation } from "@/lib/time-tracking/assigned-locations/queries";
import type { Clocking } from "@/lib/time-tracking/clocking/clocking";
import { proveKioskPin } from "@/lib/time-tracking/clocking/kiosk";
import type { ClockPrincipal } from "@/lib/time-tracking/clocking/types";
import type { KioskPinVerification } from "@/lib/time-tracking/kiosk/verify-kiosk-pin";
import {
	type AuthenticatedKiosk,
	kioskRefusalResponse,
	resolveKioskFromRequest,
} from "./authenticate";
import { readKioskEmployeeState } from "./employee-state";
import {
	KIOSK_CLOCK_ACTIONS,
	type KioskClockAction,
	type KioskClockResult,
	type KioskEmployeeSnapshot,
} from "./protocol";

/**
 * The kiosk clocking endpoints (#860): a kiosk's device token, an employee and
 * their kiosk PIN run Clocking with the kiosk principal on the kiosk channel.
 * Order: the kiosk (token), the request, the kiosk's PIN attempt limit, the
 * employee's assignment to the kiosk's location, the PIN, then Clocking, which
 * authorizes the whole again. A wrong or locked PIN never reaches Clocking.
 */
export type KioskClockServiceDeps = {
	clocking: Clocking;
	clock: Clock;
	/** The per-kiosk PIN attempt limit (spec "Rate limit"); every PIN-carrying call counts. */
	limitPinAttempts(kioskId: string): Promise<{ allowed: boolean; retryAfter: number }>;
	verifyPin?: (
		organizationId: string,
		employeeId: string,
		pin: string,
	) => Promise<KioskPinVerification>;
};

const NO_STORE = { "Cache-Control": "no-store" };

const employeeRequest = z.object({
	employeeId: z.string().uuid(),
	pin: z.string().min(1).max(32),
});

const clockRequest = employeeRequest.extend({
	action: z.enum(KIOSK_CLOCK_ACTIONS),
	operationId: z.string().uuid().optional(),
	breakMinutes: z
		.number()
		.int()
		.min(1)
		.max(24 * 60)
		.optional(),
});

function json(body: unknown, status = 200) {
	return Response.json(body, { status, headers: NO_STORE });
}

async function readBody<T>(request: Request, schema: z.ZodType<T>): Promise<T | null> {
	try {
		const parsed = schema.safeParse(await request.json());
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

/** The HTTP status of a Clocking refusal at a kiosk. */
function refusalStatus(code: string) {
	if (code === "access_denied") return 403;
	if (code === "billing_required") return 402;
	if (code === "failed" || code === "unconfirmed") return 503;
	if (code === "invalid_command" || code === "invalid_break_duration") return 400;
	return 409;
}

/** A refusal's detail the device may show; causes stay on the server. */
function refusalDetail(failure: { code: string } & Record<string, unknown>) {
	const { cause: _cause, requirement: _requirement, ...detail } = failure;
	for (const [key, value] of Object.entries(detail)) {
		if (value && typeof value === "object" && "epochNanoseconds" in value) {
			detail[key] = String(value);
		}
	}
	return detail;
}

export function createKioskClockService(deps: KioskClockServiceDeps) {
	const verifyPin = deps.verifyPin;

	/** The kiosk's employee behind a verified PIN, or the refusal to answer. */
	async function admit(
		body: { employeeId: string; pin: string },
		kiosk: AuthenticatedKiosk,
	): Promise<
		{ response: Response } | { principal: ClockPrincipal; employee: { id: string; name: string } }
	> {
		const limit = await deps.limitPinAttempts(kiosk.kioskId);
		if (!limit.allowed) {
			return {
				response: json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429),
			};
		}
		const [subject] = await db
			.select({ id: employee.id, userId: employee.userId, name: user.name })
			.from(employee)
			.innerJoin(user, eq(user.id, employee.userId))
			.where(
				and(eq(employee.id, body.employeeId), eq(employee.organizationId, kiosk.organizationId)),
			)
			.limit(1);
		// Another organization's employee, an inactive one and an unassigned one read alike.
		if (
			!subject ||
			!(await isEmployeeActivelyAssignedToLocation(db, {
				organizationId: kiosk.organizationId,
				employeeId: subject.id,
				locationId: kiosk.locationId,
				now: deps.clock.nowInstant(),
			}))
		) {
			return { response: json({ code: "employee_not_assigned" }, 403) };
		}
		const verification = await proveKioskPin(
			{
				organizationId: kiosk.organizationId,
				kioskId: kiosk.kioskId,
				employeeId: subject.id,
				pin: body.pin,
			},
			verifyPin,
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
		return {
			principal: {
				kind: "kiosk",
				kioskId: kiosk.kioskId,
				userId: subject.userId,
				pin: verification.proof,
			},
			employee: { id: subject.id, name: subject.name },
		};
	}

	async function snapshot(
		kiosk: AuthenticatedKiosk,
		subject: { id: string; name: string },
	): Promise<KioskEmployeeSnapshot> {
		const read = await readKioskEmployeeState(db, {
			organizationId: kiosk.organizationId,
			employeeId: subject.id,
			timezone: kiosk.timezone,
			now: deps.clock.nowInstant(),
		});
		return { employee: subject, ...read };
	}

	/** Runs one kiosk action through Clocking as the kiosk principal. */
	function runAction(
		kiosk: AuthenticatedKiosk,
		principal: ClockPrincipal,
		employeeId: string,
		body: z.infer<typeof clockRequest>,
	) {
		const command = {
			organizationId: kiosk.organizationId,
			principal,
			subject: { employeeId },
			identity: body.operationId
				? { origin: "client" as const, id: body.operationId }
				: { origin: "server" as const, id: randomUUID() },
			channel: "kiosk" as const,
			at: { kind: "now" as const },
			zone: { device: kiosk.timezone, fallback: kiosk.timezone },
		};
		switch (body.action) {
			case "clock_in":
				return deps.clocking.run({
					...command,
					body: { kind: "clock_in", workLocationType: "office" },
				});
			case "clock_out":
				return deps.clocking.run({
					...command,
					body: {
						kind: "clock_out",
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
					},
				});
			case "break":
				return deps.clocking.run({
					...command,
					body: { kind: "break", breakMinutes: body.breakMinutes ?? 0 },
				});
			case "start_break":
				return deps.clocking.startBreak(command);
			case "resume_break":
				return deps.clocking.resumeBreak(command);
		}
	}

	return {
		/** `POST /api/kiosk/employee-status`: the PIN-verified employee's state and day total. */
		async status(request: Request): Promise<Response> {
			const authentication = await resolveKioskFromRequest(request, { clock: deps.clock });
			if (!authentication.ok) return kioskRefusalResponse(authentication.reason);
			const { kiosk } = authentication;
			const body = await readBody(request, employeeRequest);
			if (!body) return json({ code: "invalid_request" }, 400);
			const admitted = await admit(body, kiosk);
			if ("response" in admitted) return admitted.response;
			return json(await snapshot(kiosk, admitted.employee));
		},

		/** `POST /api/kiosk/clock`: one action, then the employee's state and day total. */
		async clock(request: Request): Promise<Response> {
			const authentication = await resolveKioskFromRequest(request, { clock: deps.clock });
			if (!authentication.ok) return kioskRefusalResponse(authentication.reason);
			const { kiosk } = authentication;
			const body = await readBody(request, clockRequest);
			if (!body || (body.action === "break") !== (body.breakMinutes !== undefined)) {
				return json({ code: "invalid_request" }, 400);
			}
			const admitted = await admit(body, kiosk);
			if ("response" in admitted) return admitted.response;
			const outcome = await runAction(kiosk, admitted.principal, admitted.employee.id, body);
			const after = await snapshot(kiosk, admitted.employee);
			if (outcome.outcome === "refused") {
				const { code } = outcome.failure;
				const detail = refusalDetail(outcome.failure as { code: string });
				const status = refusalStatus(code);
				return json(status === 409 ? { ...detail, ...after } : detail, status);
			}
			const result: KioskClockResult = {
				outcome: outcome.outcome,
				action: body.action as KioskClockAction,
				...after,
			};
			return json(result);
		},
	};
}
