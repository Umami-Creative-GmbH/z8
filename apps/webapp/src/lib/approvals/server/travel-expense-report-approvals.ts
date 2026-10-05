import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Option } from "effect";
import {
	approvalChainStageInstance,
	approvalRequest,
	employee,
	travelExpenseReport,
} from "@/db/schema";
import { getAbility } from "@/lib/auth-helpers";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { onTravelExpenseReportDecided } from "@/lib/notifications/triggers";
import { acquireApprovalWriteGate } from "../authority";
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
import {
	loadTravelExpenseReportSubmittedRevision,
	TRAVEL_EXPENSE_REPORT_SOURCE_TYPE,
	type TravelExpenseReportSubmittedRevisionRecord,
} from "../evidence/travel-expense-report-store";
import { compareTravelExpenseReportWithSubmittedRevision } from "../evidence/travel-expense-report-submission";
import { ApprovalAuditLogger, createApprovalAuditLogger } from "../infrastructure/audit-logger";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { processApprovalWithCurrentEmployee } from "./shared";
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
}): string {
	return `${COMMAND_VERSION}:${sha256(
		JSON.stringify([input.action, input.approvalRequestId, sha256(input.reason ?? "")]),
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
	options?: Pick<
		ApprovalActionOptions,
		"approvalRequestId" | "allowAnyApprover" | "allowOrganizationWideApprover"
	>;
	/** Explicit organization approval management, checked by the trusted caller. */
	canManageOrganizationApproval?(): Promise<boolean>;
}

export type TravelExpenseReportDecisionOutcome =
	| { kind: "replayed"; evidence: LegacyDecisionEvidenceRecord; approvalRequestId: string }
	| {
			kind: "decided";
			evidence: LegacyDecisionEvidenceRecord;
			approvalRequestId: string;
			/** The report's outcome; an intermediate chain stage leaves it pending. */
			reportStatus: "submitted" | "approved" | "rejected";
	  };

async function findPendingReportRequestForApprover(
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
async function prepareReportDecisionEvidence(
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
	return Effect.gen(function* (_) {
		const report = yield* _(
			dbService.query("getTravelExpenseReportForDecision", async () => {
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
			}),
		);
		if (!report) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Expense report not found",
						entityType: ENTITY_TYPE,
						entityId: reportId,
					}),
				),
			);
		}
		// No management or eligibility path lets a requester decide their own report.
		if (report.employeeId === actor.id) {
			return yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "You cannot decide your own expense report",
						userId: actor.id,
						resource: ENTITY_TYPE,
						action,
					}),
				),
			);
		}
		if (report.status !== "submitted") {
			return yield* _(
				Effect.fail(
					new ConflictError({
						message: "Only submitted expense reports can be decided",
						conflictType: "travel_expense_report_status",
					}),
				),
			);
		}
		if (action === "reject" && !reason?.trim()) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "A reason is required to reject an expense report",
						field: "reason",
					}),
				),
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
		approvalRequestId: string;
		actor: { employeeId: string; userId: string };
	},
): Promise<{ evidence: LegacyDecisionEvidenceRecord; reportStatus: string }> {
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
		receipt: {
			idempotencyKey: travelExpenseReportDecisionIdempotencyKey(input),
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
		},
		labels: { actorName: actor.name },
	});
	return { evidence, reportStatus: outcome.claimStatus };
}

function failureOf(cause: Cause.Cause<unknown>): unknown {
	return (
		Option.getOrNull(Cause.failureOption(cause)) ??
		[...Cause.defects(cause)][0] ??
		new Error("An error has occurred")
	);
}

/**
 * Runs one report decision in the caller's transaction. Order: rollout gate,
 * exact target request, exact-retry replay, escalation transfer guard, frozen
 * revision check, the shared legacy mutation, then decision evidence. Any
 * failure throws and rolls everything back.
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
	// Reports have no canonical adapter: nothing decides them under another authority.
	if (gate.authority !== "legacy") {
		throw new ApprovalEvidenceError("binding_mismatch", { field: "authority" });
	}
	const actorIdentity = { employeeId: actor.id, userId: actor.userId };
	const approvalRequestId =
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
	const replayed = await findReportDecisionReplay(database, {
		organizationId,
		reportId,
		approvalRequestId,
		action,
		reason: input.reason,
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
		!(await input.canManageOrganizationApproval?.())
	) {
		throw new ApprovalAssignmentReassignedError();
	}

	const revision = await prepareReportDecisionEvidence(database, { organizationId, reportId });
	const reason = action === "reject" ? input.reason?.trim() : undefined;
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
				preflightReportDecision(decisionDbService, decisionEntityId, approver, action, reason),
			{ ...input.options, approvalRequestId, transactional: true },
			undefined,
			"existing",
		).pipe(
			Effect.provideService(ApprovalAuditLogger, createApprovalAuditLogger(dbService)),
		) as Effect.Effect<unknown, AnyAppError, never>,
	);
	if (Exit.isFailure(exit)) throw failureOf(exit.cause);

	const recorded = await recordReportDecisionEvidence(database, revision, {
		organizationId,
		reportId,
		action,
		reason,
		approvalRequestId,
		actor: actorIdentity,
	});
	return {
		kind: "decided",
		evidence: recorded.evidence,
		approvalRequestId,
		reportStatus: recorded.reportStatus as "submitted" | "approved" | "rejected",
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
	revision: { reimbursable: string; currency: string },
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
			if (outcome.kind === "decided" && outcome.reportStatus !== "submitted") {
				const revision = await loadTravelExpenseReportSubmittedRevision(dbService.db, {
					organizationId: decision.organizationId,
					reportId: decision.reportId,
				});
				await notifyRequester(dbService.db, decision, {
					reimbursable: revision?.facts.totals.reimbursable ?? "0.00",
					currency: revision?.facts.totals.currency ?? "EUR",
				}).catch((error) =>
					logger.error({ error, reportId: input.reportId }, "Report decision notification failed"),
				);
			}
			return outcome;
		},
		catch: (error) => translateTravelExpenseReportDecisionError(error) as AnyAppError,
	});
}
