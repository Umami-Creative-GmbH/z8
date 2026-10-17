import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
	completedWorkOperation,
	employee,
	kioskRetiredToken,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import {
	type Clock,
	compareInstants,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
} from "@/lib/datetime/temporal-core";
import { createLogger } from "@/lib/logger";
import { isEmployeeActivelyAssignedToLocation } from "../assigned-locations/queries";
import { canonicalJson } from "../canonical-json";
import { CLOCK_COMMAND_ADMISSION_WINDOWS, CLOCK_COMMAND_OPERATION_ID } from "../clock-command";
import type { StartBreakRefusal } from "../clocking/break-in-progress";
import type { Clocking } from "../clocking/clocking";
import { proveFrozenKioskPin } from "../clocking/kiosk";
import type { ClockRefusal, ClockTarget, KioskPinProof } from "../clocking/types";
import { readAppendAdmission } from "../work-transaction";
import {
	type AuthenticatedKiosk,
	type FrozenCommandKiosk,
	kioskRefusalResponse,
	resolveFrozenCommandKiosk,
} from "./authenticate";
import { verifyKioskContact } from "./contact-anchor";
import {
	KIOSK_FROZEN_ACTIONS,
	type KioskFrozenAction,
	type KioskFrozenCommand,
	type KioskFrozenCommandLookup,
	type KioskFrozenCommandReply,
	type KioskFrozenRefusalReason,
	type KioskFrozenSubmission,
	parseKioskFrozenSubmission,
} from "./frozen-command";
import { kioskRefusalStatus } from "./frozen-refusal-reasons";
import {
	type KioskFrozenRefusal,
	type KioskFrozenRefusalLedger,
	unrecordedKioskFrozenRefusals,
} from "./frozen-refusals";
import { KioskPinUnsealableError, openSealedKioskPin } from "./pin-seal.server";
import type { KioskPinJudgment, QueuedKioskPinAttempt } from "./pin-store";
import { KIOSK_TOKEN_HEADER } from "./protocol";

/**
 * Frozen kiosk clock commands on arrival (#1289, spec #885, ADR 0011): the kiosk
 * submit and lookup endpoints. A command is judged in this order, and the first
 * refusal answers (`KioskFrozenRefusalReason`), goes through the one refusal seam
 * (`KioskFrozenRefusalLedger.record`) and writes nothing:
 *
 * 1. The device token: an active kiosk, or a revoked or rotated kiosk's token,
 *    which still names its kiosk; any other token is 401 `kiosk_unknown`.
 * 2. A committed operation under the identity answers its replay (same bytes) or
 *    a collision, before anything else, so a lost answer is never judged again;
 *    a refusal recorded earlier answers likewise.
 * 3. Revoked or rotated kiosk: every command, whatever instant it claims.
 * 4. The signed contact anchor; one signed for an older token of the kiosk reads
 *    as rotated.
 * 5. Adoption (ADR 0002): a `legacy` organization accepts no frozen command.
 * 6. The `delayed` admission window around arrival; then the time bounds: no
 *    instant before the kiosk's last contact, and a device-clock instant no later
 *    than arrival.
 * 7. Authorization as things stand now: the employee is an active employee of
 *    the organization assigned to the kiosk's location.
 * 8. The sealed PIN, opened only if it will be checked, against the employee's
 *    current PIN as the lockout stood at the command's instant (#1288), in its
 *    own transaction (not counted by the online per-kiosk limit). The arrival
 *    throttle answers 429 `retry_later` instead (ADR 0011): neither a refusal nor
 *    a check, and nothing is recorded; the kiosk resends the same bytes later.
 * 9. Clocking, as the kiosk principal on the kiosk channel at the occurred
 *    instant, in the zone the kiosk recorded (`command.timezone`, timekeeping:
 *    captured at the action, not at sync), with the frozen bytes as payload:
 *    replay, admission window, conflicts, closed months and follow-ups as online.
 *
 * A command naming another kiosk than the one whose token sends it is refused
 * `invalid_command` and recorded for the sending kiosk. A submission Z8 cannot
 * parse (400 `invalid_request`, 422 `unsupported_version`) is not recorded:
 * nothing in it can be trusted to name an employee, an action or an instant.
 */
export type KioskFrozenCommandServiceDeps = {
	clocking: Clocking;
	clock: Clock;
	/** The server secret behind contact anchors and PIN sealing. */
	secret: () => string;
	/** Where refusals go (#1290); defaults to keeping none. */
	refusals?: KioskFrozenRefusalLedger;
	/** The PIN judgment; defaults to `judgeKioskPinAttempt` in its own transaction. */
	judgePin?: (attempt: QueuedKioskPinAttempt, clock: Clock) => Promise<KioskPinJudgment>;
};

const logger = createLogger("KioskFrozenCommands");
const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
	return Response.json(body, { status, headers: NO_STORE });
}

/**
 * What Clocking can refuse a frozen kiosk command with: its clock commands'
 * refusals, a break start's and a resume's.
 */
type FrozenClockingFailure = ClockRefusal | StartBreakRefusal | { code: "no_break_in_progress" };

/** Clocking's refusal as a frozen kiosk refusal, or null for an unknown outcome. */
function clockingRefusal(
	failure: FrozenClockingFailure,
): { reason: KioskFrozenRefusalReason; detail: Record<string, unknown> } | null {
	switch (failure.code) {
		case "failed":
		case "unconfirmed":
		case "legacy_not_accepted":
			return null;
		case "frozen_not_accepted":
			return { reason: "not_adopted", detail: {} };
		case "admission_window":
			return { reason: failure.code, detail: { reason: failure.reason } };
		case "billing_required":
			return { reason: failure.code, detail: { reason: failure.reason } };
		case "already_clocked_in":
			return { reason: failure.code, detail: { since: instantToCanonicalString(failure.since) } };
		case "holiday_blocked":
			return {
				reason: failure.code,
				detail: failure.holidayName ? { holidayName: failure.holidayName } : {},
			};
		case "under_review":
			return { reason: failure.code, detail: { review: failure.review } };
		case "month_closed":
			return { reason: failure.code, detail: { month: failure.month } };
		case "occupancy_conflict":
		case "not_clocked_in":
		case "target_unknown":
		case "target_not_active":
		case "already_on_break":
		case "on_break":
		case "no_break_in_progress":
		case "invalid_interval":
		case "append_review_required":
		case "collision":
		case "access_denied":
		case "invalid_command":
			return { reason: failure.code, detail: {} };
		// Attribution and shape refusals: a frozen kiosk command preserves attribution.
		case "project_not_allowed":
		case "billable_not_allowed":
		case "task_not_allowed":
		case "work_category_not_allowed":
		case "invalid_work_location":
		case "invalid_break_duration":
			return { reason: "invalid_command", detail: {} };
		default: {
			const unhandled: never = failure;
			return unhandled;
		}
	}
}

function closeTarget(target: Extract<KioskFrozenCommand, { action: "clock_out" }>["target"]) {
	return "workPeriodId" in target
		? ({ kind: "period", workPeriodId: target.workPeriodId } satisfies ClockTarget)
		: ({ kind: "started_by", operationId: target.clockInOperationId } satisfies ClockTarget);
}

function isFrozenAction(value: unknown): value is KioskFrozenAction {
	return (KIOSK_FROZEN_ACTIONS as readonly unknown[]).includes(value);
}

/** What holds an operation identity in the kiosk's organization. */
type CommittedOperation =
	| { kind: "receipt"; command: unknown; action: KioskFrozenAction | null }
	| { kind: "break_start"; employeeId: string; start: Instant }
	| { kind: "other" };

async function readCommittedOperation(
	kiosk: AuthenticatedKiosk,
	operationId: string,
): Promise<CommittedOperation | null> {
	// Receipts and entries are keyed by the global operation ID, so these two reads are by ID
	// alone: an ID held in another organization must answer as taken (`other`), never as free.
	// Nothing of that other row is read beyond whether it is this kiosk's own.
	const [receipt] = await db
		.select({
			organizationId: completedWorkOperation.organizationId,
			kioskId: completedWorkOperation.kioskId,
			command: completedWorkOperation.command,
		})
		.from(completedWorkOperation)
		.where(eq(completedWorkOperation.id, operationId))
		.limit(1);
	if (receipt) {
		if (receipt.organizationId !== kiosk.organizationId || receipt.kioskId !== kiosk.kioskId) {
			return { kind: "other" };
		}
		const action = (receipt.command as { action?: unknown } | null)?.action;
		return {
			kind: "receipt",
			command: receipt.command,
			action: isFrozenAction(action) ? action : null,
		};
	}
	const [entry] = await db
		.select({ id: timeEntry.id })
		.from(timeEntry)
		.where(eq(timeEntry.id, operationId))
		.limit(1);
	if (entry) return { kind: "other" };
	// A break in progress keeps no receipt (ADR 0007): its start names the operation.
	const [started] = await db
		.select({
			employeeId: workPeriod.employeeId,
			breakStartedAt: workPeriod.breakStartedAt,
			endTime: workPeriod.endTime,
		})
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.organizationId, kiosk.organizationId),
				eq(workPeriod.breakStartedOperationId, operationId),
			),
		)
		.limit(1);
	const start = started?.breakStartedAt ?? started?.endTime;
	if (started && start) {
		return { kind: "break_start", employeeId: started.employeeId, start: instantFromDate(start) };
	}
	return null;
}

/** Whether a committed operation is this very command (its bytes, or a start at its instant). */
function isSameCommand(committed: CommittedOperation, command: KioskFrozenCommand) {
	if (committed.kind === "receipt") {
		return canonicalJson(committed.command) === canonicalJson(command);
	}
	if (committed.kind === "break_start") {
		return (
			command.action === "start_break" &&
			committed.employeeId === command.employeeId &&
			compareInstants(committed.start, parseInstant(command.occurredAt)) === 0
		);
	}
	return false;
}

/** Whether the anchor was signed for one of the kiosk's rotated-away tokens. */
async function isAnchorOfRotatedToken(
	kiosk: AuthenticatedKiosk,
	contact: KioskFrozenSubmission["contact"],
	secret: string,
) {
	const retired = await db
		.select({ tokenHash: kioskRetiredToken.tokenHash })
		.from(kioskRetiredToken)
		.where(
			and(
				eq(kioskRetiredToken.organizationId, kiosk.organizationId),
				eq(kioskRetiredToken.kioskId, kiosk.kioskId),
			),
		);
	return retired.some(
		({ tokenHash }) =>
			verifyKioskContact(
				contact,
				{ organizationId: kiosk.organizationId, kioskId: kiosk.kioskId, tokenHash },
				secret,
			) !== null,
	);
}

/** When an executed action took effect, as Clocking recorded it. */
function eventTime(
	result: { timestamp: Date; timezone: string | null } | { start: Instant },
	kioskZone: string,
) {
	if ("timestamp" in result) {
		return {
			instant: instantToCanonicalString(instantFromDate(result.timestamp)),
			zone: result.timezone ?? kioskZone,
		};
	}
	return { instant: instantToCanonicalString(result.start), zone: kioskZone };
}

export function createKioskFrozenCommandService(deps: KioskFrozenCommandServiceDeps) {
	const refusals = deps.refusals ?? unrecordedKioskFrozenRefusals;

	/** Runs the command through Clocking as the kiosk principal, with its PIN proof. */
	function runCommand(
		kiosk: AuthenticatedKiosk,
		command: KioskFrozenCommand,
		subject: { id: string; userId: string },
		proof: KioskPinProof,
		now: Instant,
	) {
		const window = CLOCK_COMMAND_ADMISSION_WINDOWS.delayed;
		const base = {
			organizationId: kiosk.organizationId,
			principal: {
				kind: "kiosk" as const,
				kioskId: kiosk.kioskId,
				userId: subject.userId,
				pin: proof,
			},
			subject: { employeeId: subject.id },
			identity: { origin: "client" as const, id: command.operationId },
			channel: "kiosk" as const,
			at: { kind: "occurred" as const, instant: parseInstant(command.occurredAt) },
			// The zone the kiosk recorded when the employee acted, not the kiosk's zone at arrival.
			zone: { device: command.timezone, fallback: command.timezone },
			freshness: {
				earliest: now.subtract({ milliseconds: window.pastMilliseconds }),
				latest: now.add({ milliseconds: window.futureMilliseconds }),
			},
			payload: command,
		};
		switch (command.action) {
			case "clock_in":
				return deps.clocking.run({
					...base,
					...(command.vehicleUse ? { vehicleUse: command.vehicleUse } : {}),
					body: { kind: "clock_in", workLocationType: command.workLocationType },
				});
			case "clock_out":
				return deps.clocking.run({
					...base,
					...(command.vehicleUse ? { vehicleUse: command.vehicleUse } : {}),
					body: {
						kind: "clock_out",
						target: closeTarget(command.target),
						project: { kind: "preserve" },
						workCategory: { kind: "preserve" },
					},
				});
			case "start_break":
				return deps.clocking.startBreak(base);
			case "resume_break":
				return deps.clocking.resumeBreak({
					...base,
					...(command.vehicleUse ? { vehicleUse: command.vehicleUse } : {}),
				});
		}
	}

	/** Judges one parsed submission of an authenticated (active, revoked or rotated) kiosk. */
	async function judge(
		authenticated: Exclude<FrozenCommandKiosk, { status: "unknown" }>,
		submission: KioskFrozenSubmission,
	): Promise<{ status: number; body: KioskFrozenCommandReply }> {
		const { kiosk } = authenticated;
		const { command } = submission;
		const { operationId } = command;
		const now = deps.clock.nowInstant();
		const claimedAt = parseInstant(command.occurredAt);
		const [subject] = await db
			.select({ id: employee.id, userId: employee.userId })
			.from(employee)
			.where(
				and(eq(employee.id, command.employeeId), eq(employee.organizationId, kiosk.organizationId)),
			)
			.limit(1);

		const answer = (reason: KioskFrozenRefusalReason, detail: Record<string, unknown> = {}) => ({
			status: kioskRefusalStatus(reason),
			body: { outcome: "refused" as const, operationId, code: reason, ...detail },
		});
		/** The one refusal seam: every refused judgment is recorded, then answered. */
		const refuse = async (
			reason: KioskFrozenRefusalReason,
			detail: Record<string, unknown> = {},
		) => {
			const refusal: KioskFrozenRefusal = {
				organizationId: kiosk.organizationId,
				kioskId: kiosk.kioskId,
				operationId,
				employeeId: command.employeeId,
				employee: subject ?? null,
				action: command.action,
				claimedAt,
				timezone: command.timezone,
				timeSource: command.timeSource,
				reason,
				detail,
				command,
				refusedAt: now,
			};
			await refusals.record(refusal);
			return answer(reason, detail);
		};

		// A committed operation, or a recorded refusal, answers before anything is judged.
		const committed = await readCommittedOperation(kiosk, operationId);
		if (committed) {
			// Other bytes under committed work: answered, but nothing was refused that anyone
			// should be told was not recorded.
			if (!isSameCommand(committed, command)) return answer("collision");
			return {
				status: 200,
				body: { outcome: "replayed", operationId, action: command.action },
			};
		}
		const recalled = await refusals.recall({
			organizationId: kiosk.organizationId,
			kioskId: kiosk.kioskId,
			operationId,
		});
		if (recalled) {
			return canonicalJson(recalled.command) === canonicalJson(command)
				? answer(recalled.reason, recalled.detail)
				: answer("collision");
		}

		// A command names the kiosk that queued it; another kiosk's token never sends it.
		if (command.kioskId !== kiosk.kioskId) return refuse("invalid_command");
		if (authenticated.status === "revoked") return refuse("kiosk_revoked");
		if (authenticated.status === "rotated") return refuse("kiosk_rotated");

		const secret = deps.secret();
		const contactAt = verifyKioskContact(
			submission.contact,
			{
				organizationId: kiosk.organizationId,
				kioskId: kiosk.kioskId,
				tokenHash: authenticated.tokenHash,
			},
			secret,
		);
		if (!contactAt) {
			return refuse(
				(await isAnchorOfRotatedToken(kiosk, submission.contact, secret))
					? "kiosk_rotated"
					: "contact_unverifiable",
			);
		}

		if ((await readAppendAdmission(db, kiosk.organizationId)) !== "append") {
			return refuse("not_adopted");
		}

		const window = CLOCK_COMMAND_ADMISSION_WINDOWS.delayed;
		if (compareInstants(claimedAt, now.subtract({ milliseconds: window.pastMilliseconds })) < 0) {
			return refuse("admission_window", { reason: "too_old" });
		}
		if (compareInstants(claimedAt, now.add({ milliseconds: window.futureMilliseconds })) > 0) {
			return refuse("admission_window", { reason: "in_future" });
		}
		if (
			compareInstants(claimedAt, contactAt) < 0 ||
			(command.timeSource === "device_clock" && compareInstants(claimedAt, now) > 0)
		) {
			return refuse("clock_out_of_bounds");
		}

		if (
			!subject ||
			!(await isEmployeeActivelyAssignedToLocation(db, {
				organizationId: kiosk.organizationId,
				employeeId: subject.id,
				locationId: kiosk.locationId,
				now,
			}))
		) {
			return refuse("employee_not_assigned");
		}

		let verification: Awaited<ReturnType<typeof proveFrozenKioskPin>>;
		try {
			verification = await proveFrozenKioskPin(
				{
					organizationId: kiosk.organizationId,
					kioskId: kiosk.kioskId,
					employeeId: subject.id,
					operationId,
					occurredAt: claimedAt,
					timeSource: command.timeSource,
					// Opened in memory only, and only when the PIN will be checked.
					pin: () => {
						const pin = openSealedKioskPin(
							submission.pin,
							{ kioskId: kiosk.kioskId, employeeId: subject.id, operationId },
							secret,
						);
						if (pin === null) throw new KioskPinUnsealableError();
						return pin;
					},
				},
				deps.clock,
				deps.judgePin,
			);
		} catch (error) {
			if (error instanceof KioskPinUnsealableError) return refuse("pin_unsealable");
			throw error;
		}
		if (verification.status === "throttled") {
			const retryAfter = Math.max(
				1,
				Math.ceil((verification.retryAfter.epochMilliseconds - now.epochMilliseconds) / 1000),
			);
			return {
				status: 429,
				body: { outcome: "retry_later", operationId, code: "pin_throttled", retryAfter },
			};
		}
		if (verification.status === "locked") {
			return refuse("pin_locked", { lockedUntil: instantToCanonicalString(verification.until) });
		}
		if (verification.status !== "verified") return refuse(verification.status);

		const outcome = await runCommand(kiosk, command, subject, verification.proof, now);
		if (outcome.outcome === "refused") {
			const { failure } = outcome;
			const refusal = clockingRefusal(failure);
			if (!refusal) {
				logger.error(
					{ error: "cause" in failure ? failure.cause : undefined, operationId },
					"Frozen kiosk command failed",
				);
				return { status: 500, body: { outcome: "unknown", operationId } };
			}
			return refuse(refusal.reason, refusal.detail);
		}
		return {
			status: outcome.outcome === "executed" ? 201 : 200,
			body: {
				outcome: outcome.outcome,
				operationId,
				action: command.action,
				at: eventTime(outcome.result, command.timezone),
			},
		};
	}

	return {
		/** `POST /api/kiosk/commands`: one frozen kiosk command (`KioskFrozenCommandReply`). */
		async submit(request: Request): Promise<Response> {
			const authenticated = await resolveFrozenCommandKiosk(
				request.headers.get(KIOSK_TOKEN_HEADER),
				{ clock: deps.clock },
			);
			if (authenticated.status === "unknown") return kioskRefusalResponse("unknown");
			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return json({ code: "invalid_request" }, 400);
			}
			const parsed = parseKioskFrozenSubmission(body);
			if (!parsed.ok) {
				return json({ code: parsed.code }, parsed.code === "unsupported_version" ? 422 : 400);
			}
			const { submission } = parsed;
			const { operationId } = submission.command;
			try {
				const { status, body: reply } = await judge(authenticated, submission);
				if (reply.outcome === "retry_later") {
					return Response.json(reply, {
						status,
						headers: { ...NO_STORE, "Retry-After": String(reply.retryAfter) },
					});
				}
				return json(reply, status);
			} catch (error) {
				logger.error({ error, operationId }, "Frozen kiosk command failed");
				// It may or may not have committed: look it up, then resend it unchanged.
				return json({ outcome: "unknown", operationId }, 500);
			}
		},

		/** `GET /api/kiosk/commands/{operationId}`: what became of this kiosk's command. */
		async lookup(request: Request, operationId: string): Promise<Response> {
			const authenticated = await resolveFrozenCommandKiosk(
				request.headers.get(KIOSK_TOKEN_HEADER),
				{ clock: deps.clock },
			);
			if (authenticated.status === "unknown") return kioskRefusalResponse("unknown");
			if (!CLOCK_COMMAND_OPERATION_ID.test(operationId)) {
				return json({ code: "invalid_operation_id" }, 400);
			}
			const { kiosk } = authenticated;
			try {
				const committed = await readCommittedOperation(kiosk, operationId);
				let reply: KioskFrozenCommandLookup;
				if (committed?.kind === "receipt" && committed.action) {
					reply = { outcome: "committed", operationId, action: committed.action };
				} else if (committed?.kind === "break_start") {
					reply = { outcome: "committed", operationId, action: "start_break" };
				} else if (committed) {
					reply = { outcome: "conflict", operationId };
				} else {
					const recalled = await refusals.recall({
						organizationId: kiosk.organizationId,
						kioskId: kiosk.kioskId,
						operationId,
					});
					reply = recalled
						? { outcome: "refused", operationId, code: recalled.reason, ...recalled.detail }
						: { outcome: "not_committed", operationId };
				}
				return json(reply);
			} catch (error) {
				logger.error({ error, operationId }, "Frozen kiosk command lookup failed");
				return json({ code: "unavailable" }, 500);
			}
		},
	};
}
