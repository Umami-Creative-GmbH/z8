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
import type { ApprovalDbService, CurrentApprover } from "./types";
import { finalizeOrdinaryWorkPeriodTerminalInTransaction } from "./work-period-approvals";

const logger = createLogger("AbsenceApprovals");

export function translateAbsenceDecisionError(error: unknown): unknown {
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

interface ExecuteAbsenceDecisionInput {
	runtime: AbsenceDecisionRuntime;
	organizationId: string;
	actorEmployeeId: string;
	actorUserId: string;
	absenceId: string;
	approvalRequestId?: string;
	action: "approve" | "reject";
	reason?: string;
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
		return await isEligibleManagerForApprovalRequest({
			db: authorizationInput.dbService.db as never,
			approvalRequestId: stage.legacyApprovalRequestId,
			managerEmployeeId: input.currentEmployee.id,
			organizationId: authorizationInput.organizationId,
		});
	};
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

		if (
			gate.mode === "legacy" ||
			gate.mode === "shadow" ||
			gate.mode === "ready"
		) {
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
			const capturedAt = input.nowInstant();
			const coordinator = createLegacyApprovalWriteCoordinator({
				writeGate: fixedGate,
				compatibilityWriter: decisionContext.compatibilityWriter,
			});
			const domainResult = await coordinator.execute({
				organizationId: input.organizationId,
				workflowType: "absence",
				sourceIdentity,
				actor,
				idempotencyKey: `absence:${input.absenceId}:${input.action}:${expectedVersion ?? "initial"}:${rejectionReasonFingerprint(input.reason)}`,
				expectedVersion,
				captureState: () =>
					input.captureLegacyState({
						dbService: decisionContext.dbService,
						organizationId: input.organizationId,
						absenceId: input.absenceId,
						capturedAt,
					}),
				mutate: () =>
					input.processLegacy(dbService, currentEmployee, "existing"),
			});
			return {
				mode: gate.mode,
				actor: currentEmployee,
				domainResult,
				commandResult: undefined,
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
		const targets = workflow.stages.flatMap((stage) =>
			stage.assignments.flatMap((assignment) =>
				stage.legacyApprovalRequestId === input.approvalRequestId ||
				assignment.id === input.approvalRequestId
					? [{ stage, assignment }]
					: [],
			),
		);
		const target = targets[0];
		if (targets.length !== 1 || !target) {
			throw new Error("Canonical absence decision target is not unique");
		}
		const { stage, assignment } = target;
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
		const commandResult =
			await input.runtime.transitionEngine.executeInTransaction(
				decisionContext,
				{
					organizationId: input.organizationId,
					workflowId: workflow.id,
					expectedVersion: workflow.version,
					idempotencyKey: `absence:${input.organizationId}:${workflow.id}:${input.approvalRequestId}:${input.action}:${rejectionReasonFingerprint(input.reason)}`,
					principal: { kind: "employee", userId: currentEmployee.userId },
					command,
				},
			);
		return {
			mode: gate.mode,
			actor: currentEmployee,
			domainResult: undefined,
			commandResult,
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
		const runtime = createProductionApprovalWorkflowRuntime({
			db: dbService.db,
			adapters: {
				absence: {
					clock: systemClock,
					finalizeAbsenceTerminal: async (finalizerInput) =>
						await finalizeAbsenceTerminalInTransaction({
							...finalizerInput,
							dbService: {
								db: finalizerInput.dbService.db as ApprovalDbService["db"],
								query: dbService.query,
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
					deleteCancelledCorrections:
						deleteCancelledTimeCorrectionsInTransaction,
				},
				ordinaryWorkPeriod: {
					finalizeTerminal: finalizeOrdinaryWorkPeriodTerminalInTransaction,
				},
			},
			canManageApproval: createAbsenceApprovalManagementAuthorization({
				currentEmployee,
				canManageOrganizationApproval: async () => {
					const ability = await getAbility();
					return ability?.cannot("manage", "Approval") === false;
				},
			}),
			clock: systemClock,
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
						query: dbService.query,
						captureLegacyState: captureAbsenceLegacyApprovalState,
						nowInstant: () => systemClock.nowInstant(),
						processLegacy: async (
							transactionDbService,
							transactionEmployee,
							transactionBehavior,
						) =>
							await Effect.runPromise(
								processApprovalWithCurrentEmployee(
									transactionDbService,
									transactionEmployee,
									"absence_entry",
									absenceId,
									action,
									reason,
									action === "approve"
										? persistApprovedAbsence
										: (service, entityId, approver) =>
												persistRejectedAbsence(
													service,
													entityId,
													approver,
													reason ?? "",
												),
									undefined,
									{ ...options, transactional: true },
									undefined,
									transactionBehavior,
								).pipe(
									Effect.provideService(
										ApprovalAuditLogger,
										createApprovalAuditLogger(transactionDbService),
									),
								) as Effect.Effect<unknown, AnyAppError, never>,
							),
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
