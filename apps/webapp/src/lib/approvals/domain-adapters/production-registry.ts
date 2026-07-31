import { createApprovalDomainAdapterRegistry } from "./registry";
import type { ApprovalDomainAdapter } from "./types";
import type { OrdinaryWorkPeriodApprovalSource } from "./work-period-contract";

export class ApprovalDomainNotMigratedError extends Error {
	readonly workflowType: string;
	readonly sourceType: string;

	constructor(workflowType: string, sourceType: string) {
		super(
			`Approval domain adapter is not migrated: ${workflowType}/${sourceType}`,
		);
		this.name = "ApprovalDomainNotMigratedError";
		this.workflowType = workflowType;
		this.sourceType = sourceType;
	}
}

function notMigratedAdapter<TSource>(
	workflowType: string,
	sourceType: string,
): ApprovalDomainAdapter<TSource> {
	const fail = async (): Promise<never> => {
		throw new ApprovalDomainNotMigratedError(workflowType, sourceType);
	};
	return {
		workflowType: workflowType as never,
		sourceType,
		loadSource: fail,
		getTrustedCapabilities: fail,
		produceRoutingContext: fail,
		preflightCommand: fail,
		preflightTerminal: fail,
		finalizeTerminal: fail,
		projectDisplay: fail,
	};
}

export function createProductionApprovalDomainAdapterRegistry(input: {
	absence: ApprovalDomainAdapter<unknown>;
	timeCorrection: ApprovalDomainAdapter<unknown>;
	manualTimeSubmission: ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource>;
	policyClockOut: ApprovalDomainAdapter<OrdinaryWorkPeriodApprovalSource>;
}) {
	if (
		input.absence.workflowType !== "absence" ||
		input.absence.sourceType !== "absence_entry"
	) {
		throw new Error("Adapter registration mismatch for absence/absence_entry");
	}
	if (
		input.timeCorrection.workflowType !== "time_correction" ||
		input.timeCorrection.sourceType !== "time_entry"
	) {
		throw new Error(
			"Adapter registration mismatch for time_correction/time_entry",
		);
	}
	if (
		input.manualTimeSubmission.workflowType !== "manual_time_submission" ||
		input.manualTimeSubmission.sourceType !== "time_entry"
	) {
		throw new Error(
			"Adapter registration mismatch for manual_time_submission/time_entry",
		);
	}
	if (
		input.policyClockOut.workflowType !== "policy_clock_out" ||
		input.policyClockOut.sourceType !== "time_entry"
	) {
		throw new Error(
			"Adapter registration mismatch for policy_clock_out/time_entry",
		);
	}
	return createApprovalDomainAdapterRegistry({
		absence: input.absence,
		time_correction: input.timeCorrection,
		manual_time_submission: input.manualTimeSubmission,
		policy_clock_out: input.policyClockOut,
		travel_expense: notMigratedAdapter(
			"travel_expense",
			"travel_expense_claim",
		),
		shift_request: notMigratedAdapter("shift_request", "shift_request"),
		compliance_exception: notMigratedAdapter(
			"compliance_exception",
			"compliance_exception",
		),
	});
}
