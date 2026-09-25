import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { enqueueVacationOverrideCalendarSyncJobs } from "@/app/[locale]/(app)/absences/request-absence-effect-helpers";
import {
	absenceEntry,
	approvalRequest,
	approvalWorkflow,
	employee,
	holiday,
	timeRecord,
} from "@/db/schema";
import { calculateBusinessDays } from "@/lib/absences/date-utils";
import type { VacationOverrideSummary } from "@/lib/absences/sick-vacation-override";
import { adjustVacationAbsencesForSickness } from "@/lib/absences/sick-vacation-override";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { getAbility } from "@/lib/auth-helpers";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import {
	dateFromInstant,
	type Instant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	type AnyAppError,
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { EmailService } from "@/lib/effect/services/email.service";
import {
	renderAbsenceRequestApproved,
	renderAbsenceRequestRejected,
} from "@/lib/email/render";
import { createLogger } from "@/lib/logger";
import {
	onAbsenceRequestApproved,
	onAbsenceRequestRejected,
} from "@/lib/notifications/triggers";
import { addCalendarSyncJob } from "@/lib/queue";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import type { ApprovalActionOptions } from "../domain/types";
import { captureAbsenceLegacyApprovalState } from "../domain-adapters/absence-legacy-state";
import { createLegacyApprovalWriteCoordinator } from "../domain-adapters/legacy-write-coordinator";
import type { ApprovalWorkflowTransactionContext } from "../domain-adapters/types";
import {
	ApprovalAssignmentReassignedError,
	lineageContainsEscalation,
	selectCanonicalDecisionTarget,
} from "../escalation/decision-authority";
import { findLegacyTransferredRequest } from "../escalation/legacy-transfer-store";
import { ApprovalEvidenceError } from "../evidence/errors";
import {
	findLegacyAbsenceDecisionReplay,
	type LegacyObservedMirror,
	prepareLegacyAbsenceDecisionEvidence,
	recordLegacyAbsenceDecisionEvidence,
} from "../evidence/legacy-absence";
import {
	type ApprovalInvocationIdentity,
	approvalInvocationIdempotencyKey,
	findApprovalInvocation,
	fingerprintApprovalInvocationCommand,
	lockApprovalInvocation,
	recordApprovalInvocation,
} from "../evidence/invocation";
import {
	type DecisionEvidenceRecord,
	findDecisionEvidenceById,
	findDecisionEvidenceByReceipt,
	type LegacyDecisionEvidenceRecord,
	loadReviewBinding,
} from "../evidence/store";
import {
	ApprovalAuditLogger,
	createApprovalAuditLogger,
} from "../infrastructure/audit-logger";
import {
	type ResolvePolicyAndCreateApprovalResult,
	resolvePolicyAndCreateApproval,
} from "../policies/chain-service";
import { isEligibleManagerForApprovalRequest } from "../policies/manager-eligibility-db";
import { classifyLegacyStage } from "../policies/requester-auto-approval";
import type { ApprovalPolicyEvaluationContext } from "../policies/types";
import type { VerifiedLegacyApprovalState } from "../workflow/ports";
import type { ApprovalWorkflowRepository } from "../workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "../workflow/runtime";
import {
	type ApprovalTransitionEngine,
	ApprovalTransitionEngineError,
} from "../workflow/transition-engine";
import { processApprovalWithCurrentEmployee } from "./shared";
import {
	deleteCancelledTimeCorrectionsInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
} from "./time-correction-approvals";
import type {
	ApprovalDatabase,
	ApprovalDbService,
	CurrentApprover,
} from "./types";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "./work-period-approvals";

const logger = createLogger("AbsenceApprovals");

const EVIDENCE_REVIEW_MESSAGES = {
	evidence_required:
		"The facts submitted for this request were not captured. Review is required before a decision can be recorded.",
	evidence_incomplete:
		"The evidence for this decision is incomplete. Review is required before a decision can be recorded.",
	material_change:
		"This request changed after it was submitted. It must be cancelled and resubmitted before a decision can be recorded.",
	binding_mismatch:
		"This review no longer matches the current request. Reopen the request to review its current details.",
	invocation_mismatch:
		"This action conflicts with a previously recorded action. No decision was made.",
} as const;

export function translateAbsenceDecisionError(error: unknown): unknown {
	if (error instanceof ApprovalAssignmentReassignedError) {
		return new ConflictError({
			message:
				"This approval was reassigned to another approver. Open the approvals inbox to see its current state.",
			conflictType: "approval_reassigned",
			details: { code: error.code },
		});
	}
	if (error instanceof ApprovalEvidenceError) {
		// Integrity contradictions stay infrastructure-visible errors.
		if (error.code === "invariant") return error;
		return new ConflictError({
			message: EVIDENCE_REVIEW_MESSAGES[error.code],
			conflictType: "approval_evidence",
			details: { code: error.code },
		});
	}
	if (!(error instanceof ApprovalTransitionEngineError)) return error;

	switch (error.code) {
		case "forbidden":
			return new AuthorizationError({
				message: "You are not authorized to decide this request",
				resource: "Approval",
				action: "decide",
			});
		case "version_conflict":
		case "idempotency_mismatch":
			return new ConflictError({
				message: "Approval workflow decision conflicts with the current state",
				conflictType: "approval_transition",
				details: { code: error.code },
			});
		case "malformed_command":
			return new ValidationError({
				message: "Approval workflow decision is invalid",
			});
		case "result_scope":
		case "invariant":
		case "activation_cycle":
			return error;
	}
}

interface AbsenceDecisionRuntime {
	repository: ApprovalWorkflowRepository;
	transitionEngine: Pick<ApprovalTransitionEngine, "executeInTransaction">;
}

/** Transaction-bound legacy evidence; defaults to the approval evidence module. */
export interface LegacyAbsenceDecisionEvidencePort {
	findReplay: typeof findLegacyAbsenceDecisionReplay;
	prepare: typeof prepareLegacyAbsenceDecisionEvidence;
	record: typeof recordLegacyAbsenceDecisionEvidence;
}

const defaultLegacyDecisionEvidence: LegacyAbsenceDecisionEvidencePort = {
	findReplay: findLegacyAbsenceDecisionReplay,
	prepare: prepareLegacyAbsenceDecisionEvidence,
	record: recordLegacyAbsenceDecisionEvidence,
};

/** Transaction-bound read of legacy escalation transfers (#299). */
export interface LegacyAbsenceTransferAuthorityPort {
	findTransferredRequest: typeof findLegacyTransferredRequest;
}

const defaultLegacyTransferAuthority: LegacyAbsenceTransferAuthorityPort = {
	findTransferredRequest: findLegacyTransferredRequest,
};

/**
 * One authenticated provider invocation carrying a reviewed binding (#290).
 * Its exact committed association replays before any fresh check; a new
 * invocation is decided under an invocation-derived receipt key and never
 * falls back to an older semantic receipt.
 */
export interface AbsenceDecisionInvocation {
	identity: ApprovalInvocationIdentity;
	/** Transport delivery identity (e.g. Telegram update_id); not identity. */
	deliveryId: string | null;
	providerActorId: string;
}

/** The committed decision an invocation is associated with. */
export interface AbsenceInvocationOutcome {
	replayed: boolean;
	evidence: DecisionEvidenceRecord;
}

interface ExecuteAbsenceDecisionInput {
	runtime: AbsenceDecisionRuntime;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	absenceId: string;
	approvalRequestId?: string;
	action: "approve" | "reject";
	reason?: string;
	/** Opaque reviewed-view handle, validated inside the canonical decision. */
	reviewedBindingId?: string;
	invocation?: AbsenceDecisionInvocation;
	query?: ApprovalDbService["query"];
	processLegacy(
		dbService: ApprovalDbService,
		actor: CurrentApprover,
		transactionBehavior: "existing",
	): Promise<unknown>;
	captureLegacyState(input: {
		dbService: ApprovalWorkflowTransactionContext["dbService"];
		organizationId: string;
		absenceId: string;
		capturedAt: Instant;
	}): Promise<VerifiedLegacyApprovalState>;
	nowInstant(): Instant;
	legacyEvidence?: LegacyAbsenceDecisionEvidencePort;
	legacyTransferAuthority?: LegacyAbsenceTransferAuthorityPort;
	/**
	 * Explicit organization-level approval management, checked by the trusted
	 * caller. Absent means no management authority (fail closed).
	 */
	canManageOrganizationApproval?(): Promise<boolean>;
}

export function createAbsenceApprovalManagementAuthorization(input: {
	currentEmployee: CurrentApprover;
	canManageOrganizationApproval(): Promise<boolean>;
}): Parameters<
	typeof createProductionApprovalWorkflowRuntime
>[0]["canManageApproval"] {
	return async (authorizationInput) => {
		const { workflow, command } = authorizationInput;
		if (
			authorizationInput.organizationId !==
				input.currentEmployee.organizationId ||
			authorizationInput.actorEmployeeId !== input.currentEmployee.id ||
			workflow.organizationId !== authorizationInput.organizationId
		) {
			return false;
		}
		if (await input.canManageOrganizationApproval()) return true;
		if (command.type !== "approve" && command.type !== "reject") return false;
		const stages = workflow.stages.filter(
			(stage) =>
				stage.id === command.stageId &&
				stage.sequence === workflow.currentStageOrder &&
				stage.status === "pending" &&
				stage.assignments.some(
					(assignment) => assignment.id === command.assignmentId,
				),
		);
		const stage = stages[0];
		if (stages.length !== 1 || !stage?.legacyApprovalRequestId) return false;
		// Eligible-manager status never bypasses an escalation replacement:
		// only the current assignee or explicit management may decide (#255 §4).
		if (lineageContainsEscalation(stage, command.assignmentId)) return false;
		return await isEligibleManagerForApprovalRequest({
			db: authorizationInput.dbService.db as never,
			approvalRequestId: stage.legacyApprovalRequestId,
			managerEmployeeId: input.currentEmployee.id,
			organizationId: authorizationInput.organizationId,
		});
	};
}

function requireInvocationBinding(bindingId: string | undefined): string {
	// Only bound commands carry invocation identity.
	if (bindingId === undefined)
		throw new ApprovalEvidenceError("binding_mismatch");
	return bindingId;
}

function rejectionReasonFingerprint(reason: string | undefined): string {
	return createHash("sha256")
		.update(reason ?? "")
		.digest("hex");
}

export async function executeAbsenceDecisionInTransaction(
	input: ExecuteAbsenceDecisionInput,
) {
	return await input.runtime.repository.withTransaction(async (context) => {
		const transactionDb = context.dbService
			.db as unknown as ApprovalDbService["db"];
		const dbService: ApprovalDbService = {
			db: transactionDb,
			query:
				input.query ??
				(<T>(_name: string, operation: () => Promise<T>) =>
					Effect.promise(operation)),
		};
		const transactionActors = await transactionDb.query.employee.findMany({
			where: and(
				eq(employee.organizationId, input.organizationId),
				eq(employee.userId, input.actorUserId),
				eq(employee.isActive, true),
			),
			with: { user: true },
			limit: 2,
		});
		const transactionActor = transactionActors[0];
		if (
			transactionActors.length !== 1 ||
			!transactionActor ||
			transactionActor.id !== input.actorEmployeeId ||
			transactionActor.organizationId !== input.organizationId ||
			transactionActor.userId !== input.actorUserId ||
			transactionActor.isActive !== true ||
			transactionActor.user?.id !== input.actorUserId
		) {
			throw new Error("Scoped active absence approval actor was not found");
		}
		const currentEmployee = transactionActor as CurrentApprover;
		const absence = await transactionDb.query.absenceEntry.findFirst({
			where: and(
				eq(absenceEntry.id, input.absenceId),
				eq(absenceEntry.organizationId, input.organizationId),
			),
			columns: {
				id: true,
				organizationId: true,
				approvalWorkflowId: true,
			},
		});
		if (
			!absence ||
			absence.id !== input.absenceId ||
			absence.organizationId !== input.organizationId
		) {
			throw new Error("Scoped absence approval source was not found");
		}

		const gate = await context.writeGate.acquire({
			organizationId: input.organizationId,
			workflowType: "absence",
		});
		const fixedGate = {
			acquire: async (scope: {
				organizationId: string;
				workflowType: "absence";
			}) => {
				if (
					scope.organizationId !== input.organizationId ||
					scope.workflowType !== "absence"
				) {
					throw new Error("Absence decision gate scope mismatch");
				}
				return gate;
			},
		};
		const decisionContext = {
			...context,
			writeGate: fixedGate,
		} as ApprovalWorkflowTransactionContext;
		const sourceIdentity = {
			organizationId: input.organizationId,
			workflowType: "absence" as const,
			sourceType: "absence_entry",
			sourceId: input.absenceId,
		};
		const actor = {
			kind: "employee" as const,
			employeeId: currentEmployee.id,
			userId: currentEmployee.userId,
		};

		const invocation = input.invocation
			? {
					...input.invocation,
					key: approvalInvocationIdempotencyKey(input.invocation.identity),
					command: {
						actorEmployeeId: currentEmployee.id,
						actorUserId: currentEmployee.userId,
						providerActorId: input.invocation.providerActorId,
						reviewedBindingId: requireInvocationBinding(
							input.reviewedBindingId,
						),
						action: input.action,
						reason: input.reason ?? null,
					},
				}
			: null;
		if (invocation) {
			if (invocation.identity.organizationId !== input.organizationId) {
				throw new ApprovalEvidenceError("invariant", { field: "invocation" });
			}
			// Receipt before fresh checks: an exact committed invocation returns
			// its original evidence even if authority, revision or rollout moved.
			await lockApprovalInvocation(transactionDb, invocation.identity);
			const existing = await findApprovalInvocation(
				transactionDb,
				invocation.identity,
			);
			if (existing) {
				if (
					existing.commandFingerprint !==
					fingerprintApprovalInvocationCommand(invocation.command)
				) {
					throw new ApprovalEvidenceError("invocation_mismatch");
				}
				const evidence = await findDecisionEvidenceById(transactionDb, {
					organizationId: input.organizationId,
					workflowId: existing.workflowId,
					id: existing.decisionEvidenceId,
				});
				if (!evidence) {
					throw new ApprovalEvidenceError("invariant", {
						field: "invocation_decision",
					});
				}
				return {
					mode: gate.mode,
					actor: currentEmployee,
					domainResult: undefined,
					commandResult: undefined,
					replayed: null as LegacyDecisionEvidenceRecord | null,
					invocation: { replayed: true, evidence } as AbsenceInvocationOutcome,
				};
			}
		}

		if (
			gate.mode === "legacy" ||
			gate.mode === "shadow" ||
			gate.mode === "ready"
		) {
			if (input.reviewedBindingId !== undefined) {
				// Legacy authority has no reviewed-binding validation; never ignore one.
				throw new ApprovalEvidenceError("binding_mismatch");
			}
			let expectedVersion: number | null = null;
			if (gate.mode !== "legacy") {
				const observedWorkflow =
					await transactionDb.query.approvalWorkflow.findFirst({
						where: and(
							eq(approvalWorkflow.organizationId, input.organizationId),
							eq(approvalWorkflow.workflowType, "absence"),
							eq(approvalWorkflow.sourceType, "absence_entry"),
							eq(approvalWorkflow.sourceId, input.absenceId),
							eq(approvalWorkflow.status, "pending"),
						),
						columns: { id: true, version: true },
					});
				if (observedWorkflow) {
					if (
						typeof observedWorkflow.id !== "string" ||
						!Number.isInteger(observedWorkflow.version) ||
						observedWorkflow.version < 1
					) {
						throw new Error("Scoped canonical absence workflow is invalid");
					}
					expectedVersion = observedWorkflow.version;
				}
			}
			const legacyEvidence =
				input.legacyEvidence ?? defaultLegacyDecisionEvidence;
			const evidenceActor = {
				employeeId: currentEmployee.id,
				userId: currentEmployee.userId,
			};
			// Receipt before fresh checks: an exact committed operation replays
			// its original evidence and runs no mutation or after-commit effects.
			const replayed = await legacyEvidence.findReplay(transactionDb, {
				organizationId: input.organizationId,
				absenceId: input.absenceId,
				approvalRequestId: input.approvalRequestId,
				action: input.action,
				reason: input.reason,
				actor: evidenceActor,
			});
			if (replayed) {
				return {
					mode: gate.mode,
					actor: currentEmployee,
					domainResult: undefined,
					commandResult: undefined,
					replayed,
					invocation: null,
				};
			}
			// An escalation transfer revoked the former holders' authority: only
			// the current approver or explicit organization management may decide.
			// Eligible-manager fallback never bypasses the replacement (#255 §4).
			const transferred = await (
				input.legacyTransferAuthority ?? defaultLegacyTransferAuthority
			).findTransferredRequest(transactionDb, {
				organizationId: input.organizationId,
				absenceId: input.absenceId,
				approvalRequestId: input.approvalRequestId,
			});
			if (
				transferred &&
				transferred.currentApproverEmployeeId !== currentEmployee.id &&
				!(await input.canManageOrganizationApproval?.())
			) {
				throw new ApprovalAssignmentReassignedError();
			}
			const capturedAt = input.nowInstant();
			const captureState = () =>
				input.captureLegacyState({
					dbService: decisionContext.dbService,
					organizationId: input.organizationId,
					absenceId: input.absenceId,
					capturedAt,
				});
			const evidencePlan = await legacyEvidence.prepare(transactionDb, {
				organizationId: input.organizationId,
				absenceId: input.absenceId,
				captureState,
			});
			// Unchanged legacy key: it stays the shadow observation key and is
			// stored verbatim as the legacy receipt key.
			const idempotencyKey = `absence:${input.absenceId}:${input.action}:${expectedVersion ?? "initial"}:${rejectionReasonFingerprint(input.reason)}`;
			let observed: LegacyObservedMirror | null = null;
			const coordinator = createLegacyApprovalWriteCoordinator({
				writeGate: fixedGate,
				compatibilityWriter: decisionContext.compatibilityWriter,
			});
			const domainResult = await coordinator.execute({
				organizationId: input.organizationId,
				workflowType: "absence",
				sourceIdentity,
				actor,
				idempotencyKey,
				expectedVersion,
				captureState,
				mutate: () =>
					input.processLegacy(dbService, currentEmployee, "existing"),
				afterMirror: async (mirrored) => {
					observed = mirrored;
				},
			});
			if (evidencePlan) {
				await legacyEvidence.record(transactionDb, evidencePlan, {
					organizationId: input.organizationId,
					absenceId: input.absenceId,
					action: input.action,
					reason: input.reason,
					approvalRequestId: input.approvalRequestId,
					idempotencyKey,
					actor: evidenceActor,
					captureState,
					observed,
				});
			}
			return {
				mode: gate.mode,
				actor: currentEmployee,
				domainResult,
				commandResult: undefined,
				replayed: null,
				invocation: null,
			};
		}

		if (!input.approvalRequestId) {
			throw new Error("Canonical absence decision target is required");
		}
		if (!absence.approvalWorkflowId) {
			throw new Error("Absence approval workflow link is missing");
		}
		const workflow = await context.repository.loadSnapshot({
			organizationId: input.organizationId,
			workflowId: absence.approvalWorkflowId,
		});
		if (
			workflow.id !== absence.approvalWorkflowId ||
			workflow.organizationId !== input.organizationId ||
			workflow.workflowType !== "absence" ||
			workflow.sourceType !== "absence_entry" ||
			workflow.sourceId !== input.absenceId
		) {
			throw new Error("Absence approval workflow link is mismatched");
		}
		const { stage, assignment } = selectCanonicalDecisionTarget({
			workflow,
			approvalRequestId: input.approvalRequestId,
			actorEmployeeId: currentEmployee.id,
		});
		const command =
			input.action === "approve"
				? {
						type: "approve" as const,
						stageId: stage.id,
						assignmentId: assignment.id,
					}
				: {
						type: "reject" as const,
						stageId: stage.id,
						assignmentId: assignment.id,
						reason: input.reason ?? "",
					};
		// A bound invocation gets its own receipt: it can replay only itself and
		// never matches the semantic key an earlier decision used.
		const idempotencyKey =
			invocation?.key ??
			`absence:${input.organizationId}:${workflow.id}:${input.approvalRequestId}:${input.action}:${rejectionReasonFingerprint(input.reason)}`;
		const commandResult =
			await input.runtime.transitionEngine.executeInTransaction(
				decisionContext,
				{
					organizationId: input.organizationId,
					workflowId: workflow.id,
					expectedVersion: workflow.version,
					idempotencyKey,
					principal: { kind: "employee", userId: currentEmployee.userId },
					command,
					...(input.reviewedBindingId === undefined
						? {}
						: { reviewedBindingId: input.reviewedBindingId }),
				},
			);
		let invocationOutcome: AbsenceInvocationOutcome | null = null;
		if (invocation) {
			// Same transaction as the transition, evidence and receipt.
			const evidence = await findDecisionEvidenceByReceipt(transactionDb, {
				organizationId: input.organizationId,
				workflowId: workflow.id,
				idempotencyKey,
			});
			if (!evidence || evidence.reviewedBindingId !== input.reviewedBindingId) {
				throw new ApprovalEvidenceError("invariant", {
					field: "invocation_decision",
				});
			}
			await recordApprovalInvocation(transactionDb, {
				identity: invocation.identity,
				deliveryId: invocation.deliveryId,
				command: invocation.command,
				workflowId: workflow.id,
				receiptIdempotencyKey: idempotencyKey,
				decisionEvidenceId: evidence.id,
			});
			invocationOutcome = { replayed: false, evidence };
		}
		return {
			mode: gate.mode,
			actor: currentEmployee,
			domainResult: undefined,
			commandResult,
			replayed: null as LegacyDecisionEvidenceRecord | null,
			invocation: invocationOutcome,
		};
	});
}

interface AbsenceRecord {
	id: string;
	employeeId: string;
	organizationId: string;
	canonicalRecordId: string | null;
	approvalWorkflowId: string | null;
	startDate: string;
	startPeriod: "full_day" | "am" | "pm";
	endDate: string;
	endPeriod: "full_day" | "am" | "pm";
	status: string;
	rejectionReason: string | null;
	category: {
		name: string;
		type: string;
		color: string | null;
	};
	employee: {
		userId: string;
		organizationId: string;
		user: {
			name: string;
			email: string;
			image: string | null;
		};
	};
}

export type ApprovedAbsenceResult = {
	absence: AbsenceRecord;
	vacationOverrideSummary: VacationOverrideSummary;
	workBalanceDirtyMark?: WorkBalanceDirtyMark;
};

export type RejectedAbsenceResult = {
	absence: AbsenceRecord;
	workBalanceDirtyMark?: WorkBalanceDirtyMark;
};

type AutoCompletedApprovalResult = Extract<
	ResolvePolicyAndCreateApprovalResult,
	{ kind: "auto_completed" }
>;

export type AbsenceApprovalWorkflowResult =
	| Exclude<ResolvePolicyAndCreateApprovalResult, AutoCompletedApprovalResult>
	| (AutoCompletedApprovalResult & { autoCompletion: ApprovedAbsenceResult });

type WorkBalanceDirtyMark = {
	employeeId: string;
	organizationId: string;
	dirtyFromDate: string;
};

type AbsenceStatusUpdateResult = {
	absence: AbsenceRecord;
	workBalanceDirtyMark?: WorkBalanceDirtyMark;
};

type ExpectedAbsenceLinks = {
	approvalWorkflowId: string;
	canonicalRecordId: string;
};

const emptyVacationOverrideSummary = (): VacationOverrideSummary => ({
	updatedAbsenceIds: [],
	createdAbsenceIds: [],
	deletedAbsenceIds: [],
});

async function applySickVacationOverrideOnApproval(
	dbService: ApprovalDbService,
	absence: AbsenceRecord,
	currentEmployee: CurrentApprover,
): Promise<VacationOverrideSummary> {
	if (
		absence.category.type !== "sick" ||
		absence.startPeriod !== "full_day" ||
		absence.endPeriod !== "full_day"
	) {
		return emptyVacationOverrideSummary();
	}

	return await adjustVacationAbsencesForSickness({
		tx: dbService.db,
		organizationId: absence.organizationId,
		employeeId: absence.employeeId,
		sickStartDate: absence.startDate,
		sickEndDate: absence.endDate,
		updatedBy: currentEmployee.user.id,
	});
}

function queueApprovedAbsenceCalendarSync(result: ApprovedAbsenceResult) {
	void addCalendarSyncJob({
		absenceId: result.absence.id,
		employeeId: result.absence.employeeId,
		organizationId: result.absence.organizationId,
		action: "create",
	});

	enqueueVacationOverrideCalendarSyncJobs({
		employeeId: result.absence.employeeId,
		organizationId: result.absence.organizationId,
		summary: result.vacationOverrideSummary,
	});
}

function markWorkBalanceDirtyAfterCommit(mark?: WorkBalanceDirtyMark) {
	return mark
		? Effect.promise(() => markEmployeeWorkBalanceDirtyIfNeeded(mark))
		: Effect.void;
}

function ensureAbsenceRecord(
	absence: AbsenceRecord | null,
): Effect.Effect<AbsenceRecord, NotFoundError> {
	return absence
		? Effect.succeed(absence)
		: Effect.fail(
				new NotFoundError({
					message: "Absence not found",
					entityType: "absence_entry",
				}),
			);
}

function updateAbsenceStatus(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	status: "approved" | "rejected",
	reason?: string,
	finalizedAt: Instant = systemClock.nowInstant(),
	expectedLinks?: ExpectedAbsenceLinks,
) {
	return dbService
		.query("updateAbsenceStatus", async () => {
			const updatedRows = await dbService.db
				.update(absenceEntry)
				.set({
					status,
					...(status === "approved"
						? {
								approvedAt: dateFromInstant(finalizedAt),
								approvedBy: currentEmployee.id,
							}
						: { rejectionReason: reason }),
				})
				.where(
					and(
						eq(absenceEntry.id, entityId),
						eq(absenceEntry.organizationId, currentEmployee.organizationId),
						eq(absenceEntry.status, "pending"),
						...(expectedLinks
							? [
									eq(
										absenceEntry.approvalWorkflowId,
										expectedLinks.approvalWorkflowId,
									),
									eq(
										absenceEntry.canonicalRecordId,
										expectedLinks.canonicalRecordId,
									),
								]
							: []),
					),
				)
				.returning({ id: absenceEntry.id });

			if (updatedRows.length !== 1 || updatedRows[0]?.id !== entityId) {
				throw new Error("Scoped pending absence was not found");
			}

			const updatedAbsence = await dbService.db.query.absenceEntry.findFirst({
				where: and(
					eq(absenceEntry.id, entityId),
					eq(absenceEntry.organizationId, currentEmployee.organizationId),
				),
				with: {
					category: true,
					employee: { with: { user: true } },
				},
			});
			if (
				expectedLinks &&
				(updatedAbsence?.approvalWorkflowId !==
					expectedLinks.approvalWorkflowId ||
					updatedAbsence.canonicalRecordId !== expectedLinks.canonicalRecordId)
			) {
				throw new Error(
					"Scoped pending absence links changed during finalization",
				);
			}

			const workBalanceDirtyMark =
				updatedAbsence?.organizationId && status === "approved"
					? {
							employeeId: updatedAbsence.employeeId,
							organizationId: updatedAbsence.organizationId,
							dirtyFromDate: updatedAbsence.startDate,
						}
					: undefined;

			return { absence: updatedAbsence, workBalanceDirtyMark };
		})
		.pipe(
			Effect.flatMap((result) =>
				ensureAbsenceRecord(
					result.absence as unknown as AbsenceRecord | null,
				).pipe(
					Effect.map(
						(absence): AbsenceStatusUpdateResult => ({
							absence,
							workBalanceDirtyMark: result.workBalanceDirtyMark,
						}),
					),
				),
			),
		);
}

function loadHolidays(dbService: ApprovalDbService, organizationId: string) {
	return dbService.query("getHolidays", async () => {
		return await dbService.db.query.holiday.findMany({
			where: eq(holiday.organizationId, organizationId),
		});
	});
}

async function syncCanonicalAbsenceApprovalStateAt(
	dbService: ApprovalDbService,
	input: {
		organizationId: string;
		canonicalRecordId: string | null;
		approvalState: "approved" | "rejected";
		updatedBy: string;
		finalizedAt: Instant;
	},
) {
	if (!input.canonicalRecordId) return;
	const updatedRows = await dbService.db
		.update(timeRecord)
		.set({
			approvalState: input.approvalState,
			updatedAt: dateFromInstant(input.finalizedAt),
			updatedBy: input.updatedBy,
		})
		.where(
			and(
				eq(timeRecord.id, input.canonicalRecordId),
				eq(timeRecord.organizationId, input.organizationId),
				eq(timeRecord.recordKind, "absence"),
			),
		)
		.returning({ id: timeRecord.id });
	if (
		updatedRows.length !== 1 ||
		updatedRows[0]?.id !== input.canonicalRecordId
	) {
		throw new Error(
			"Canonical absence parity update affected an unexpected row count",
		);
	}
}

export function formatAbsenceDateForEmail(date: Date | string) {
	const value =
		typeof date === "string"
			? DateTime.fromISO(date)
			: DateTime.fromJSDate(date);
	return value.toFormat("LLL d, yyyy");
}

export function buildAbsenceApprovalPolicyContext(absence: {
	id: string;
	organizationId: string;
	employeeId: string;
	categoryId: string | null;
	employee: { teamId: string | null };
}): ApprovalPolicyEvaluationContext {
	return {
		organizationId: absence.organizationId,
		approvalType: "absence_entry",
		requesterEmployeeId: absence.employeeId,
		teamId: absence.employee.teamId,
		locationId: null,
		absenceCategoryId: absence.categoryId,
		travelExpenseAmount: null,
		overtimeRisk: null,
		employeeGroupIds: [],
		entityType: "absence_entry",
		entityId: absence.id,
	};
}

export function createAbsenceApprovalWorkflow(
	dbService: ApprovalDbService,
	input: {
		absence: Parameters<typeof buildAbsenceApprovalPolicyContext>[0];
		defaultApproverId: string | null;
		transactionBehavior?: "open" | "existing";
	},
): Effect.Effect<AbsenceApprovalWorkflowResult, AnyAppError, never> {
	const resolveApproval = resolvePolicyAndCreateApproval(dbService, {
		context: buildAbsenceApprovalPolicyContext(input.absence),
		defaultApproverId: input.defaultApproverId,
		transactionBehavior: input.transactionBehavior,
	}).pipe(
		Effect.catchTag("ValidationError", (error) => {
			const defaultApproverId = input.defaultApproverId;
			if (defaultApproverId === null) {
				return Effect.fail(
					new ValidationError({
						message: "No manager assigned to approve absence requests",
						field: error.field ?? "managerId",
					}),
				);
			}
			const disposition = classifyLegacyStage({
				requesterEmployeeId: input.absence.employeeId,
				approverEmployeeId: defaultApproverId,
			});
			return dbService.query(
				"createDefaultAbsenceApprovalFallback",
				async () => {
					const [approval] = await dbService.db
						.insert(approvalRequest)
						.values({
							organizationId: input.absence.organizationId,
							entityType: "absence_entry",
							entityId: input.absence.id,
							requestedBy: input.absence.employeeId,
							approverId: defaultApproverId,
							status:
								disposition.kind === "auto_approve" ? "approved" : "pending",
							approvedAt:
								disposition.kind === "auto_approve"
									? currentTimestamp()
									: undefined,
							metadata:
								disposition.kind === "auto_approve"
									? { autoApproval: { reason: disposition.reason } }
									: undefined,
						})
						.returning({ id: approvalRequest.id });

					const approvalRequestId = approval?.id ?? input.absence.id;
					return disposition.kind === "auto_approve"
						? ({
								kind: "auto_completed",
								chainInstanceId: null,
								approvalRequestId,
								reason: disposition.reason,
							} as const)
						: ({ kind: "default_created", approvalRequestId } as const);
				},
			);
		}),
	);

	return resolveApproval.pipe(
		Effect.flatMap(
			(
				result,
			): Effect.Effect<AbsenceApprovalWorkflowResult, AnyAppError, never> =>
				result.kind === "auto_completed"
					? loadAutoApprovalRequester(
							dbService,
							input.absence.employeeId,
							input.absence.organizationId,
						).pipe(
							Effect.flatMap((requester) =>
								persistApprovedAbsence(dbService, input.absence.id, requester),
							),
							Effect.map((autoCompletion) => ({ ...result, autoCompletion })),
						)
					: Effect.succeed(result),
		),
	);
}

export async function runAutoCompletedAbsenceMaintenance(
	result: ApprovedAbsenceResult,
) {
	await markEmployeeWorkBalanceDirtyIfNeeded(result.workBalanceDirtyMark);
	queueApprovedAbsenceCalendarSync(result);
}

function loadAutoApprovalRequester(
	dbService: ApprovalDbService,
	requesterEmployeeId: string,
	organizationId: string,
) {
	return dbService
		.query("getAutoApprovalRequester", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, requesterEmployeeId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
				),
				with: { user: true },
			});
		})
		.pipe(
			Effect.flatMap((requester) =>
				requester
					? Effect.succeed(requester as CurrentApprover)
					: Effect.fail(
							new NotFoundError({
								message: "Auto-approval requester not found",
								entityType: "employee",
								entityId: requesterEmployeeId,
							}),
						),
			),
		);
}

export function approveAbsenceWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	absenceId: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"absence_entry",
		absenceId,
		"approve",
		undefined,
		handleApprovedAbsence,
		undefined,
		{ ...options, transactional: true },
		{
			updateEntity: persistApprovedAbsence,
			afterCommit: (result, committedDbService, entityId, approver) =>
				completeApprovedAbsenceAfterCommit(
					committedDbService,
					entityId,
					approver,
					result,
				),
		},
	);
}

export function rejectAbsenceWithCurrentApproverEffect(
	dbService: ApprovalDbService,
	currentEmployee: CurrentApprover,
	absenceId: string,
	reason: string,
	options?: ApprovalActionOptions,
) {
	return processApprovalWithCurrentEmployee(
		dbService,
		currentEmployee,
		"absence_entry",
		absenceId,
		"reject",
		reason,
		(decisionDbService, entityId, approver) =>
			handleRejectedAbsence(decisionDbService, entityId, approver, reason),
		undefined,
		{ ...options, transactional: true },
		{
			updateEntity: (decisionDbService, entityId, approver) =>
				persistRejectedAbsence(decisionDbService, entityId, approver, reason),
			afterCommit: (result, committedDbService, entityId, approver) =>
				completeRejectedAbsenceAfterCommit(
					committedDbService,
					entityId,
					approver,
					reason,
					result,
				),
		},
	);
}

function buildAbsenceEmailContext(
	absence: AbsenceRecord,
	currentEmployee: CurrentApprover,
	days: number,
) {
	return Effect.gen(function* (_) {
		const appUrl = yield* _(
			Effect.promise(() =>
				getOrganizationBaseUrl(absence.employee.organizationId),
			),
		);

		return {
			employeeName: absence.employee.user.name,
			approverName: currentEmployee.user.name,
			startDate: formatAbsenceDateForEmail(absence.startDate),
			endDate: formatAbsenceDateForEmail(absence.endDate),
			absenceType: absence.category.name,
			days,
			appUrl,
		};
	});
}

function notifyApprovedAbsence(
	absence: AbsenceRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
) {
	void onAbsenceRequestApproved({
		absenceId: entityId,
		employeeUserId: absence.employee.userId,
		employeeName: absence.employee.user.name,
		organizationId: absence.employee.organizationId,
		categoryName: absence.category.name,
		startDate: absence.startDate,
		endDate: absence.endDate,
		approverName: currentEmployee.user.name,
	});
}

function notifyRejectedAbsence(
	absence: AbsenceRecord,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
) {
	void onAbsenceRequestRejected({
		absenceId: entityId,
		employeeUserId: absence.employee.userId,
		employeeName: absence.employee.user.name,
		organizationId: absence.employee.organizationId,
		categoryName: absence.category.name,
		startDate: absence.startDate,
		endDate: absence.endDate,
		approverName: currentEmployee.user.name,
		rejectionReason: reason,
	});
}

function persistApprovedAbsence(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
) {
	return persistApprovedAbsenceAt(
		dbService,
		entityId,
		currentEmployee,
		systemClock.nowInstant(),
	);
}

function persistApprovedAbsenceAt(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	finalizedAt: Instant,
	expectedLinks?: ExpectedAbsenceLinks,
) {
	return Effect.gen(function* (_) {
		const { absence, workBalanceDirtyMark } = yield* _(
			updateAbsenceStatus(
				dbService,
				entityId,
				currentEmployee,
				"approved",
				undefined,
				finalizedAt,
				expectedLinks,
			),
		);
		const vacationOverrideSummary = yield* _(
			Effect.promise(() =>
				applySickVacationOverrideOnApproval(
					dbService,
					absence,
					currentEmployee,
				),
			),
		);
		yield* _(
			Effect.promise(() =>
				syncCanonicalAbsenceApprovalStateAt(dbService, {
					organizationId: absence.organizationId,
					canonicalRecordId:
						expectedLinks?.canonicalRecordId ?? absence.canonicalRecordId,
					approvalState: "approved",
					updatedBy: currentEmployee.user.id,
					finalizedAt,
				}),
			),
		);

		return { absence, vacationOverrideSummary, workBalanceDirtyMark };
	});
}

function handleApprovedAbsence(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
) {
	return persistApprovedAbsence(dbService, entityId, currentEmployee).pipe(
		Effect.tap((result) =>
			completeApprovedAbsenceAfterCommit(
				dbService,
				entityId,
				currentEmployee,
				result,
			),
		),
	);
}

function completeApprovedAbsenceAfterCommit(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	result: ApprovedAbsenceResult,
) {
	return Effect.all(
		[
			markWorkBalanceDirtyAfterCommit(result.workBalanceDirtyMark),
			Effect.sync(() => queueApprovedAbsenceCalendarSync(result)),
			notifyApprovedAbsenceAfterCommit(
				dbService,
				entityId,
				currentEmployee,
				result,
			),
		],
		{ concurrency: 3 },
	).pipe(Effect.map(() => undefined));
}

function notifyApprovedAbsenceAfterCommit(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	result: ApprovedAbsenceResult,
) {
	return Effect.gen(function* (_) {
		const emailService = yield* _(EmailService);
		const { absence } = result;
		const holidays = yield* _(
			loadHolidays(dbService, absence.employee.organizationId),
		);
		const days = calculateBusinessDays(
			new Date(absence.startDate),
			new Date(absence.endDate),
			holidays,
		);
		const emailContext = yield* _(
			buildAbsenceEmailContext(absence, currentEmployee, days),
		);
		const html = yield* _(
			Effect.promise(() => renderAbsenceRequestApproved(emailContext)),
		);

		yield* _(
			emailService
				.send({
					to: absence.employee.user.email,
					subject: `Absence Request Approved: ${absence.category.name}`,
					html,
				})
				.pipe(
					Effect.catchTag("EmailError", (error) =>
						Effect.sync(() =>
							logger.error(
								{ error, absenceId: entityId },
								"Failed to send absence approval email",
							),
						),
					),
				),
		);

		notifyApprovedAbsence(absence, entityId, currentEmployee);
	});
}

function persistRejectedAbsence(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	finalizedAt?: Instant,
	expectedLinks?: ExpectedAbsenceLinks,
) {
	return Effect.gen(function* (_) {
		const decisionAt = finalizedAt ?? systemClock.nowInstant();
		const { absence, workBalanceDirtyMark } = yield* _(
			updateAbsenceStatus(
				dbService,
				entityId,
				currentEmployee,
				"rejected",
				reason,
				decisionAt,
				expectedLinks,
			),
		);
		yield* _(
			Effect.promise(() =>
				syncCanonicalAbsenceApprovalStateAt(dbService, {
					organizationId: absence.organizationId,
					canonicalRecordId:
						expectedLinks?.canonicalRecordId ?? absence.canonicalRecordId,
					approvalState: "rejected",
					updatedBy: currentEmployee.user.id,
					finalizedAt: decisionAt,
				}),
			),
		);

		return { absence, workBalanceDirtyMark };
	});
}

export async function finalizeAbsenceTerminalInTransaction(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	absenceId: string;
	expectedApprovalWorkflowId: string;
	expectedCanonicalRecordId: string;
	actorEmployeeId: string;
	actorUserId: string;
	transition: { kind: "approve" } | { kind: "reject"; reason: string };
	finalizedAt: Instant;
}): Promise<ApprovedAbsenceResult | RejectedAbsenceResult> {
	if (!input.expectedApprovalWorkflowId || !input.expectedCanonicalRecordId) {
		throw new Error(
			"Expected absence links are required for terminal finalization",
		);
	}
	const actor = {
		id: input.actorEmployeeId,
		userId: input.actorUserId,
		organizationId: input.organizationId,
		user: {
			id: input.actorUserId,
			name: "",
			email: "",
			image: null,
		},
	} satisfies CurrentApprover;
	const expectedLinks = {
		approvalWorkflowId: input.expectedApprovalWorkflowId,
		canonicalRecordId: input.expectedCanonicalRecordId,
	};

	return await Effect.runPromise(
		input.transition.kind === "approve"
			? persistApprovedAbsenceAt(
					input.dbService,
					input.absenceId,
					actor,
					input.finalizedAt,
					expectedLinks,
				)
			: persistRejectedAbsence(
					input.dbService,
					input.absenceId,
					actor,
					input.transition.reason,
					input.finalizedAt,
					expectedLinks,
				),
	);
}

function notifyRejectedAbsenceAfterCommit(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	result: AbsenceStatusUpdateResult,
) {
	return Effect.gen(function* (_) {
		const emailService = yield* _(EmailService);
		const { absence } = result;
		const holidays = yield* _(
			loadHolidays(dbService, absence.employee.organizationId),
		);
		const days = calculateBusinessDays(
			new Date(absence.startDate),
			new Date(absence.endDate),
			holidays,
		);
		const emailContext = yield* _(
			buildAbsenceEmailContext(absence, currentEmployee, days),
		);
		const html = yield* _(
			Effect.promise(() =>
				renderAbsenceRequestRejected({
					...emailContext,
					rejectionReason: reason,
				}),
			),
		);

		yield* _(
			emailService
				.send({
					to: absence.employee.user.email,
					subject: `Absence Request Rejected: ${absence.category.name}`,
					html,
				})
				.pipe(
					Effect.catchTag("EmailError", (error) =>
						Effect.sync(() =>
							logger.error(
								{ error, absenceId: entityId },
								"Failed to send absence rejection email",
							),
						),
					),
				),
		);

		notifyRejectedAbsence(absence, entityId, currentEmployee, reason);
	});
}

function completeRejectedAbsenceAfterCommit(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
	result: AbsenceStatusUpdateResult,
) {
	return Effect.all(
		[
			markWorkBalanceDirtyAfterCommit(result.workBalanceDirtyMark),
			notifyRejectedAbsenceAfterCommit(
				dbService,
				entityId,
				currentEmployee,
				reason,
				result,
			),
		],
		{ concurrency: 2 },
	).pipe(Effect.map(() => undefined));
}

function handleRejectedAbsence(
	dbService: ApprovalDbService,
	entityId: string,
	currentEmployee: CurrentApprover,
	reason: string,
) {
	return persistRejectedAbsence(
		dbService,
		entityId,
		currentEmployee,
		reason,
	).pipe(
		Effect.tap((result) =>
			completeRejectedAbsenceAfterCommit(
				dbService,
				entityId,
				currentEmployee,
				reason,
				result,
			),
		),
	);
}

export async function approveAbsenceEffect(
	absenceId: string,
	options?: ApprovalActionOptions,
): Promise<ServerActionResult<void>> {
	return processAuthenticatedAbsenceDecision(
		absenceId,
		"approve",
		undefined,
		options,
	);
}

export async function rejectAbsenceEffect(
	absenceId: string,
	reason: string,
	options?: ApprovalActionOptions,
): Promise<ServerActionResult<void>> {
	return processAuthenticatedAbsenceDecision(
		absenceId,
		"reject",
		reason,
		options,
	);
}

/** The legacy-authoritative absence decision, run inside the caller's transaction. */
export function createLegacyAbsenceDecisionProcessor(input: {
	absenceId: string;
	action: "approve" | "reject";
	reason?: string;
	options?: ApprovalActionOptions;
}): ExecuteAbsenceDecisionInput["processLegacy"] {
	return async (
		transactionDbService,
		transactionEmployee,
		transactionBehavior,
	) =>
		await Effect.runPromise(
			processApprovalWithCurrentEmployee(
				transactionDbService,
				transactionEmployee,
				"absence_entry",
				input.absenceId,
				input.action,
				input.reason,
				input.action === "approve"
					? persistApprovedAbsence
					: (service, entityId, approver) =>
							persistRejectedAbsence(
								service,
								entityId,
								approver,
								input.reason ?? "",
							),
				undefined,
				{ ...input.options, transactional: true },
				undefined,
				transactionBehavior,
			).pipe(
				Effect.provideService(
					ApprovalAuditLogger,
					createApprovalAuditLogger(transactionDbService),
				),
			) as Effect.Effect<unknown, AnyAppError, never>,
		);
}

function authenticatedAbsenceDecisionEffect(
	absenceId: string,
	action: "approve" | "reject",
	reason?: string,
	options?: ApprovalActionOptions,
) {
	return Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Active organization not found",
						entityType: "organization",
					}),
				),
			);
		}
		const currentEmployee = yield* _(
			dbService
				.query("getAbsenceApprovalActor", async () => {
					return await dbService.db.query.employee.findFirst({
						where: and(
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, organizationId),
							eq(employee.isActive, true),
						),
						with: { user: true },
					});
				})
				.pipe(
					Effect.flatMap((actor) =>
						actor &&
						actor.organizationId === organizationId &&
						actor.userId === session.user.id
							? Effect.succeed(actor as CurrentApprover)
							: Effect.fail(
									new NotFoundError({
										message: "Employee profile not found",
										entityType: "employee",
									}),
								),
					),
				),
		);
		// Explicit organization approval management, from the caller's current
		// abilities; never inferred from eligible-manager status.
		const canManageOrganizationApproval = async () => {
			const ability = await getAbility();
			return ability?.cannot("manage", "Approval") === false;
		};
		const runtime = createAbsenceDecisionRuntime({
			db: dbService.db,
			query: dbService.query,
			canManageApproval: createAbsenceApprovalManagementAuthorization({
				currentEmployee,
				canManageOrganizationApproval,
			}),
		});
		const execution = yield* _(
			Effect.tryPromise({
				try: () =>
					executeAbsenceDecisionInTransaction({
						runtime,
						organizationId,
						actorEmployeeId: currentEmployee.id,
						actorUserId: session.user.id,
						absenceId,
						approvalRequestId: options?.approvalRequestId,
						action,
						reason,
						...(options?.reviewedBindingId === undefined
							? {}
							: { reviewedBindingId: options.reviewedBindingId }),
						query: dbService.query,
						captureLegacyState: captureAbsenceLegacyApprovalState,
						canManageOrganizationApproval,
						nowInstant: () => systemClock.nowInstant(),
						processLegacy: createLegacyAbsenceDecisionProcessor({
							absenceId,
							action,
							reason,
							options,
						}),
					}),
				catch: translateAbsenceDecisionError,
			}),
		);

		if (
			(execution.mode === "legacy" ||
				execution.mode === "shadow" ||
				execution.mode === "ready") &&
			execution.domainResult
		) {
			const postCommit =
				action === "approve"
					? completeApprovedAbsenceAfterCommit(
							dbService as ApprovalDbService,
							absenceId,
							execution.actor,
							execution.domainResult as ApprovedAbsenceResult,
						)
					: completeRejectedAbsenceAfterCommit(
							dbService as ApprovalDbService,
							absenceId,
							execution.actor,
							reason ?? "",
							execution.domainResult as RejectedAbsenceResult,
						);
			yield* _(
				postCommit.pipe(
					Effect.catchAllCause((cause) =>
						Effect.sync(() =>
							logger.error(
								{ cause, absenceId, organizationId, action },
								"Absence approval after-commit work failed",
							),
						),
					),
				),
			);
		}
	});
}

/** The production decision runtime shared by the web and bot decision paths. */
export function createAbsenceDecisionRuntime(input: {
	db: Parameters<typeof createProductionApprovalWorkflowRuntime>[0]["db"];
	query: ApprovalDbService["query"];
	canManageApproval: Parameters<
		typeof createProductionApprovalWorkflowRuntime
	>[0]["canManageApproval"];
}) {
	return createProductionApprovalWorkflowRuntime({
		db: input.db,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async (finalizerInput) =>
					await finalizeAbsenceTerminalInTransaction({
						...finalizerInput,
						dbService: {
							db: finalizerInput.dbService.db as ApprovalDbService["db"],
							query: input.query,
						},
					}),
				deleteCancelledAbsence: async () => {
					throw new Error(
						"Absence cancellation is not wired into the decision runtime",
					);
				},
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal:
					finalizeTimeCorrectionTerminalInTransaction,
				deleteCancelledCorrections: deleteCancelledTimeCorrectionsInTransaction,
			},
			ordinaryWorkPeriod: {
				finalizeTerminal:
					finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
			},
		},
		canManageApproval: input.canManageApproval,
		clock: systemClock,
	});
}

/**
 * A card action whose actor no longer holds the bound assignment. Raised under
 * the decision transaction, where the engine consults management authority
 * only after the active-assignment check failed.
 */
export class BoundAssignmentNotCurrentError extends Error {
	constructor() {
		super("The bound assignment is no longer held by this actor");
		this.name = "BoundAssignmentNotCurrentError";
	}
}

export type BoundAbsenceInvocationResult =
	| {
			status: "decided";
			/** True when this invocation had already committed (exact replay). */
			replayed: boolean;
			evidence: DecisionEvidenceRecord;
	  }
	| {
			status: "review_required";
			reason:
				| "binding"
				| "reassigned"
				| "stale"
				| "material_change"
				| "evidence";
	  }
	| { status: "conflict" }
	| { status: "not_found" };

/**
 * A reviewed-binding decision from an authenticated bot invocation (#290).
 * The actor comes from verified provider linkage, never a session. Authority is
 * the exact bound assignment only: neither eligible-manager fallback nor
 * organization management is ever invoked from a card, so a stale card needs
 * authenticated review instead. Infrastructure errors propagate.
 */
export async function decideBoundAbsenceInvocation(input: {
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	bindingId: string;
	action: "approve" | "reject";
	reason?: string;
	invocation: AbsenceDecisionInvocation;
	database: Parameters<typeof createProductionApprovalWorkflowRuntime>[0]["db"];
}): Promise<BoundAbsenceInvocationResult> {
	const database = input.database;
	const binding = await loadReviewBinding(database as ApprovalDatabase, {
		organizationId: input.organizationId,
		bindingId: input.bindingId,
	});
	if (!binding || binding.recipientEmployeeId !== input.actorEmployeeId) {
		return { status: "not_found" };
	}
	const sources = await (database as ApprovalDatabase)
		.select({ id: absenceEntry.id })
		.from(absenceEntry)
		.where(
			and(
				eq(absenceEntry.organizationId, input.organizationId),
				eq(absenceEntry.approvalWorkflowId, binding.workflowId),
			),
		)
		.limit(2);
	const source = sources[0];
	if (sources.length !== 1 || !source) return { status: "not_found" };
	const query: ApprovalDbService["query"] = <T>(
		_name: string,
		operation: () => Promise<T>,
	) => Effect.promise(operation);
	const runtime = createAbsenceDecisionRuntime({
		db: database,
		query,
		// Only the current assignee (checked by the engine first) may decide;
		// a card never reaches management or eligible-manager authority.
		canManageApproval: async () => {
			throw new BoundAssignmentNotCurrentError();
		},
	});
	try {
		const execution = await executeAbsenceDecisionInTransaction({
			runtime,
			organizationId: input.organizationId,
			actorEmployeeId: input.actorEmployeeId,
			actorUserId: input.actorUserId,
			absenceId: source.id,
			// The exact bound assignment; never re-selected from the request.
			approvalRequestId: binding.assignmentId,
			action: input.action,
			...(input.reason === undefined ? {} : { reason: input.reason }),
			reviewedBindingId: binding.id,
			invocation: input.invocation,
			query,
			captureLegacyState: captureAbsenceLegacyApprovalState,
			canManageOrganizationApproval: async () => false,
			nowInstant: () => systemClock.nowInstant(),
			processLegacy: async () => {
				throw new ApprovalEvidenceError("binding_mismatch");
			},
		});
		if (!execution.invocation) {
			throw new ApprovalEvidenceError("invariant", {
				field: "invocation_decision",
			});
		}
		return {
			status: "decided",
			replayed: execution.invocation.replayed,
			evidence: execution.invocation.evidence,
		};
	} catch (error) {
		return classifyBoundAbsenceError(error);
	}
}

function classifyBoundAbsenceError(
	error: unknown,
): BoundAbsenceInvocationResult {
	if (error instanceof ApprovalAssignmentReassignedError) {
		return { status: "review_required", reason: "reassigned" };
	}
	if (error instanceof BoundAssignmentNotCurrentError) {
		return { status: "review_required", reason: "stale" };
	}
	if (error instanceof ApprovalEvidenceError) {
		switch (error.code) {
			case "invocation_mismatch":
				return { status: "conflict" };
			case "binding_mismatch":
				return { status: "review_required", reason: "binding" };
			case "material_change":
				return { status: "review_required", reason: "material_change" };
			case "evidence_required":
			case "evidence_incomplete":
				return { status: "review_required", reason: "evidence" };
			case "invariant":
				throw error;
		}
	}
	if (error instanceof ApprovalTransitionEngineError) {
		switch (error.code) {
			case "idempotency_mismatch":
				return { status: "conflict" };
			case "forbidden":
				// Includes a legacy-authoritative rollout and a decided or
				// replaced assignment: nothing is decided from the card.
				return { status: "review_required", reason: "stale" };
			case "version_conflict":
				return { status: "review_required", reason: "stale" };
			default:
				throw error;
		}
	}
	throw error;
}

export async function executeAuthenticatedAbsenceDecision(
	absenceId: string,
	action: "approve" | "reject",
	reason?: string,
	options?: ApprovalActionOptions,
): Promise<void> {
	return Effect.runPromise(
		authenticatedAbsenceDecisionEffect(absenceId, action, reason, options).pipe(
			Effect.provide(AppLayer),
		) as Effect.Effect<void, AnyAppError, never>,
	);
}

export async function processAuthenticatedAbsenceDecision(
	absenceId: string,
	action: "approve" | "reject",
	reason?: string,
	options?: ApprovalActionOptions,
): Promise<ServerActionResult<void>> {
	const effect = authenticatedAbsenceDecisionEffect(
		absenceId,
		action,
		reason,
		options,
	);

	return runServerActionSafe(
		effect.pipe(Effect.provide(AppLayer)) as Effect.Effect<
			void,
			AnyAppError,
			never
		>,
	);
}

async function markEmployeeWorkBalanceDirtyIfNeeded(
	mark?: WorkBalanceDirtyMark,
) {
	if (!mark) return;
	try {
		await markEmployeeWorkBalanceDirty(mark);
	} catch (error) {
		logger.error({ error, ...mark }, "Failed to mark work balance dirty");
	}
}
