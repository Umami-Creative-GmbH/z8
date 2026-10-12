import type { Instant } from "@/lib/datetime/temporal-core";

export type AutoClockOutSettings = {
	autoClockOutEnabled: boolean;
	maxUninterruptedMinutes: number;
	revision: number;
};

export type AutoClockOutCandidate = {
	organizationId: string;
	employeeId: string;
	workPeriodId: string;
};

export type AutoClockOutDecision = AutoClockOutCandidate & {
	settings: AutoClockOutSettings;
	start: Instant;
	cutoff: Instant;
	/**
	 * Where the closure ends when it is not the cutoff: the start of a break in
	 * progress that began before it (#861), so the break never counts as work.
	 */
	closesAt?: Instant;
	timezone: string;
	provenanceUserId: string;
	operationId: string;
};

export type AutoClockOutOutcome =
	| { status: "closed"; operationId: string; clockOutEntryId: string }
	| { status: "replayed"; operationId: string; clockOutEntryId: string }
	| {
			status: "skipped";
			reason: "disabled" | "not_due" | "not_live" | "not_found";
	  }
	| { status: "deferred"; reason: string };

export type AutoClockOutTaskKind = "follow_up" | "plan_notification" | "notification_channel";

export type AutoClockOutTaskClaim = {
	id: string;
	organizationId: string;
	employeeId: string;
	operationId: string;
	kind: AutoClockOutTaskKind;
	payload: Record<string, unknown>;
	claimToken: string;
	attemptCount: number;
};

export type AutoClockOutDeliveryResult = {
	claimed: number;
	completed: number;
	deferred: number;
	failed: number;
};

export type AutoClockOutMaintenanceResult = {
	attempted: number;
	closed: number;
	skipped: number;
	deferred: number;
	failed: number;
	tasks: AutoClockOutDeliveryResult;
	errors: Array<{
		organizationId: string;
		workPeriodId: string;
		error: string;
	}>;
};
