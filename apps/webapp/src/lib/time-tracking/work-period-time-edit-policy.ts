import type { EditCapability } from "@/lib/effect/services/change-policy.service";

/**
 * What the current viewer may do with the clock-in/clock-out times of a work period.
 *
 * - `admin`: organization owners/admins edit any completed entry in the organization
 *   directly, regardless of age or date changes.
 * - `self_service`: the employee may edit their own entry directly as long as the
 *   local dates stay the same; date changes are routed through approval.
 * - `approval`: every change to the employee's own entry creates an approval request.
 * - `blocked`: editing is not possible; `reason` explains why.
 */
export type WorkPeriodTimeEditAccess =
	| { kind: "admin" }
	| { kind: "self_service" }
	| { kind: "approval" }
	| {
			kind: "blocked";
			reason: "beyond_approval_window";
			daysBack: number;
	  }
	| {
			kind: "blocked";
			reason:
				| "not_owner"
				| "running"
				| "pending_correction"
				| "pending_approval";
	  };

export type WorkPeriodTimeEditRoute =
	| "admin_direct"
	| "self_service_direct"
	| "approval_request";

export function resolveWorkPeriodTimeEditAccess(input: {
	isOrgAdmin: boolean;
	isOwnEntry: boolean;
	isCompleted: boolean;
	approvalStatus: "approved" | "pending" | "rejected" | null;
	hasPendingCorrection: boolean;
	/** Resolved change-policy capability; only consulted for non-admin owners. */
	capability: EditCapability | null;
}): WorkPeriodTimeEditAccess {
	if (!input.isOrgAdmin && !input.isOwnEntry) {
		return { kind: "blocked", reason: "not_owner" };
	}
	if (!input.isCompleted) {
		return { kind: "blocked", reason: "running" };
	}
	if (input.hasPendingCorrection) {
		return { kind: "blocked", reason: "pending_correction" };
	}
	if (input.approvalStatus === "pending") {
		return { kind: "blocked", reason: "pending_approval" };
	}
	if (input.isOrgAdmin) {
		return { kind: "admin" };
	}

	// No capability means no change policy could be resolved; keep the least
	// permissive path so the change still reaches a manager.
	const capability = input.capability;
	if (!capability || capability.type === "approval_required") {
		return { kind: "approval" };
	}
	if (capability.type === "direct") {
		return { kind: "self_service" };
	}
	return {
		kind: "blocked",
		reason: "beyond_approval_window",
		daysBack: capability.daysBack,
	};
}

export function resolveWorkPeriodTimeEditRoute(
	access: WorkPeriodTimeEditAccess,
	change: { datesChanged: boolean },
): WorkPeriodTimeEditRoute | null {
	switch (access.kind) {
		case "admin":
			return "admin_direct";
		case "self_service":
			return change.datesChanged ? "approval_request" : "self_service_direct";
		case "approval":
			return "approval_request";
		case "blocked":
			return null;
	}
}

export interface WorkPeriodTimeEditValues {
	clockInDate: string;
	clockInTime: string;
	clockOutDate: string;
	clockOutTime: string;
}

export function haveWorkPeriodDatesChanged(
	original: WorkPeriodTimeEditValues,
	next: WorkPeriodTimeEditValues,
): boolean {
	return (
		original.clockInDate !== next.clockInDate ||
		original.clockOutDate !== next.clockOutDate
	);
}

export function haveWorkPeriodTimesChanged(
	original: WorkPeriodTimeEditValues,
	next: WorkPeriodTimeEditValues,
): boolean {
	return (
		haveWorkPeriodDatesChanged(original, next) ||
		original.clockInTime !== next.clockInTime ||
		original.clockOutTime !== next.clockOutTime
	);
}
