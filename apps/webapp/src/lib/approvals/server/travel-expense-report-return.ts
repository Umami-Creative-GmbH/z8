import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Option, Result } from "effect";
import {
	approvalChainStageInstance,
	approvalRequest,
	employee,
	travelExpenseReport,
	travelExpenseReportCycleClosure,
	travelExpenseReportReviewNote,
} from "@/db/schema";
import type { TravelExpenseReportCycleClosureKind } from "@/db/schema/travel-expense-review";
import { dateFromInstant, instantFromDate } from "@/lib/datetime/temporal-core";
import { failureOfCause as failureOf } from "@/lib/effect/cause-failure";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { createLogger } from "@/lib/logger";
import { onTravelExpenseReportReturned } from "@/lib/notifications/triggers";
import {
	type ParsedReturnReport,
	parseReturnReportInput,
	type ReturnReportInput,
} from "@/lib/travel-expenses/report-return";
import { acquireApprovalWriteGate } from "../authority";
import { kickApprovalDelivery } from "../delivery/kick";
import type { ApprovalActionOptions } from "../domain/types";
import { ApprovalAssignmentReassignedError } from "../escalation/decision-authority";
import { wasLegacyRequestTransferred } from "../escalation/legacy-transfer-store";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	findLegacyDecisionEvidenceByRequest,
	isLegacyRequestInRevisionLifecycle,
	type LegacyDecisionEvidenceRecord,
	loadEvidenceActorLabel,
	recordLegacyDecisionEvidence,
} from "../evidence/store";
import { TRAVEL_EXPENSE_REPORT_SOURCE_TYPE } from "../evidence/travel-expense-report-store";
import {
	ApprovalAuditLogger,
	createApprovalReturnAuditLogger,
} from "../infrastructure/audit-logger";
import { isOwnRequestDecision, ownRequestDecisionError } from "../policies/self-decision";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import { processApprovalWithCurrentEmployee } from "./shared";
import {
	findPendingReportRequestForApprover,
	prepareReportDecisionEvidence,
	translateTravelExpenseReportDecisionError,
} from "./travel-expense-report-approvals";
import { recordTravelExpenseReportDeliveryIntent } from "./travel-expense-report-delivery";
import type { ApprovalDatabase, ApprovalDbService, CurrentApprover } from "./types";

/**
 * Return owner of travel expense reports (#603). A reviewer sends the whole
 * frozen submission back for changes with a required note and optional item
 * comments. It follows the decision owner's order (rollout gate, exact target
 * request, exact-retry replay, request lock, transfer guard, frozen revision
 * check) and closes the cycle's pending legacy request and chain stage through
 * the shared legacy mutation, as a non-approval. The report becomes `returned`
 * and editable; the closed cycle, its revision, note and comments are kept.
 *
 * Legacy evidence knows only approve and reject, so a return is recorded as a
 * non-approving (`reject`) operation whose result names the `returned` report;
 * its receipt keys carry `return`, so neither a return nor a rejection can ever
 * replay the other. Reopening an approved report (#614) closes its cycle with
 * the same closure record.
 */

const logger = createLogger("TravelExpenseReportReturn");
const COMMAND_VERSION = "travel-expense-report-return:v1";
const ENTITY_TYPE = TRAVEL_EXPENSE_REPORT_SOURCE_TYPE;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

/** The returned content as entered; blank comments never change it. */
function returnContentDigest(input: ReturnReportInput): string {
	const comments = input.itemComments
		.map((comment) => [comment.itemId, comment.body.trim()] as const)
		.filter(([, body]) => body.length > 0)
		.toSorted(([left], [right]) => left.localeCompare(right));
	return sha256(JSON.stringify([input.note.trim(), comments]));
}

export function fingerprintTravelExpenseReportReturnCommand(input: {
	approvalRequestId: string;
	content: ReturnReportInput;
}): string {
	return `${COMMAND_VERSION}:${sha256(
		JSON.stringify(["return", input.approvalRequestId, returnContentDigest(input.content)]),
	)}`;
}

export function travelExpenseReportReturnIdempotencyKey(input: {
	reportId: string;
	approvalRequestId: string;
	content: ReturnReportInput;
}): string {
	return `${ENTITY_TYPE}:${input.reportId}:${input.approvalRequestId}:return:${returnContentDigest(input.content)}`;
}

export interface TravelExpenseReportReturnInput extends ReturnReportInput {
	organizationId: string;
	reportId: string;
	actor: CurrentApprover;
	options?: Pick<
		ApprovalActionOptions,
		"approvalRequestId" | "allowAnyApprover" | "allowOrganizationWideApprover"
	>;
	/** Explicit organization approval management, checked by the trusted caller. */
	canManageOrganizationApproval?(): Promise<boolean>;
}

export type TravelExpenseReportReturnOutcome = {
	kind: "returned" | "replayed";
	evidence: LegacyDecisionEvidenceRecord;
	approvalRequestId: string;
	closureId: string;
	submissionCycle: number;
	/** A withdrawn delivery intent of the cycle committed; kick the delivery owner. */
	deliveryIntent: boolean;
};

function statusConflict(): ConflictError {
	return new ConflictError({
		message: "Only submitted expense reports can be returned",
		conflictType: "travel_expense_report_status",
	});
}

function preflightReportReturn(
	dbService: ApprovalDbService,
	reportId: string,
	actor: CurrentApprover,
	note: string,
) {
	return Effect.gen(function* () {
		const report = yield* dbService.query("getTravelExpenseReportForReturn", async () => {
			const rows = await dbService.db
				.select({ employeeId: travelExpenseReport.employeeId, status: travelExpenseReport.status })
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
		if (isOwnRequestDecision({ requesterEmployeeId: report.employeeId, actorEmployeeId: actor.id })) {
			return yield* Effect.fail(
				ownRequestDecisionError({
					actorEmployeeId: actor.id,
					resource: ENTITY_TYPE,
					action: "reject",
					subject: "expense report",
				}),
			);
		}
		if (report.status !== "submitted") return yield* Effect.fail(statusConflict());
		if (!note.trim()) {
			return yield* Effect.fail(
				new ValidationError({
					message: "A note is required to return an expense report",
					field: "note",
				}),
			);
		}
		return report;
	});
}

function persistReportReturn(
	dbService: ApprovalDbService,
	reportId: string,
	actor: CurrentApprover,
) {
	return dbService
		.query("returnTravelExpenseReport", async () => {
			const returnedAt = new Date();
			return await dbService.db
				.update(travelExpenseReport)
				.set({
					status: "returned",
					decidedAt: returnedAt,
					updatedAt: returnedAt,
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
			Effect.flatMap((rows) => (rows.length === 1 ? Effect.void : Effect.fail(statusConflict()))),
		);
}

function incomplete(field: string): never {
	throw new ApprovalEvidenceError("evidence_incomplete", { field });
}

/** The committed return, read back from the persisted legacy rows. */
async function deriveReturnOutcome(
	database: ApprovalDatabase,
	input: { organizationId: string; reportId: string; approvalRequestId: string; actorId: string },
) {
	const [requests, stages, reports] = await Promise.all([
		database
			.select({
				status: approvalRequest.status,
				approverId: approvalRequest.approverId,
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
		incomplete("legacy_request");
	}
	if (request.status !== "rejected") incomplete("assignment_outcome");
	const stage = stages[0] ?? null;
	if (stage && (stage.status !== "rejected" || stage.decidedBy !== input.actorId)) {
		incomplete("assignment_outcome");
	}
	const decidedAt = stage ? stage.decidedAt : request.updatedAt;
	if (!decidedAt) incomplete("assignment_outcome");
	if (report.status !== "returned" || !report.decidedAt) incomplete("request_outcome");
	return {
		chainStageId: stage?.id ?? null,
		decidedAt: instantFromDate(decidedAt),
		decidedAtSource: stage
			? "approval_chain_stage_instance.decided_at"
			: "approval_request.updated_at",
		actorAuthority:
			request.approverId === input.actorId ? "assigned_approver" : "other_authorized_approver",
		legacyRequestStatus: request.status,
	};
}

async function findClosure(
	database: ApprovalDatabase,
	input: { organizationId: string; reportId: string; approvalRequestId: string },
) {
	const [closure] = await database
		.select({
			id: travelExpenseReportCycleClosure.id,
			submissionCycle: travelExpenseReportCycleClosure.submissionCycle,
		})
		.from(travelExpenseReportCycleClosure)
		.where(
			and(
				eq(travelExpenseReportCycleClosure.organizationId, input.organizationId),
				eq(travelExpenseReportCycleClosure.reportId, input.reportId),
				eq(travelExpenseReportCycleClosure.approvalRequestId, input.approvalRequestId),
				eq(travelExpenseReportCycleClosure.kind, "returned"),
			),
		)
		.limit(1);
	return closure ?? null;
}

/** Inserts the closed cycle and its item comments in the return's transaction. */
export async function recordTravelExpenseReportCycleClosure(
	database: ApprovalDatabase,
	input: {
		organizationId: string;
		reportId: string;
		submissionCycle: number;
		kind: TravelExpenseReportCycleClosureKind;
		submittedRevisionId: string;
		approvalRequestId: string;
		decisionEvidenceId: string | null;
		actor: { employeeId: string; userId: string };
		returned: ParsedReturnReport | null;
		at: Date;
	},
): Promise<string> {
	const [closure] = await database
		.insert(travelExpenseReportCycleClosure)
		.values({
			organizationId: input.organizationId,
			reportId: input.reportId,
			submissionCycle: input.submissionCycle,
			kind: input.kind,
			note: input.returned?.note ?? null,
			submittedRevisionId: input.submittedRevisionId,
			approvalRequestId: input.approvalRequestId,
			decisionEvidenceId: input.decisionEvidenceId,
			actorEmployeeId: input.actor.employeeId,
			actorUserId: input.actor.userId,
			createdAt: input.at,
		})
		.returning({ id: travelExpenseReportCycleClosure.id });
	if (!closure) throw new Error("Failed to record the closed report cycle");
	const comments = input.returned?.itemComments ?? [];
	if (comments.length > 0) {
		await database.insert(travelExpenseReportReviewNote).values(
			comments.map((comment) => ({
				organizationId: input.organizationId,
				closureId: closure.id,
				itemId: comment.itemId,
				body: comment.body,
				createdAt: input.at,
			})),
		);
	}
	return closure.id;
}

/**
 * Runs one return in the caller's transaction. Any failure throws and rolls
 * the whole return back, including the closed request, evidence and notes.
 */
export async function executeTravelExpenseReportReturnInTransaction(
	database: ApprovalDatabase,
	query: ApprovalDbService["query"],
	input: TravelExpenseReportReturnInput,
): Promise<TravelExpenseReportReturnOutcome> {
	const dbService: ApprovalDbService = { db: database, query };
	const { organizationId, reportId, actor } = input;
	if (actor.organizationId !== organizationId) {
		throw new ApprovalEvidenceError("invariant", { field: "organization" });
	}
	const gate = await acquireApprovalWriteGate(dbService, {
		organizationId,
		workflowType: "travel_expense",
	});
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
			action: "reject",
		});
	}
	const content: ReturnReportInput = { note: input.note, itemComments: input.itemComments };
	const receipt = {
		idempotencyKey: travelExpenseReportReturnIdempotencyKey({
			reportId,
			approvalRequestId,
			content,
		}),
		actorFingerprint: fingerprintApprovalCommandActor({ kind: "employee", ...actorIdentity }),
		commandFingerprint: fingerprintTravelExpenseReportReturnCommand({ approvalRequestId, content }),
	};
	const committed = await findLegacyDecisionEvidenceByRequest(database, {
		organizationId,
		approvalRequestId,
	});
	if (
		committed?.operationKind === "command" &&
		committed.receipt.idempotencyKey === receipt.idempotencyKey &&
		committed.receipt.actorFingerprint === receipt.actorFingerprint &&
		committed.receipt.commandFingerprint === receipt.commandFingerprint
	) {
		const closure = await findClosure(database, { organizationId, reportId, approvalRequestId });
		if (!closure) throw new ApprovalEvidenceError("invariant", { field: "report_closure" });
		return {
			kind: "replayed",
			evidence: committed,
			approvalRequestId,
			closureId: closure.id,
			submissionCycle: closure.submissionCycle,
			deliveryIntent: false,
		};
	}

	// Locked like a decision locks it: a competing decision, transfer or
	// return of this request serializes here.
	const [request] = await database
		.select({
			id: approvalRequest.id,
			approverId: approvalRequest.approverId,
			status: approvalRequest.status,
		})
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
	// A decided, returned, withdrawn or superseded cycle is never returned again.
	if (request.status !== "pending") {
		throw new ConflictError({
			message: "Approval request is no longer pending",
			conflictType: "approval_status",
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
	const parsed = parseReturnReportInput(
		content,
		revision.facts.items.map((item) => item.itemId),
	);
	if (!parsed.ok) {
		throw new ValidationError({
			message:
				parsed.error === "note_required"
					? "A note is required to return an expense report"
					: `The return could not be recorded: ${parsed.error}`,
			field:
				parsed.error === "note_required" || parsed.error === "note_too_long"
					? "note"
					: "itemComments",
		});
	}
	const note = parsed.value.note;
	const exit = await Effect.runPromiseExit(
		processApprovalWithCurrentEmployee(
			dbService,
			actor,
			ENTITY_TYPE,
			reportId,
			"reject",
			note,
			(returnDbService, returnEntityId, approver) =>
				persistReportReturn(returnDbService, returnEntityId, approver),
			(returnDbService, returnEntityId, approver) =>
				preflightReportReturn(returnDbService, returnEntityId, approver, note),
			{ ...input.options, approvalRequestId, transactional: true },
			undefined,
			"existing",
		).pipe(
			Effect.provideService(ApprovalAuditLogger, createApprovalReturnAuditLogger(dbService)),
		),
	);
	if (Exit.isFailure(exit)) throw failureOf(exit.cause);

	if (
		!(await isLegacyRequestInRevisionLifecycle(database, {
			organizationId,
			approvalRequestId,
			revision: { sourceType: ENTITY_TYPE, sourceId: revision.reportId, legacy: revision.legacy },
		}))
	) {
		incomplete("legacy_lifecycle");
	}
	const outcome = await deriveReturnOutcome(database, {
		organizationId,
		reportId,
		approvalRequestId,
		actorId: actor.id,
	});
	// Inside the return transaction: its queries share one connection and run in order anyway.
	// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
	const actorLabel = await loadEvidenceActorLabel(database, {
		organizationId,
		employeeId: actor.id,
	});
	if (!actorLabel) incomplete("actor");
	const evidence = await recordLegacyDecisionEvidence(database, {
		organizationId,
		submittedRevisionId: revision.id,
		operationKind: "command",
		receipt,
		action: "reject",
		legacy: { approvalRequestId, chainStageId: outcome.chainStageId, observedWorkflowId: null },
		assignmentOutcome: "rejected",
		requestOutcome: "rejected",
		actor: { kind: "employee", employeeId: actor.id, userId: actor.userId },
		decidedAt: outcome.decidedAt,
		// The non-approving operation returned the report; nothing was decided.
		result: {
			reportStatus: "returned",
			disposition: "returned",
			legacyRequestStatus: outcome.legacyRequestStatus,
			decidedAtSource: outcome.decidedAtSource,
			actorAuthority: outcome.actorAuthority,
			itemCommentCount: parsed.value.itemComments.length,
		},
		labels: { actorName: actorLabel.name },
	});
	const closureId = await recordTravelExpenseReportCycleClosure(database, {
		organizationId,
		reportId,
		submissionCycle: revision.submissionCycle,
		kind: "returned",
		submittedRevisionId: revision.id,
		approvalRequestId,
		decisionEvidenceId: evidence.id,
		actor: actorIdentity,
		returned: parsed.value,
		at: dateFromInstant(outcome.decidedAt),
	});
	// The returned cycle can no longer be decided: its sent cards (#623) are
	// retired like a withdrawn cycle's, keyed by the cycle's revision.
	// Ordered writes in the return transaction, after the cycle closure.
	// react-doctor-disable-next-line react-doctor/server-sequential-independent-await
	const deliveryIntent = await recordTravelExpenseReportDeliveryIntent(database, {
		organizationId,
		reportId,
		approvalRequestId,
		revision: revision.legacy,
		event: "withdrawn",
	});
	return {
		kind: "returned",
		evidence,
		approvalRequestId,
		closureId,
		submissionCycle: revision.submissionCycle,
		deliveryIntent,
	};
}

async function notifyRequester(
	database: ApprovalDatabase,
	input: TravelExpenseReportReturnInput,
	note: string,
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
	await onTravelExpenseReportReturned({
		reportId: input.reportId,
		requesterUserId: requester.userId,
		organizationId: input.organizationId,
		reviewerName: input.actor.user.name,
		note,
	});
}

/**
 * Authenticated return (inbox). Opens its own transaction; after commit the
 * employee is told the report needs changes. A replay repeats nothing.
 */
export async function returnTravelExpenseReport(
	dbService: ApprovalDbService,
	input: TravelExpenseReportReturnInput,
): Promise<TravelExpenseReportReturnOutcome> {
	try {
		const outcome = await dbService.db.transaction((transaction) =>
			executeTravelExpenseReportReturnInTransaction(transaction, dbService.query, input),
		);
		if (outcome.deliveryIntent) {
			// The intent committed; this only runs the delivery owner sooner.
			kickApprovalDelivery({ organizationId: input.organizationId });
		}
		if (outcome.kind === "returned") {
			await notifyRequester(dbService.db, input, input.note.trim()).catch((error) =>
				logger.error({ error, reportId: input.reportId }, "Report return notification failed"),
			);
		}
		return outcome;
	} catch (error) {
		throw translateTravelExpenseReportDecisionError(error);
	}
}
