import {
	CANONICAL_ONLY_MODE_UNAVAILABLE,
	readApprovalWriteGateOpenSnapshot,
} from "@/lib/approvals/authority";
import { periodSubmissionRoutingContext } from "@/lib/approvals/domain-adapters/period-submission.adapter";
import {
	PERIOD_SUBMISSION_SOURCE_TYPE,
	PERIOD_SUBMISSION_WORKFLOW_TYPE,
} from "@/lib/approvals/domain-adapters/period-submission-contract";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { createDatabaseStageActivationResolver } from "@/lib/approvals/routing/stage-activation-resolver";
import type { JsonObject } from "@/lib/approvals/workflow/ports";
import { normalizeStableData } from "@/lib/approvals/workflow/stable-data";
import {
	ApprovalWorkflowStartError,
	planApprovalWorkflowStart,
} from "@/lib/approvals/workflow/start-workflow";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { PeriodSubmissionDatabase } from "./submission-store";

/**
 * How a period submission is routed (#1059), shared by submitting and by readiness (#1348): a
 * matching period submission policy, else the primary eligible manager, never the employee
 * themselves. Routing does not depend on the period, only on the employee.
 */

export interface PeriodSubmitter {
	organizationId: string;
	employeeId: string;
	teamId: string | null;
}

/** The routing inputs a period submission starts its workflow with. */
export async function periodSubmissionRouting(
	database: PeriodSubmissionDatabase,
	input: PeriodSubmitter & { submissionId: string },
) {
	const teamIds = input.teamId ? [input.teamId] : [];
	const defaultApproverEmployeeId = await getPrimaryEligibleManagerIdForRequester({
		db: database as never,
		requesterEmployeeId: input.employeeId,
		organizationId: input.organizationId,
	});
	return {
		teamIds,
		defaultApproverEmployeeId,
		routingContext: periodSubmissionRoutingContext({
			organizationId: input.organizationId,
			submissionId: input.submissionId,
			requesterEmployeeId: input.employeeId,
			teamIds,
		}),
	};
}

/** Whether a workflow start failed because nobody other than the employee can decide it. */
export function isNoApproverStartError(error: unknown): boolean {
	return (
		error instanceof ApprovalWorkflowStartError &&
		(error.code === "NO_DEFAULT_APPROVER" || error.code === "ACTIVATION_FAILED")
	);
}

/**
 * Whether the stage resolver itself failed (a thrown error, such as a lost connection), rather
 * than finding nobody: submitting still refuses that as no approver, but readiness cannot say so.
 */
function isResolverFailure(error: unknown): boolean {
	return (
		error instanceof ApprovalWorkflowStartError &&
		error.code === "ACTIVATION_FAILED" &&
		error.details.activationCode === "resolver_failure"
	);
}

/**
 * Whether a workflow start was refused by the approval write gate: the gate gave the kind no
 * canonical authority (`WRITE_GATE_REJECTED`), or, for a canonical-only kind such as period
 * submissions, found its stored rollout outside `complete` mode.
 */
export function isWriteGateRefusal(error: unknown): boolean {
	return (
		(error instanceof ApprovalWorkflowStartError && error.code === "WRITE_GATE_REJECTED") ||
		(error instanceof Error && error.message === CANONICAL_ONLY_MODE_UNAVAILABLE)
	);
}

/**
 * Whether the approval write gate would let a period submission start now, read as a snapshot:
 * no lock, no rollout row inserted. It answers as the gated read does (a missing row is the kind's
 * initial `complete` mode; a canonical-only kind passes only in `complete` mode). Advisory:
 * submitting acquires the gate itself.
 */
export function isPeriodSubmissionWriteGateOpen(
	database: PeriodSubmissionDatabase,
	organizationId: string,
): Promise<boolean> {
	return readApprovalWriteGateOpenSnapshot(database as never, {
		organizationId,
		workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
	});
}

/** Stands in for the submission row a real start binds; nothing is written under it. */
const READINESS_SOURCE_ID = "00000000-0000-4000-8000-000000000000";

/**
 * Whether submitting would find an approver now: plans the workflow start exactly as submitting
 * does (policies, fallbacks, self-approval restrictions, departures) and persists nothing.
 * Throws on anything else that would also fail a submission.
 */
export async function canRoutePeriodSubmission(
	database: PeriodSubmissionDatabase,
	input: PeriodSubmitter & { now: Instant },
): Promise<boolean> {
	const routing = await periodSubmissionRouting(database, {
		...input,
		submissionId: READINESS_SOURCE_ID,
	});
	try {
		const planned = await planApprovalWorkflowStart({
			context: {
				dbService: { db: database as never },
				activationResolver: createDatabaseStageActivationResolver(),
			},
			organizationId: input.organizationId,
			workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
			sourceIdentity: {
				organizationId: input.organizationId,
				workflowType: PERIOD_SUBMISSION_WORKFLOW_TYPE,
				sourceType: PERIOD_SUBMISSION_SOURCE_TYPE,
				sourceId: READINESS_SOURCE_ID,
			},
			requesterEmployeeId: input.employeeId,
			submissionKey: `period-submission-readiness:${input.employeeId}`,
			defaultApproverEmployeeId: routing.defaultApproverEmployeeId,
			routingContext: routing.routingContext,
			contextSnapshot: normalizeStableData(routing.routingContext) as JsonObject,
			displaySnapshot: {},
			now: input.now,
		});
		// The resolver never lets a period submission complete itself; submitting refuses to go on.
		if (planned.snapshot.status !== "pending") {
			throw new Error("Period submission workflow would not start pending");
		}
		return true;
	} catch (error) {
		// A resolver that failed has not found nobody: the read fails instead (#1302 review).
		if (isResolverFailure(error)) throw error;
		if (isNoApproverStartError(error)) return false;
		throw error;
	}
}
