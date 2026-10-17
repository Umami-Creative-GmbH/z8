import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { employee } from "@/db/schema";
import { buildDerivedUserName } from "@/lib/auth/derived-user-name";
import {
	type Clock,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { isEmployeeActivelyAssignedToLocation } from "@/lib/time-tracking/assigned-locations/queries";
import type { Clocking } from "@/lib/time-tracking/clocking/clocking";
import { proveKioskPin } from "@/lib/time-tracking/clocking/kiosk";
import type { ClockPrincipal } from "@/lib/time-tracking/clocking/types";
import type { KioskPinVerification } from "@/lib/time-tracking/kiosk/verify-kiosk-pin";
import {
	readBreakVehicleUse,
	readClockVehicleUse,
} from "@/lib/time-tracking/vehicle-use/clock-vehicle-use";
import { getEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import type { WeekStartDay } from "@/lib/user-preferences/week-start";
import { getUserWeekStartDay } from "@/lib/user-preferences/week-start-server";
import {
	type AuthenticatedKiosk,
	kioskRefusalResponse,
	resolveKioskFromRequest,
} from "./authenticate";
import {
	KioskAttemptClosedError,
	type KioskAttemptResolution,
	resolveKioskClockAttempt,
} from "./clock-attempt";
import { readKioskEmployeeState } from "./employee-state";
import {
	KIOSK_CLOCK_ACTIONS,
	type KioskClockAction,
	type KioskClockAttemptOutcome,
	type KioskClockResult,
	type KioskEmployeeSnapshot,
	type KioskEventTime,
} from "./protocol";
import { kioskRefusalDetail } from "./refusal-detail";
import { readKioskVehicleUse } from "./vehicle-use-context";

/** An employee's own calendar, in which their day total counts. */
export type EmployeeCalendar = { timezone: string; weekStartDay: WeekStartDay };

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
	/** The employee's timezone and week start; defaults to their settings, else the organization's zone. */
	employeeCalendar?: (input: {
		userId: string;
		organizationId: string;
	}) => Promise<EmployeeCalendar>;
};

type KioskEmployee = { id: string; userId: string; name: string };

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
	/** Read leniently per action (#1123): a malformed one is dropped, never refused. */
	vehicleUse: z.unknown().optional(),
});

const outcomeRequest = z.object({
	operationId: z.string().uuid(),
	employeeId: z.string().uuid(),
	action: z.enum(KIOSK_CLOCK_ACTIONS),
});

/** A refusal because the kiosk's outcome lookup closed the attempt first (#1363). */
function isAttemptClosed(failure: { code: string; cause?: unknown }) {
	return failure.code === "collision" && failure.cause instanceof KioskAttemptClosedError;
}

/** The action's vehicle use beside its body (#1123), when it carried one Clocking can read. */
function clockVehicleUseOf(value: unknown) {
	const vehicleUse = readClockVehicleUse(value);
	return vehicleUse ? { vehicleUse } : {};
}

function breakVehicleUseOf(value: unknown) {
	const vehicleUse = readBreakVehicleUse(value);
	return vehicleUse ? { vehicleUse } : {};
}

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

/** The user's timezone and week start as the web uses them for this employee. */
async function settingsCalendar(input: {
	userId: string;
	organizationId: string;
}): Promise<EmployeeCalendar> {
	const [timezone, weekStartDay] = await Promise.all([
		getEffectiveTimezone(input.userId, input.organizationId),
		getUserWeekStartDay(input.userId),
	]);
	return { timezone, weekStartDay };
}

/**
 * When an executed or replayed action took effect, as Clocking recorded it: the
 * clock-in or clock-out entry (whose zone it captured), the start of a break in
 * progress, or the resume of a break.
 */
function eventTime(
	outcome:
		| { result: { timestamp: Date; timezone: string | null } }
		| { result: { start: Instant } },
	kioskZone: string,
): KioskEventTime {
	if ("timestamp" in outcome.result) {
		return {
			instant: instantToCanonicalString(instantFromDate(outcome.result.timestamp)),
			zone: outcome.result.timezone ?? kioskZone,
		};
	}
	return { instant: instantToCanonicalString(outcome.result.start), zone: kioskZone };
}

export function createKioskClockService(deps: KioskClockServiceDeps) {
	const verifyPin = deps.verifyPin;
	const employeeCalendar = deps.employeeCalendar ?? settingsCalendar;

	/** The kiosk's employee behind a verified PIN, or the refusal to answer. */
	async function admit(
		body: { employeeId: string; pin: string },
		kiosk: AuthenticatedKiosk,
	): Promise<{ response: Response } | { principal: ClockPrincipal; employee: KioskEmployee }> {
		const limit = await deps.limitPinAttempts(kiosk.kioskId);
		if (!limit.allowed) {
			return {
				response: json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429),
			};
		}
		const [subject] = await db
			.select({
				id: employee.id,
				userId: employee.userId,
				name: user.name,
				firstName: user.firstName,
				lastName: user.lastName,
			})
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
			employee: {
				id: subject.id,
				userId: subject.userId,
				// The same name as on the kiosk's list (`readKioskEmployees`).
				name: buildDerivedUserName(subject.firstName ?? "", subject.lastName ?? "", subject.name),
			},
		};
	}

	async function snapshot(
		kiosk: AuthenticatedKiosk,
		subject: KioskEmployee,
	): Promise<KioskEmployeeSnapshot> {
		const read = await readKioskEmployeeState(db, {
			organizationId: kiosk.organizationId,
			employeeId: subject.id,
			calendar: await employeeCalendar({
				userId: subject.userId,
				organizationId: kiosk.organizationId,
			}),
			now: deps.clock.nowInstant(),
		});
		return { employee: { id: subject.id, name: subject.name }, ...read };
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
					...clockVehicleUseOf(body.vehicleUse),
					body: { kind: "clock_in", workLocationType: "office" },
				});
			case "clock_out":
				return deps.clocking.run({
					...command,
					...clockVehicleUseOf(body.vehicleUse),
					body: {
						kind: "clock_out",
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
					},
				});
			case "break":
				return deps.clocking.run({
					...command,
					...breakVehicleUseOf(body.vehicleUse),
					body: { kind: "break", breakMinutes: body.breakMinutes ?? 0 },
				});
			case "start_break":
				// The break's one reading is asked when it ends (#1123).
				return deps.clocking.startBreak(command);
			case "resume_break":
				return deps.clocking.resumeBreak({ ...command, ...breakVehicleUseOf(body.vehicleUse) });
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
			const [current, vehicleUse] = await Promise.all([
				snapshot(kiosk, admitted.employee),
				readKioskVehicleUse(db, {
					organizationId: kiosk.organizationId,
					employeeId: admitted.employee.id,
				}),
			]);
			return json(vehicleUse ? { ...current, vehicleUse } : current);
		},

		/** `POST /api/kiosk/clock`: one action, when it took effect, then the state and day total. */
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
				const detail = isAttemptClosed(outcome.failure)
					? { code: "attempt_closed" }
					: kioskRefusalDetail(outcome.failure as { code: string });
				const status = refusalStatus(detail.code);
				return json(status === 409 ? { ...detail, ...after } : detail, status);
			}
			const result: KioskClockResult = {
				outcome: outcome.outcome,
				action: body.action as KioskClockAction,
				at: eventTime(outcome, kiosk.timezone),
				...after,
			};
			return json(result);
		},

		/**
		 * `POST /api/kiosk/clock/outcome` (#1363): what became of an action whose reply
		 * the kiosk lost. Needs only the kiosk's own token: no PIN, badge or current
		 * assignment, since it reveals only the kiosk's own attempt and runs nothing.
		 * Answers `committed` with the original action and time, or `not_recorded`
		 * once the attempt is closed for good; a committed attempt of another employee
		 * or action is `conflict`. Anything else (401, 503) leaves it unresolved.
		 */
		async outcome(request: Request): Promise<Response> {
			const authentication = await resolveKioskFromRequest(request, { clock: deps.clock });
			if (!authentication.ok) return kioskRefusalResponse(authentication.reason);
			const { kiosk } = authentication;
			const body = await readBody(request, outcomeRequest);
			if (!body) return json({ code: "invalid_request" }, 400);
			let resolution: KioskAttemptResolution;
			try {
				resolution = await resolveKioskClockAttempt(db, {
					organizationId: kiosk.organizationId,
					kioskId: kiosk.kioskId,
					operationId: body.operationId,
				});
			} catch {
				return json({ code: "failed" }, 503);
			}
			if (resolution.state === "not_recorded") {
				return json({ outcome: "not_recorded" } satisfies KioskClockAttemptOutcome);
			}
			if (resolution.employeeId !== body.employeeId || resolution.action !== body.action) {
				return json({ outcome: "conflict" } satisfies KioskClockAttemptOutcome);
			}
			return json({
				outcome: "committed",
				action: resolution.action,
				at: {
					instant: instantToCanonicalString(resolution.at.instant),
					zone: resolution.at.zone,
				},
			} satisfies KioskClockAttemptOutcome);
		},
	};
}
