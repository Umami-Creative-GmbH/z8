import "server-only";

/**
 * On-behalf clock-out (#276): an adapter over the Clocking module (#482).
 *
 * An on-behalf clock-out is a clock-out whose subject is another employee. The
 * adapter names the subject (the owner of the requested period) and the event's
 * zone (the subject's saved zone, then the organization's, then UTC); the module
 * authorizes the principal, checks billing, replays, closes the period under
 * either admission and runs the follow-ups.
 */
import { randomUUID } from "node:crypto";
import {
	attributionIntent,
	type CloseActiveWorkResult,
} from "@/lib/time-tracking/close-active-work";
import {
	type ClockOutCommand,
	type Clocking,
	type ClockOutFailure,
	type ClockOutRefusal,
	type ClockOutResult,
	clocking as defaultClocking,
	type OperationIdentity,
	workPeriodOwner,
} from "@/lib/time-tracking/clocking";
import type { OnBehalfClockOutRequest } from "@/lib/time-tracking/on-behalf-clock-out-request";
import { revalidateAfterClockOut } from "./clocking";
import { resolveManualEntryTargetZone } from "./manual-entry-target";

/** The wire codes of refusals that wrote nothing. */
type RejectionCode =
	| "access_denied"
	| "billing_required"
	| "invalid_command"
	| "target_unknown"
	| "target_not_active"
	| "collision"
	| "invalid_interval"
	| "attribution_not_allowed"
	| "append_review_required";

/** Wire codes that carry detail beyond the code; mapped case by case. */
type DetailedFailure = "billing_required" | "project_not_allowed" | "work_category_not_allowed";

export type OnBehalfClockOutRejection =
	| { code: Exclude<RejectionCode, "billing_required" | "attribution_not_allowed"> }
	| { code: "billing_required"; reason: string }
	| { code: "attribution_not_allowed"; field: "projectId" | "workCategoryId" };

/** The clock-out entry as committed, without the follow-ups' advice. */
export type OnBehalfClockOutEntry = Omit<
	ClockOutResult,
	"complianceWarnings" | "breakAdjustment" | "pendingApproval"
>;

export type OnBehalfClockOutOutcome =
	| {
			outcome: "executed" | "replayed";
			operationId: string;
			entry: OnBehalfClockOutEntry;
			/** The committed receipt result; null for a legacy (pre-adoption) closure. */
			receipt: CloseActiveWorkResult | null;
	  }
	| ({ outcome: "rejected"; operationId: string | null } & OnBehalfClockOutRejection)
	/** The closure may or may not have committed: resending the same identity replays it. */
	| { outcome: "unknown"; operationId: string | null; cause: unknown };

export type OnBehalfClockOutSession = {
	userId: string;
	activeOrganizationId: string;
};

/**
 * Every other Clocking clock-out failure as its wire code, or `unknown` where
 * work may have committed or nothing could be confirmed.
 */
const FAILURE_CODES: Record<
	Exclude<ClockOutFailure, DetailedFailure>,
	Exclude<RejectionCode, "billing_required" | "attribution_not_allowed"> | "unknown"
> = {
	access_denied: "access_denied",
	invalid_command: "invalid_command",
	// An on-behalf command carries neither an age window nor a frozen payload.
	admission_window: "invalid_command",
	frozen_not_accepted: "invalid_command",
	collision: "collision",
	append_review_required: "append_review_required",
	target_unknown: "target_unknown",
	target_not_active: "target_not_active",
	// On-behalf closures always name their period.
	not_clocked_in: "target_not_active",
	invalid_interval: "invalid_interval",
	failed: "unknown",
	unconfirmed: "unknown",
};

function rejection(refusal: ClockOutRefusal): OnBehalfClockOutRejection | null {
	switch (refusal.code) {
		case "billing_required":
			return { code: "billing_required", reason: refusal.reason };
		case "project_not_allowed":
			return { code: "attribution_not_allowed", field: "projectId" };
		case "work_category_not_allowed":
			return { code: "attribution_not_allowed", field: "workCategoryId" };
	}
	const code = FAILURE_CODES[refusal.code];
	return code === "unknown" ? null : { code };
}

/** The request as a Clocking command for the named period's owner. */
export function toOnBehalfCommand(input: {
	request: OnBehalfClockOutRequest;
	session: OnBehalfClockOutSession;
	identity: OperationIdentity;
	subjectEmployeeId: string;
	zone: string;
}): ClockOutCommand {
	const { request, session } = input;
	return {
		organizationId: session.activeOrganizationId,
		principal: { kind: "user", userId: session.userId },
		subject: { employeeId: input.subjectEmployeeId, onBehalf: true },
		identity: input.identity,
		channel: "web",
		at: { kind: "now" },
		// The subject's zone; the manager's browser never sets the event's zone.
		zone: { device: null, fallback: input.zone },
		body: {
			kind: "clock_out",
			target: { kind: "period", workPeriodId: request.workPeriodId },
			project: attributionIntent(request.projectId),
			workCategory: attributionIntent(request.workCategoryId),
		},
	};
}

/**
 * Closes a named running period on behalf of its owner. Identity-less requests
 * from old clients run under a server identity, which is never replayed.
 */
export async function closeWorkOnBehalf(input: {
	request: OnBehalfClockOutRequest;
	session: OnBehalfClockOutSession;
	clocking?: Pick<Clocking, "run">;
}): Promise<OnBehalfClockOutOutcome> {
	const { request, session } = input;
	const identity: OperationIdentity = request.operationId
		? { origin: "client", id: request.operationId }
		: { origin: "server", id: randomUUID() };
	const replyId = identity.origin === "client" ? identity.id : null;

	const owner = await workPeriodOwner(session.activeOrganizationId, request.workPeriodId);
	if (!owner) return { outcome: "rejected", operationId: replyId, code: "target_unknown" };
	const zone = await resolveManualEntryTargetZone(owner);
	const outcome = await (input.clocking ?? defaultClocking).run(
		toOnBehalfCommand({
			request,
			session,
			identity,
			subjectEmployeeId: owner.id,
			zone: zone.timezone,
		}),
	);
	if (outcome.outcome === "refused") {
		const refused = rejection(outcome.failure);
		if (!refused) {
			const cause = "cause" in outcome.failure ? outcome.failure.cause : undefined;
			return { outcome: "unknown", operationId: replyId, cause };
		}
		return { outcome: "rejected", operationId: replyId, ...refused };
	}
	if (outcome.outcome === "executed") {
		await revalidateAfterClockOut({
			organizationId: session.activeOrganizationId,
			workPeriodId: request.workPeriodId,
		});
	}
	const { complianceWarnings, breakAdjustment, pendingApproval, ...entry } = outcome.result;
	return {
		outcome: outcome.outcome,
		operationId: identity.id,
		entry,
		receipt: outcome.receipt,
	};
}
