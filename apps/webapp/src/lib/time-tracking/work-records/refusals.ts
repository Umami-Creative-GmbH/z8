import "server-only";

/**
 * Turning work records' outcomes into the errors interactive callers have
 * always thrown, so their refusal mapping (`describeAmendmentFailure` and the
 * actions' own) keeps working. Callers that defer instead of refusing (the
 * automatic break) inspect the refusal kind themselves.
 */
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { monthClosedError } from "../closed-months/refusal";
import { TimeEntryAppendReviewRequiredError } from "../time-entry-append";
import { workVehicleUseRefusal } from "../vehicle-use/work-vehicle-use-eligibility";
import { WorkOccupancyConflictError } from "../work-occupancy";
import type { WorkRecordRefusal, WorkRecordRefusalKind } from "./change";
import { UnrepresentableWorkAttributionError } from "./work-attribution";

/** Evidence the work graph needs review before this operation may change it. */
export class CompletedWorkReviewRequiredError extends Error {
	constructor(
		readonly reason: "canonical_record_missing" | "canonical_divergence" | "endpoint_entry_missing",
	) {
		super("This work needs review before it can be changed");
		this.name = "CompletedWorkReviewRequiredError";
	}
}

const REFUSAL_KINDS = new Set<WorkRecordRefusalKind>([
	"not_found",
	"stale",
	"work_running",
	"work_not_live",
	"canonical_record_missing",
	"canonical_divergence",
	"endpoint_entry_missing",
	"endpoint_superseded",
	"instant_outside_work",
	"vehicle_use_refused",
	"attribution_unrepresentable",
	"month_closed",
	"work_occupied",
	"append_review_required",
] satisfies WorkRecordRefusalKind[]);

export function isWorkRecordRefusal(outcome: { kind: string }): outcome is WorkRecordRefusal {
	return REFUSAL_KINDS.has(outcome.kind as WorkRecordRefusalKind);
}

/** The applied result, or today's error for the refusal. */
export function orRefuse<T extends { kind: string }>(outcome: T | WorkRecordRefusal): T {
	if (!isWorkRecordRefusal(outcome)) return outcome as T;
	throw refusalError(outcome);
}

export function refusalError(refusal: WorkRecordRefusal): Error {
	switch (refusal.kind) {
		case "not_found":
			return new NotFoundError({
				message: "Work period not found",
				entityType: "workPeriod",
				entityId: refusal.workPeriodId,
			});
		case "stale":
			return new ConflictError({
				message: "Work period changed while editing",
				conflictType: "time_correction_work_period_stale",
			});
		case "work_running":
			return new ConflictError({
				message: "Cannot split an active work period",
				conflictType: "work_period_running",
			});
		case "work_not_live":
			return new ConflictError({
				message: "Work is no longer live",
				conflictType: "work_period_not_live",
			});
		case "canonical_record_missing":
		case "canonical_divergence":
		case "endpoint_entry_missing":
			return new CompletedWorkReviewRequiredError(refusal.kind);
		case "endpoint_superseded":
			return new ConflictError({
				message: "Time entry was already corrected by another process",
				conflictType: "time_entry_already_corrected",
			});
		case "instant_outside_work":
			return new ValidationError({
				message: "Split time must be between work period start and end times",
				field: "splitTime",
			});
		case "vehicle_use_refused":
			return workVehicleUseRefusal(refusal.code);
		case "attribution_unrepresentable":
			return new UnrepresentableWorkAttributionError(refusal.reason);
		case "month_closed":
			return monthClosedError(refusal.month);
		case "work_occupied":
			return new WorkOccupancyConflictError(refusal.occupants);
		case "append_review_required":
			return new TimeEntryAppendReviewRequiredError(refusal.requirement);
	}
}
