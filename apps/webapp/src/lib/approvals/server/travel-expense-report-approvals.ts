import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Option, Result } from "effect";
import {
	approvalChainStageInstance,
	approvalRequest,
	employee,
	travelExpenseReport,
} from "@/db/schema";
import { getAbility } from "@/lib/auth-helpers";
import { failureOfCause as failureOf } from "@/lib/effect/cause-failure";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { onTravelExpenseReportDecided } from "@/lib/notifications/triggers";
import { recordReportApprovalTeams } from "@/lib/travel-expenses/approval-teams";
import { notifyReadyForReimbursement } from "@/lib/travel-expenses/ready-for-reimbursement";
import { acquireApprovalWriteGate } from "../authority";
import { kickApprovalDelivery } from "../delivery/kick";
import type { ApprovalActionOptions } from "../domain/types";
import {
	ApprovalAssignmentReassignedError,
	approvalReassignedConflict,
} from "../escalation/decision-authority";
import { wasLegacyRequestTransferred } from "../escalation/legacy-transfer-store";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	findLegacyDecisionEvidenceByRequest,
	isLegacyRequestInRevisionLifecycle,
	type LegacyDecisionEvidenceRecord,
	loadEvidenceActorLabel,
	recordLegacyDecisionEvidence,
} from "../evidence/store";
import { deriveLegacyTravelExpenseDecisionOutcome } from "../evidence/travel-expense-decision";
import type { TravelExpenseReportSubmittedFacts } from "../evidence/travel-expense-report-facts";
import {
	loadTravelExpenseReportSubmittedRevision,
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "../evidence/travel-expense-report-store";
import { compareTravelExpenseReportWithSubmittedRevision } from "../evidence/travel-expense-report-submission";
import { ApprovalAuditLogger, createApprovalAuditLogger } from "../infrastructure/audit-logger";
import { isOwnRequestDecision, ownRequestDecisionError } from "../policies/self-decision";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { processApprovalWithCurrentEmployee } from "./shared";
import { assertAdjustmentBaselineCurrent } from "./travel-expense-report-adjustment-guard";
import {
	beginBoundReportInvocation,
	loadBoundReportBinding,
	recordBoundReportInvocation,
	type TravelExpenseReportBoundInvocation,
} from "./travel-expense-report-bound-invocation";
import { recordTravelExpenseReportDeliveryIntent } from "./travel-expense-report-delivery";
import {
	acceptedReceiptExceptionsForCommand,
	receiptExceptionAcceptanceResult,
	requireReceiptExceptionAcceptance,
} from "./travel-expense-report-receipt-exceptions";
import type { ApprovalAction, ApprovalDatabase, ApprovalDbService, CurrentApprover } from "./types";

/**
 * Decision owner of travel expense reports (#602). One reviewer decision
 * applies to the whole frozen report. Like the expense claim owner (#296) it
 * runs the shared legacy approval mutation inside one transaction that holds
 * the `travel_expense` rollout gate, replays an exact committed retry first,
 * refuses a report whose live rows no longer match its frozen revision, and
 * records the decision evidence with the mutation. The requester never decides
 * their own report, and a rejection always carries a reason.
 */

const logger = createLogger("TravelExpenseReportApprovals");
const COMMAND_VERSION = "travel-expense-report-decision:v1";
const ENTITY_TYPE = TRAVEL_EXPENSE_REPORT_SOURCE_TYPE;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function fingerprintTravelExpenseReportDecisionCommand(input: {
	action: ApprovalAction;
	approvalRequestId: string;
	reason: string | undefined;
	/** Accepted missing-receipt exceptions (#604); only a non-empty list changes the fingerprint. */
	acceptedReceiptExceptionItemIds?: readonly string[];
}): string {
	const accepted = acceptedReceiptExceptionsForCommand(input);
	return `${COMMAND_VERSION}:${sha256(
		JSON.stringify([
			input.action,
			input.approvalRequestId,
			sha256(input.reason ?? ""),
			...(accepted.length > 0 ? [accepted] : []),
		]),
	)}`;
}

export function travelExpenseReportDecisionIdempotencyKey(input: {
	reportId: string;
	approvalRequestId: string;
	action: ApprovalAction;
	reason: string | undefined;
}): string {
	return `${ENTITY_TYPE}:${input.reportId}:${input.approvalRequestId}:${input.action}:${sha256(input.reason ?? "")}`;
}

function employeeActorFingerprint(actor: { employeeId: string; userId: string }): string {
	return fingerprintApprovalCommandActor({ kind: "employee", ...actor });
}

export interface TravelExpenseReportDecisionInput {
	organizationId: string;
	reportId: string;
	actor: CurrentApprover;
	action: ApprovalAction;
	/** Required to reject; it enters evidence only as a fingerprint. */
	reason?: string;
	/** Approve only: every missing-receipt exception of the decided revision, accepted (#604). */
	acceptedReceiptExceptionItemIds?: readonly string[];
	options?: Pick<
		ApprovalActionOptions,
		"approvalRequestId" | "allowAnyApprover" | "allowOrganizationWideApprover"
	>;
	/** Explicit organization approval management, checked by the trusted caller. */
	canManageOrganizationApproval?(): Promise<boolean>;
	/**
	 * Present only for a bound card action (#623); its authority is the binding
	 * alone, so it never carries management or eligible-manager options.
	 */
	bound?: TravelExpenseReportBoundInvocation;
}

export type TravelExpenseReportDecisionOutcome =
	| { kind: "replayed"; evidence: LegacyDecisionEvidenceRecord; approvalRequestId: string }
	| {
			kind: "decided";
			evidence: LegacyDecisionEvidenceRecord;
			approvalRequestId: string;
			/** The report's outcome; an intermediate chain stage leaves it submitted. */
			reportStatus: "submitted" | "approved" | "rejected";
			/** Totals of the decided frozen revision. */
			totals: TravelExpenseReportSubmittedFacts["totals"];
			/** A cycle-keyed `decided` intent was written; kick delivery after commit (#623). */
			deliveryIntent: boolean;
	  };

export async function findPendingReportRequestForApprover(
	database: ApprovalDatabase,
	input: { organizationId: string; reportId: string; approverId: string },
): Promise<string | undefined> {
	const rows = await database
		.select({ id: approvalRequest.id })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, ENTITY_TYPE),
				eq(approvalRequest.entityId, input.reportId),
				eq(approvalRequest.approverId, input.approverId),
				eq(approvalRequest.status, "pending"),
			),
		)
		.limit(1);
	return rows[0]?.id;
}

/** Receipt before fresh checks: an exact authenticated retry returns its original evidence. */
async function findReportDecisionReplay(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		reportId: string;
		approvalRequestId: string;
		action: ApprovalAction;
		reason: string | undefined;
		acceptedReceiptExceptionItemIds?: readonly string[];
		actor: { employeeId: string; userId: string };
	},
): Promise<LegacyDecisionEvidenceRecord | null> {
	const evidence = await findLegacyDecisionEvidenceByRequest(database, {
		organizationId: input.organizationId,
		approvalRequestId: input.approvalRequestId,
	});
	if (evidence?.operationKind !== "command") return null;
	const matches =
		evidence.receipt.idempotencyKey === travelExpenseReportDecisionIdempotencyKey(input) &&
		evidence.receipt.actorFingerprint === employeeActorFingerprint(input.actor) &&
		evidence.receipt.commandFingerprint === fingerprintTravelExpenseReportDecisionCommand(input);
	return matches ? evidence : null;
}

/** The frozen revision of the report's current submission cycle, still matching its live rows. */
export async function prepareReportDecisionEvidence(
	database: ApprovalDatabase,
	input: { organizationId: string; reportId: string },
): Promise<TravelExpenseReportSubmittedRevisionRecord> {
	const [report] = await database
		.select({ submissionCount: travelExpenseReport.submissionCount })
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, input.reportId),
				eq(travelExpenseReport.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!report) {
		throw new NotFoundError({
			message: "Expense report not found",
			entityType: ENTITY_TYPE,
			entityId: input.reportId,
		});
	}
	const revision = await loadTravelExpenseReportSubmittedRevision(database, {
		...input,
		submissionCycle: report.submissionCount,
	});
	// Every report submission is frozen; a report without one is never decided.
	if (!revision) throw new ApprovalEvidenceError("evidence_required");
	const comparison = await compareTravelExpenseReportWithSubmittedRevision(database, revision);
	if (comparison.kind === "material_change") {
		throw new ApprovalEvidenceError("material_change", {
			fields: comparison.changedFields.join(","),
		});
	}
	return revision;
}

function preflightReportDecision(
	dbService: ApprovalDbService,
	reportId: string,
	actor: CurrentApprover,
	action: ApprovalAction,
	reason: string | undefined,
) {
	return Effect.gen(function* () {
		const report = yield* dbService.query("getTravelExpenseReportForDecision", async () => {
			const rows = await dbService.db
				.select({
					employeeId: travelExpenseReport.employeeId,
					status: travelExpenseReport.status,
				})
				.from(travelExpenseReport)
				.where(
					and(
						eq(travelExpenseReport.id, reportId),
						eq(travelExpenseReport.organizationId, actor.organizationId),
					),
				)
				.limit(1);
			return rows[0];
		});
		if (!report) {
			return yield* Effect.fail(
				new NotFoundError({
					message: "Expense report not found",
					entityType: ENTITY_TYPE,
					entityId: reportId,
				}),
			);
		}
		// No management or eligibility path lets a requester decide their own report.
		if (isOwnRequestDecision({ requesterEmployeeId: report.employeeId, actorEmployeeId: actor.id })) {
			return yield* Effect.fail(
				ownRequestDecisionError({
					actorEmployeeId: actor.id,
					resource: ENTITY_TYPE,
					action,
					subject: "expense report",
				}),
			);
		}
		if (report.status !== "submitted") {
			return yield* Effect.fail(
				new ConflictError({
					message: "Only submitted expense reports can be decided",
					conflictType: "travel_expense_report_status",
				}),
			);
		}
		if (action === "reject" && !reason?.trim()) {
			return yield* Effect.fail(
				new ValidationError({
					message: "A reason is required to reject an expense report",
					field: "reason",
				}),
			);
		}
		return report;
	});
}

function persistReportDecision(
	dbService: ApprovalDbService,
	reportId: string,
	actor: CurrentApprover,
	action: ApprovalAction,
) {
	return dbService
		.query("updateTravelExpenseReportDecision", async () => {
			const decidedAt = new Date();
			return await dbService.db
				.update(travelExpenseReport)
				.set({
					status: action === "approve" ? "approved" : "rejected",
					decidedAt,
					updatedAt: decidedAt,
					updatedBy: actor.user.id,
				})
				.where(
					and(
						eq(travelExpenseReport.id, reportId),
						eq(travelExpenseReport.organizationId, actor.organizationId),
						eq(travelExpenseReport.status, "submitted"),
					),
				)
				.returning({ id: travelExpenseReport.id });
		})
		.pipe(
			Effect.flatMap((rows) =>
				rows.length === 1
					? Effect.void
					: Effect.fail(
							new ConflictError({
								message: "Only submitted expense reports can be decided",
								conflictType: "travel_expense_report_status",
							}),
						),
			),
		);
}

async function readDecisionRows(
	database: ApprovalDatabase,
	input: { organizationId: string; reportId: string; approvalRequestId: string },
) {
	const [requests, stages, reports] = await Promise.all([
		database
			.select({
				id: approvalRequest.id,
				status: approvalRequest.status,
				approverId: approvalRequest.approverId,
				approvedAt: approvalRequest.approvedAt,
				updatedAt: approvalRequest.updatedAt,
				entityType: approvalRequest.entityType,
				entityId: approvalRequest.entityId,
			})
			.from(approvalRequest)
			.where(
				and(
					eq(approvalRequest.id, input.approvalRequestId),
					eq(approvalRequest.organizationId, input.organizationId),
				),
			)
			.limit(2),
		database
			.select({
				id: approvalChainStageInstance.id,
				status: approvalChainStageInstance.status,
				decidedAt: approvalChainStageInstance.decidedAt,
				decidedBy: approvalChainStageInstance.decidedBy,
			})
			.from(approvalChainStageInstance)
			.where(
				and(
					eq(approvalChainStageInstance.organizationId, input.organizationId),
					eq(approvalChainStageInstance.approvalRequestId, input.approvalRequestId),
				),
			)
			.limit(2),
		database
			.select({ status: travelExpenseReport.status, decidedAt: travelExpenseReport.decidedAt })
			.from(travelExpenseReport)
			.where(
				and(
					eq(travelExpenseReport.id, input.reportId),
					eq(travelExpenseReport.organizationId, input.organizationId),
				),
			)
			.limit(2),
	]);
	const request = requests[0];
	const report = reports[0];
	if (
		requests.length !== 1 ||
		!request ||
		request.entityType !== ENTITY_TYPE ||
		request.entityId !== input.reportId ||
		stages.length > 1 ||
		reports.length !== 1 ||
		!report
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "legacy_request" });
	}
	return { request, chainStage: stages[0] ?? null, claim: report };
}

async function recordReportDecisionEvidence(
	database: ApprovalDatabase,
	revision: TravelExpenseReportSubmittedRevisionRecord,
	input: {
		organizationId: string;
		reportId: string;
		action: ApprovalAction;
		reason: string | undefined;
		acceptedReceiptExceptionItemIds?: readonly string[];
		approvalRequestId: string;
		actor: { employeeId: string; userId: string };
		/** A bound card decision (#623): the invocation's receipt key and the reviewed binding. */
		bound?: { idempotencyKey: string; reviewedBindingId: string };
	},
): Promise<{
	evidence: LegacyDecisionEvidenceRecord;
	reportStatus: "submitted" | "approved" | "rejected";
}> {
	if (
		!(await isLegacyRequestInRevisionLifecycle(database, {
			organizationId: input.organizationId,
			approvalRequestId: input.approvalRequestId,
			revision: { sourceType: ENTITY_TYPE, sourceId: revision.reportId, legacy: revision.legacy },
		}))
	) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "legacy_lifecycle" });
	}
	// Outcome, stage and time come from the persisted rows, never the request.
	// The shared legacy expense derivation names its subject a claim; here the
	// subject row is the report.
	const outcome = deriveLegacyTravelExpenseDecisionOutcome(
		{ action: input.action, actorEmployeeId: input.actor.employeeId },
		await readDecisionRows(database, input),
	);
	const actor = await loadEvidenceActorLabel(database, {
		organizationId: input.organizationId,
		employeeId: input.actor.employeeId,
	});
	if (!actor) throw new ApprovalEvidenceError("evidence_incomplete", { field: "actor" });
	const evidence = await recordLegacyDecisionEvidence(database, {
		organizationId: input.organizationId,
		submittedRevisionId: revision.id,
		operationKind: "command",
		...(input.bound ? { reviewedBindingId: input.bound.reviewedBindingId } : {}),
		receipt: {
			idempotencyKey:
				input.bound?.idempotencyKey ?? travelExpenseReportDecisionIdempotencyKey(input),
			actorFingerprint: employeeActorFingerprint(input.actor),
			commandFingerprint: fingerprintTravelExpenseReportDecisionCommand(input),
		},
		action: input.action,
		legacy: {
			approvalRequestId: input.approvalRequestId,
			chainStageId: outcome.chainStageId,
			observedWorkflowId: null,
		},
		assignmentOutcome: outcome.assignmentOutcome,
		requestOutcome: outcome.requestOutcome,
		actor: { kind: "employee", employeeId: input.actor.employeeId, userId: input.actor.userId },
		decidedAt: outcome.decidedAt,
		// Resulting statuses only; no payable amount is inferred here.
		result: {
			reportStatus: outcome.claimStatus,
			legacyRequestStatus: outcome.legacyRequestStatus,
			decidedAtSource: outcome.decidedAtSource,
			actorAuthority: outcome.actorAuthority,
			...receiptExceptionAcceptanceResult(input),
		},
		labels: { actorName: actor.name },
	});
	// The derivation only yields these three for a report; an intermediate
	// chain approval leaves it submitted.
	switch (outcome.requestOutcome) {
		case "pending":
			return { evidence, reportStatus: "submitted" };
		case "approved":
		case "rejected":
			return { evidence, reportStatus: outcome.requestOutcome };
		default:
			throw new ApprovalEvidenceError("evidence_incomplete", { field: "request_outcome" });
	}
}

/**
 * Runs one report decision in the caller's transaction. Order: rollout gate,
 * invocation lock, replay and admission (bound cards, #623), authority, exact
 * target request (the bound one for a card), semantic exact-retry replay
 * (web only), escalation transfer guard, frozen revision check (a card's
 * binding must name the current cycle's revision), the shared legacy
 * mutation, then decision evidence, the card's invocation and the cycle's
 * `decided` delivery intent. Any failure throws and rolls everything back.
 * The decision is approve or reject; #603 adds a return decision as a
 * separate report-only path that reuses this ordering.
 */
export async function executeTravelExpenseReportDecisionInTransaction(
	database: ApprovalDatabase,
	query: ApprovalDbService["query"],
	input: TravelExpenseReportDecisionInput,
): Promise<TravelExpenseReportDecisionOutcome> {
	const dbService: ApprovalDbService = { db: database, query };
	const { organizationId, reportId, actor, action } = input;
	if (actor.organizationId !== organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const gate = await acquireApprovalWriteGate(dbService, {
		organizationId,
		workflowType: "travel_expense",
	});
	// A bound card action (#623): an exact committed invocation replays before
	// any fresh check, then current admission is required.
	const invocation = input.bound
		? await beginBoundReportInvocation(database, {
				organizationId,
				actor,
				action,
				reason: input.reason,
				bound: input.bound,
			})
		: null;
	if (invocation?.kind === "replayed") {
		return {
			kind: "replayed",
			evidence: invocation.evidence,
			approvalRequestId: invocation.evidence.legacy.approvalRequestId,
		};
	}
	// Reports have no canonical adapter: nothing decides them under another authority.
	if (gate.authority !== "legacy") {
		throw new ApprovalEvidenceError("binding_mismatch", { field: "authority" });
	}
	const binding = input.bound
		? await loadBoundReportBinding(database, {
				organizationId,
				bindingId: input.bound.bindingId,
				actorEmployeeId: actor.id,
			})
		: null;
	const actorIdentity = { employeeId: actor.id, userId: actor.userId };
	const approvalRequestId =
		binding?.legacyApprovalRequestId ??
		input.options?.approvalRequestId ??
		(await findPendingReportRequestForApprover(database, {
			organizationId,
			reportId,
			approverId: actor.id,
		}));
	if (!approvalRequestId) {
		throw new AuthorizationError({
			message: "Approval request not found, already processed, or you are not the approver",
			userId: actor.id,
			resource: ENTITY_TYPE,
			action,
		});
	}
	// A fresh invocation never matches a semantic receipt; its own committed
	// receipt was matched above.
	const replayed = binding
		? null
		: await findReportDecisionReplay(database, {
				organizationId,
				reportId,
				approvalRequestId,
				action,
				reason: input.reason,
				acceptedReceiptExceptionItemIds: input.acceptedReceiptExceptionItemIds,
				actor: actorIdentity,
			});
	if (replayed) return { kind: "replayed", evidence: replayed, approvalRequestId };

	// The request row is locked like a transfer locks it, so competing decisions
	// serialize here; a transfer (#326) leaves only its new holder authorized.
	const [request] = await database
		.select({ id: approvalRequest.id, approverId: approvalRequest.approverId })
		.from(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, approvalRequestId),
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, ENTITY_TYPE),
				eq(approvalRequest.entityId, reportId),
			),
		)
		.limit(1)
		.for("update");
	if (!request) {
		throw new NotFoundError({
			message: "Approval request not found",
			entityType: "approval_request",
			entityId: approvalRequestId,
		});
	}
	if (
		request.approverId !== actor.id &&
		(await wasLegacyRequestTransferred(database, { organizationId, approvalRequestId })) &&
		// A card carries no management authority.
		(binding !== null || !(await input.canManageOrganizationApproval?.()))
	) {
		throw new ApprovalAssignmentReassignedError();
	}

	const revision = await prepareReportDecisionEvidence(database, { organizationId, reportId });
	if (binding && binding.submittedRevisionId !== revision.id) {
		// The card showed another cycle's (or a superseded) frozen revision.
		throw new ApprovalEvidenceError("binding_mismatch", { field: "revision" });
	}
	// #615: an adjustment is approved only against the baseline it froze.
	await assertAdjustmentBaselineCurrent(database, revision, action);
	const reason = action === "reject" ? input.reason?.trim() : undefined;
	const accepted = input.acceptedReceiptExceptionItemIds;
	const exit = await Effect.runPromiseExit(
		processApprovalWithCurrentEmployee(
			dbService,
			actor,
			ENTITY_TYPE,
			reportId,
			action,
			reason,
			(decisionDbService, decisionEntityId, approver) =>
				persistReportDecision(decisionDbService, decisionEntityId, approver, action),
			(decisionDbService, decisionEntityId, approver) =>
				preflightReportDecision(decisionDbService, decisionEntityId, approver, action, reason).pipe(
					Effect.tap(() => requireReceiptExceptionAcceptance(revision.facts, action, accepted)),
				),
			// A card decides only as the exact bound request's approver.
			{ ...(binding ? {} : input.options), approvalRequestId, transactional: true },
			undefined,
			"existing",
		).pipe(
			Effect.provideService(ApprovalAuditLogger, createApprovalAuditLogger(dbService)),
		),
	);
	if (Exit.isFailure(exit)) throw failureOf(exit.cause);

	const recorded = await recordReportDecisionEvidence(database, revision, {
		organizationId,
		reportId,
		action,
		reason,
		acceptedReceiptExceptionItemIds: accepted,
		approvalRequestId,
		actor: actorIdentity,
		...(invocation && binding
			? { bound: { idempotencyKey: invocation.key, reviewedBindingId: binding.id } }
			: {}),
	});
	if (recorded.reportStatus === "approved") {
		// The final approval records the employee's teams (#746).
		await recordReportApprovalTeams(database, { organizationId, reportId });
	}
	if (invocation && input.bound) {
		// Same transaction as the legacy mutation and its evidence.
		await recordBoundReportInvocation(database, {
			bound: input.bound,
			invocation,
			approvalRequestId,
			decisionEvidenceId: recorded.evidence.id,
		});
	}
	const deliveryIntent = await recordTravelExpenseReportDeliveryIntent(database, {
		organizationId,
		reportId,
		approvalRequestId,
		revision: revision.legacy,
		event: "decided",
	});
	return {
		kind: "decided",
		evidence: recorded.evidence,
		approvalRequestId,
		reportStatus: recorded.reportStatus,
		totals: revision.facts.totals,
		deliveryIntent,
	};
}

const EVIDENCE_CONFLICT_MESSAGES: Record<string, string> = {
	material_change:
		"This expense report changed after it was submitted. It cannot be decided; it is held for review.",
	evidence_required:
		"The submitted facts of this expense report are missing, so a decision cannot be bound to them.",
	evidence_incomplete: "This decision could not be recorded against the submitted report.",
	binding_mismatch:
		"Expense reports are decided only while the organization's expense approvals use legacy authority.",
};

/** Evidence holds surface as 409 conflicts; integrity contradictions stay errors. */
export function translateTravelExpenseReportDecisionError(error: unknown): unknown {
	if (error instanceof ApprovalAssignmentReassignedError) return approvalReassignedConflict(error);
	if (!(error instanceof ApprovalEvidenceError) || error.code === "invariant") return error;
	return new ConflictError({
		message: EVIDENCE_CONFLICT_MESSAGES[error.code] ?? "Approval evidence conflict",
		conflictType: "approval_evidence",
		details: {
			code: error.code,
			...(error.details.fields ? { changedFields: error.details.fields.split(",") } : {}),
		},
	});
}

async function notifyRequester(
	database: ApprovalDatabase,
	input: TravelExpenseReportDecisionInput,
	revision: Pick<TravelExpenseReportSubmittedFacts["totals"], "reimbursable" | "currency">,
) {
	const [requester] = await database
		.select({ userId: employee.userId })
		.from(travelExpenseReport)
		.innerJoin(employee, eq(employee.id, travelExpenseReport.employeeId))
		.where(
			and(
				eq(travelExpenseReport.id, input.reportId),
				eq(travelExpenseReport.organizationId, input.organizationId),
			),
		)
		.limit(1);
	if (!requester) return;
	await onTravelExpenseReportDecided({
		reportId: input.reportId,
		requesterUserId: requester.userId,
		organizationId: input.organizationId,
		approverName: input.actor.user.name,
		action: input.action,
		reimbursable: revision.reimbursable,
		currency: revision.currency,
		...(input.reason ? { rejectionReason: input.reason.trim() } : {}),
	});
}

/**
 * After commit: a final decision notifies the requester, a final approval the
 * covering expense officers (#756), and a written lifecycle intent kicks the
 * delivery owner. A replay repeats nothing.
 */
export async function afterTravelExpenseReportDecision(
	database: ApprovalDatabase,
	decision: TravelExpenseReportDecisionInput,
	outcome: TravelExpenseReportDecisionOutcome,
): Promise<void> {
	if (outcome.kind !== "decided") return;
	if (outcome.reportStatus !== "submitted") {
		// The decided revision's own totals; never a guessed amount.
		await notifyRequester(database, decision, outcome.totals).catch((error) =>
			logger.error({ error, reportId: decision.reportId }, "Report decision notification failed"),
		);
	}
	if (outcome.reportStatus === "approved") {
		await notifyReadyForReimbursement(database, {
			organizationId: decision.organizationId,
			reportId: decision.reportId,
		});
	}
	if (outcome.deliveryIntent) {
		kickApprovalDelivery({ organizationId: decision.organizationId });
	}
}

/**
 * Authenticated report decision (inbox). Opens its own transaction; after
 * commit a final decision notifies the requester. A replay repeats nothing.
 */
export function decideTravelExpenseReportEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	input: Omit<TravelExpenseReportDecisionInput, "organizationId" | "actor">,
): Effect.Effect<TravelExpenseReportDecisionOutcome, AnyAppError, never> {
	const decision: TravelExpenseReportDecisionInput = {
		...input,
		organizationId: currentEmployee.organizationId,
		actor: currentEmployee,
		canManageOrganizationApproval:
			input.canManageOrganizationApproval ??
			(async () => {
				const ability = await getAbility();
				return ability?.cannot("manage", "Approval") === false;
			}),
	};
	return Effect.tryPromise({
		try: async () => {
			const outcome = await dbService.db.transaction((transaction) =>
				executeTravelExpenseReportDecisionInTransaction(transaction, dbService.query, decision),
			);
			await afterTravelExpenseReportDecision(dbService.db, decision, outcome);
			return outcome;
		},
		catch: (error) => translateTravelExpenseReportDecisionError(error) as AnyAppError,
	});
}
