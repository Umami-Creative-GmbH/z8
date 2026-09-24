import type { db } from "@/db";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { UpsertEmploymentHistory } from "@/lib/validations/employment-history";

export type LifecycleTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DepartureStatus = "pending" | "canceled" | "blocked" | "effective";
export type DepartureMode = "scheduled" | "immediate";

export type LifecycleActor = { userId: string; organizationId: string };

export type ScheduleDeparture = {
	employeeId: string;
	requestId: string;
	expectedRevision: number | null;
	lastWorkingDay: string;
	replacementEmployeeId: string | null;
	acknowledgeUnassignedDuties: boolean;
};

export type CancelDeparture = {
	employeeId: string;
	departureId: string;
	expectedRevision: number;
	requestId: string;
};

export type OffboardNow = {
	employeeId: string;
	requestId: string;
	replacementEmployeeId: string | null;
	acknowledgeUnassignedDuties: boolean;
};

export type DepartureIdentity = {
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string;
	departureId: string;
	revision: number;
};

export type ExecuteDepartureResult =
	| { status: "effective"; departureId: string; followUpPending: boolean }
	| { status: "blocked"; departureId: string; reason: string }
	| { status: "not_due" | "obsolete" };

export type DepartureClockOutResult =
	| { kind: "not_running" }
	| { kind: "closed"; workPeriodId: string; clockOutEntryId: string }
	| { kind: "repair_required"; workPeriodId: string | null; reason: string };

/**
 * Closes the target's running work period at the cutoff inside the lifecycle
 * transaction. Slice 2 supplies the canonical clocking implementation; there is
 * deliberately no production no-op.
 */
export interface DepartureClockOutPort {
	close(
		input: DepartureIdentity & {
			transaction: LifecycleTransaction;
			cutoff: Instant;
			actorUserId: string;
			clockOutActionId: string;
		},
	): Promise<DepartureClockOutResult>;
}

/**
 * New-period start, active status and confirmed review state are assigned by
 * the rehire service and are never accepted from the client.
 */
export type RehireEmployee = {
	employeeId: string;
	requestId: string;
	previousEmploymentPeriodId: string;
	role: "admin" | "manager" | "employee";
	teamId: string | null;
	primaryManagerId: string | null;
	workPolicyId: string;
	weeklyContractMinutes: number;
	contractType: UpsertEmploymentHistory["contractType"];
	workModel: UpsertEmploymentHistory["workModel"];
	hourlyRate: UpsertEmploymentHistory["hourlyRate"];
	currency: UpsertEmploymentHistory["currency"];
	/** ISO calendar dates, interpreted in the organization zone on the server. */
	probationStartsOn: string | null;
	probationEndsOn: string | null;
	changeReason: string | null;
};
