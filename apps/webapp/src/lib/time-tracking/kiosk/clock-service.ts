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
import { proveKioskBadge, proveKioskPin } from "@/lib/time-tracking/clocking/kiosk";
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
import { kioskAcceptsBadgeInput } from "./badge-input";
import {
	KioskAttemptClosedError,
	type KioskAttemptResolution,
	resolveKioskClockAttempt,
} from "./clock-attempt";
import { readKioskEmployeeState } from "./employee-state";
import { readKioskBadgeInputs } from "./kiosk-store";
import {
	KIOSK_BADGE_INPUTS,
	KIOSK_CLOCK_ACTIONS,
	type KioskBadgeInput,
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
 * A scanned kiosk badge (#1366) replaces employee and PIN at a kiosk that
 * accepts badges: its own attempt limit, then the badge names the employee, who
 * must be assigned to the kiosk's location; Clocking checks badge, kiosk and
 * assignment again inside the work transaction.
 */
export type KioskClockServiceDeps = {
	clocking: Clocking;
	clock: Clock;
	/** The per-kiosk PIN attempt limit (spec "Rate limit"); every PIN-carrying call counts. */
	limitPinAttempts(kioskId: string): Promise<{ allowed: boolean; retryAfter: number }>;
	/**
	 * The per-kiosk badge attempt limit (#1366); every badge-carrying call counts,
	 * never toward the PIN limit or lockout.
	 */
	limitBadgeAttempts(kioskId: string): Promise<{ allowed: boolean; retryAfter: number }>;
	/**
	 * The per-kiosk limit on outcome questions (#1363): each one may write a
	 * closed attempt, so a kiosk cannot grow that table without bound. A kiosk
	 * treats the refusal as "not answered yet" and asks again later.
	 */
	limitOutcomeLookups(kioskId: string): Promise<{ allowed: boolean; retryAfter: number }>;
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

/** A request's verified employee (`badge`: proven by a kiosk badge, #1366), or the refusal. */
type Admission =
	| { response: Response }
	| { principal: ClockPrincipal; employee: KioskEmployee; badge: boolean };

const NO_STORE = { "Cache-Control": "no-store" };

/** The employee and their kiosk PIN (#860). */
const pinProofFields = {
	employeeId: z.string().uuid(),
	pin: z.string().min(1).max(32),
	badge: z.never().optional(),
	badgeInput: z.never().optional(),
};

/**
 * A scanned kiosk badge instead (#1366): the badge names the employee. An
 * `employeeId` beside it may only repeat the badge's own employee. `badgeInput`
 * says which kiosk input read it (#1367); absent, the attached scanner.
 */
const badgeProofFields = {
	badge: z.string().min(1).max(256),
	badgeInput: z.enum(KIOSK_BADGE_INPUTS).default("scanner"),
	employeeId: z.string().uuid().optional(),
	pin: z.never().optional(),
};

const actionFields = {
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
};

const employeeRequest = z.union([z.object(pinProofFields), z.object(badgeProofFields)]);

const clockRequest = z.union([
	z.object({ ...pinProofFields, ...actionFields }),
	z.object({ ...badgeProofFields, ...actionFields }),
]);

type EmployeeRequest = z.infer<typeof employeeRequest>;
type ClockRequest = z.infer<typeof clockRequest>;

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

	/**
	 * The kiosk's employee by id, when active and assigned to the kiosk's
	 * location; another organization's employee, an inactive one and an
	 * unassigned one read alike (null).
	 */
	async function assignedEmployee(
		kiosk: AuthenticatedKiosk,
		employeeId: string,
	): Promise<KioskEmployee | null> {
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
			.where(and(eq(employee.id, employeeId), eq(employee.organizationId, kiosk.organizationId)))
			.limit(1);
		if (
			!subject ||
			!(await isEmployeeActivelyAssignedToLocation(db, {
				organizationId: kiosk.organizationId,
				employeeId: subject.id,
				locationId: kiosk.locationId,
				now: deps.clock.nowInstant(),
			}))
		) {
			return null;
		}
		return {
			id: subject.id,
			userId: subject.userId,
			// The same name as on the kiosk's list (`readKioskEmployees`).
			name: buildDerivedUserName(subject.firstName ?? "", subject.lastName ?? "", subject.name),
		};
	}

	/** The kiosk's employee behind a verified PIN or badge, or the refusal to answer. */
	function admit(body: EmployeeRequest, kiosk: AuthenticatedKiosk): Promise<Admission> {
		return body.badge === undefined ? admitPin(body, kiosk) : admitBadge(body, kiosk);
	}

	/**
	 * The employee a scanned badge proves (#1366): at a kiosk that accepts
	 * badges from the input that read it (#1367: the scanner or the camera, each
	 * by its own switch), within its badge attempt limit, an active badge of the
	 * kiosk's organization whose employee is active and assigned to the kiosk's
	 * location. Every other badge reads alike (`badge_not_accepted`) and names
	 * nobody; a named employee other than the badge's is refused the same way.
	 * Never a PIN attempt.
	 *
	 * The input is the kiosk's own word: the server cannot tell a camera read
	 * from a scanner read, as both yield the same text. It is no security
	 * boundary (the badge, the device token and the kiosk are), but it holds an
	 * honest kiosk to what its admin switched on, through the turn's every action.
	 */
	async function admitBadge(
		body: { badge: string; badgeInput: KioskBadgeInput; employeeId?: string },
		kiosk: AuthenticatedKiosk,
	): Promise<Admission> {
		if (!kioskAcceptsBadgeInput(await readKioskBadgeInputs(db, kiosk), body.badgeInput)) {
			return { response: json({ code: "badge_input_disabled" }, 403) };
		}
		const limit = await deps.limitBadgeAttempts(kiosk.kioskId);
		if (!limit.allowed) {
			return {
				response: json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429),
			};
		}
		const refused = { response: json({ code: "badge_not_accepted" }, 403) };
		const proven = await proveKioskBadge(db, {
			organizationId: kiosk.organizationId,
			kioskId: kiosk.kioskId,
			credential: body.badge,
			input: body.badgeInput,
			now: deps.clock.nowInstant(),
		});
		if (proven.status !== "verified") return refused;
		const { proof } = proven;
		if (body.employeeId !== undefined && body.employeeId !== proof.employeeId) return refused;
		const subject = await assignedEmployee(kiosk, proof.employeeId);
		if (!subject) return refused;
		return {
			principal: { kind: "kiosk", kioskId: kiosk.kioskId, userId: subject.userId, proof },
			employee: subject,
			badge: true,
		};
	}

	async function admitPin(
		body: { employeeId: string; pin: string },
		kiosk: AuthenticatedKiosk,
	): Promise<Admission> {
		const limit = await deps.limitPinAttempts(kiosk.kioskId);
		if (!limit.allowed) {
			return {
				response: json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429),
			};
		}
		const subject = await assignedEmployee(kiosk, body.employeeId);
		if (!subject) return { response: json({ code: "employee_not_assigned" }, 403) };
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
				proof: verification.proof,
			},
			employee: subject,
			badge: false,
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
		body: ClockRequest,
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
				// A badge whose authority ended before the work could commit names nobody (#1366).
				if (admitted.badge && outcome.failure.code === "access_denied") {
					return json({ code: "badge_not_accepted" }, 403);
				}
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
		 * or action, and an operation Z8 knows outside this kiosk, is `conflict`
		 * (and names nothing of it). Anything else (401, 429, 503) leaves it
		 * unresolved.
		 */
		async outcome(request: Request): Promise<Response> {
			const authentication = await resolveKioskFromRequest(request, { clock: deps.clock });
			if (!authentication.ok) return kioskRefusalResponse(authentication.reason);
			const { kiosk } = authentication;
			const body = await readBody(request, outcomeRequest);
			if (!body) return json({ code: "invalid_request" }, 400);
			const limit = await deps.limitOutcomeLookups(kiosk.kioskId);
			if (!limit.allowed) {
				return json({ code: "rate_limited", retryAfter: limit.retryAfter }, 429);
			}
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
			if (
				resolution.state === "foreign" ||
				resolution.employeeId !== body.employeeId ||
				resolution.action !== body.action
			) {
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
