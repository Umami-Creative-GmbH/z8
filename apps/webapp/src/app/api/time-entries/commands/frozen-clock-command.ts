import "server-only";

import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import {
	CLOCK_COMMAND_ADMISSION_WINDOWS,
	type ClockCommand as FrozenClockCommand,
} from "@/lib/time-tracking/clock-command";
import type {
	ClockCommand,
	ClockCommandFailure,
	ClockLookupQuery,
	ClockRefusal,
	ClockTarget,
} from "@/lib/time-tracking/clocking";
import { clockingService } from "@/lib/time-tracking/clocking-service";

/** The authenticated employee a frozen command runs for. */
export type FrozenCommandActor = {
	userId: string;
	organizationId: string;
	employeeId: string;
};

/**
 * Authenticates the session's employee in its active organization. Throws
 * `ClockingAccessError` when the session has none; the module authorizes.
 */
export async function requireCommandActor(session: {
	user: { id: string };
	session: { activeOrganizationId?: string | null };
}): Promise<FrozenCommandActor> {
	const actor = await clockingService.requireActor({
		userId: session.user.id,
		activeOrganizationId: session.session.activeOrganizationId,
	});
	return {
		userId: actor.userId,
		organizationId: actor.organizationId,
		employeeId: actor.employee.id,
	};
}

/** Lookup of one identity for the actor, among direct-HTTP receipts. */
export function lookupQuery(actor: FrozenCommandActor, operationId: string): ClockLookupQuery {
	return {
		organizationId: actor.organizationId,
		principal: { kind: "user", userId: actor.userId },
		subject: { employeeId: actor.employeeId },
		identity: { origin: "client", id: operationId },
		channel: "api",
	};
}

function closeTarget(
	target: Extract<FrozenClockCommand, { target: unknown }>["target"],
): ClockTarget {
	return "workPeriodId" in target
		? { kind: "period", workPeriodId: target.workPeriodId }
		: { kind: "started_by", operationId: target.clockInOperationId };
}

/**
 * One frozen clock command as a Clocking command. The adapter chooses the age window
 * from the command's admission mode around the server's instant; the window also
 * covers a break's confirmation. The frozen bytes travel as the payload.
 */
export function toClockingCommand(
	command: FrozenClockCommand,
	actor: FrozenCommandActor,
	input: {
		now: Instant;
		fallbackZone: string;
		/**
		 * Whether the request may carry a position (#826, decision D5): only a
		 * cookie-authenticated browser request. A bearer client's stamped command
		 * still runs, without its position; its bytes stay the receipt command.
		 */
		acceptsPosition: boolean;
	},
): ClockCommand {
	const window = CLOCK_COMMAND_ADMISSION_WINDOWS[command.admission];
	const position =
		input.acceptsPosition && "position" in command
			? {
					position: {
						latitude: command.position.latitude,
						longitude: command.position.longitude,
						accuracyMeters: command.position.accuracyMeters,
						fixedAt: parseInstant(command.position.fixedAt),
					},
				}
			: {};
	const common = {
		organizationId: actor.organizationId,
		principal: { kind: "user", userId: actor.userId },
		subject: { employeeId: actor.employeeId },
		identity: { origin: "client", id: command.operationId },
		channel: "api",
		at: { kind: "occurred", instant: parseInstant(command.occurredAt) },
		zone: { device: command.timezone, fallback: input.fallbackZone },
		freshness: {
			earliest: input.now.subtract({ milliseconds: window.pastMilliseconds }),
			latest: input.now.add({ milliseconds: window.futureMilliseconds }),
			...(command.kind === "break"
				? { observed: [parseInstant(command.observations.confirmed.utc)] }
				: {}),
		},
		payload: command,
		...position,
	} satisfies Omit<ClockCommand, "body">;
	switch (command.kind) {
		case "clock_in":
			return {
				...common,
				body: { kind: "clock_in", workLocationType: command.workLocationType },
			};
		case "clock_out":
			return {
				...common,
				body: {
					kind: "clock_out",
					target: closeTarget(command.target),
					project: command.project,
					workCategory: command.workCategory,
					// Named only when the command names one (#875); absent, it follows the project.
					...(command.task ? { task: command.task } : {}),
					...(command.billable === undefined ? {} : { billable: command.billable }),
				},
			};
		case "break":
			return {
				...common,
				body: {
					kind: "break",
					target: closeTarget(command.target),
					start: {
						instant: parseInstant(command.breakStart.at),
						zone: command.breakStart.timezone,
					},
				},
			};
	}
}

/** What the adapter itself refuses before a Clocking command exists. */
type AdapterRejection =
	| { code: "access_denied" }
	| { code: "context_mismatch"; fields: string[] }
	| { code: "clock_discontinuity"; from: string };

const ADAPTER_REJECTION_STATUS: Record<AdapterRejection["code"], number> = {
	access_denied: 403,
	context_mismatch: 409,
	clock_discontinuity: 422,
};

/** One adapter refusal as its HTTP/v2 response; nothing was run or written. */
export function adapterRejectionReply(operationId: string, rejection: AdapterRejection) {
	return {
		status: ADAPTER_REJECTION_STATUS[rejection.code],
		body: { outcome: "rejected" as const, operationId, ...rejection },
	};
}

/** The HTTP/v2 wire codes of Clocking refusals that wrote nothing. */
type RejectionCode =
	| "access_denied"
	| "billing_required"
	| "invalid_command"
	| "admission_window"
	| "collision"
	| "append_review_required"
	| "not_adopted"
	| "target_unknown"
	| "target_not_active"
	| "attribution_not_allowed"
	| "invalid_interval"
	| "already_clocked_in"
	| "not_allowed_at_time"
	| "occupancy_conflict"
	| "review_pending";

/**
 * The HTTP status table: every Clocking failure code, as its HTTP status and v2
 * wire code. `unknown` means the command may or may not have committed: the client
 * looks it up, then resends it unchanged.
 */
const FAILURE_REPLIES: Record<
	ClockCommandFailure,
	{ status: number; code: RejectionCode | "unknown" }
> = {
	access_denied: { status: 403, code: "access_denied" },
	billing_required: { status: 402, code: "billing_required" },
	// The parser admits only valid commands; the module's own checks agree with it.
	invalid_command: { status: 400, code: "invalid_command" },
	invalid_work_location: { status: 400, code: "invalid_command" },
	invalid_break_duration: { status: 400, code: "invalid_command" },
	admission_window: { status: 422, code: "admission_window" },
	collision: { status: 409, code: "collision" },
	append_review_required: { status: 409, code: "append_review_required" },
	frozen_not_accepted: { status: 409, code: "not_adopted" },
	// Only the legacy route sends legacy commands.
	legacy_not_accepted: { status: 500, code: "unknown" },
	target_unknown: { status: 409, code: "target_unknown" },
	target_not_active: { status: 409, code: "target_not_active" },
	// Frozen closures always name their target.
	not_clocked_in: { status: 409, code: "target_not_active" },
	project_not_allowed: { status: 422, code: "attribution_not_allowed" },
	task_not_allowed: { status: 422, code: "attribution_not_allowed" },
	work_category_not_allowed: { status: 422, code: "attribution_not_allowed" },
	billable_not_allowed: { status: 422, code: "attribution_not_allowed" },
	invalid_interval: { status: 422, code: "invalid_interval" },
	already_clocked_in: { status: 409, code: "already_clocked_in" },
	holiday_blocked: { status: 422, code: "not_allowed_at_time" },
	occupancy_conflict: { status: 409, code: "occupancy_conflict" },
	under_review: { status: 409, code: "review_pending" },
	// A break in progress is open (#861): the work is not available to this break.
	on_break: { status: 409, code: "target_not_active" },
	failed: { status: 500, code: "unknown" },
	unconfirmed: { status: 500, code: "unknown" },
};

/** The wire details a refusal carries beyond its code. */
function refusalDetails(refusal: ClockRefusal): Record<string, unknown> {
	switch (refusal.code) {
		case "billing_required":
		case "admission_window":
			return { reason: refusal.reason };
		case "holiday_blocked":
			return refusal.holidayName ? { holidayName: refusal.holidayName } : {};
		case "project_not_allowed":
			return { field: "projectId" };
		case "task_not_allowed":
			return { field: "taskId", reason: refusal.reason };
		case "work_category_not_allowed":
			return { field: "workCategoryId" };
		case "billable_not_allowed":
			return { field: "billable" };
		default:
			return {};
	}
}

/** One Clocking refusal as its HTTP/v2 response: a typed rejection, or an unknown outcome. */
export function refusalReply(operationId: string, refusal: ClockRefusal) {
	const { status, code } = FAILURE_REPLIES[refusal.code];
	return {
		status,
		body:
			code === "unknown"
				? { outcome: "unknown" as const, operationId }
				: { outcome: "rejected" as const, operationId, code, ...refusalDetails(refusal) },
	};
}
