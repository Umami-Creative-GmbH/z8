import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { db as rootDatabase } from "@/db";
import { employeeDepartureEvent, employeeDepartureReview } from "@/db/schema/employee-lifecycle";
import {
	type ApprovalHandoverTaskPayload,
	OffboardingReassignmentDeniedError,
	parseApprovalHandoverTaskPayload,
} from "@/lib/approvals/workflow/offboarding-authority";
import type { ApprovalWorkflowCommandRequest } from "@/lib/approvals/workflow/ports";
import type { ApprovalWorkflowDatabase } from "@/lib/approvals/workflow/repository";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import { ApprovalStateMachineError } from "@/lib/approvals/workflow/state-machine";
import { ApprovalTransitionEngineError } from "@/lib/approvals/workflow/transition-engine";
import { type Clock, dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { type DepartureTaskHandler, DepartureTaskNeedsResolutionError } from "./delivery";
import { assertReadCommitted } from "./locks";
import { enqueueReviewNotifications } from "./notifications";
import { DepartureTaskLeaseNotOwnedError } from "./outbox";
import { actorMayResolveDepartureWork } from "./reviews";
import type { DepartureIdentity, LifecycleActor, LifecycleTransaction } from "./types";

type LifecycleRootDatabase = Pick<
	typeof rootDatabase,
	"transaction" | "execute" | "insert" | "update"
>;

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Retries of one delivery attempt after losing the workflow version race. */
const VERSION_CONFLICT_ATTEMPTS = 3;

/**
 * Captures, inside the effective-departure transaction, one handover task per
 * pending duty the departed employee holds in the current human stage of a
 * pending canonical workflow. Each task names the exact assignment, so a
 * retry can never touch a duty created later (for example after a rehire).
 * Pending legacy-only approval requests cannot be transferred canonically and
 * become review work instead. Nothing is fetched into application memory.
 */
export async function captureApprovalHandoverDuties(
	tx: LifecycleTransaction,
	identity: DepartureIdentity,
	replacementEmployeeId: string | null,
): Promise<void> {
	await tx.execute(sql`
		INSERT INTO employee_departure_task
			(organization_id, employee_id, employment_period_id, departure_id, kind, dedupe_key, payload)
		SELECT a.organization_id, ${identity.employeeId}::uuid, ${identity.employmentPeriodId}::uuid,
			${identity.departureId}::uuid, 'approval_handover',
			'handover:' || ${identity.departureId} || ':' || a.id::text,
			jsonb_build_object(
				'workflowId', a.workflow_id, 'stageId', a.stage_id, 'assignmentId', a.id,
				'fromEmployeeId', a.approver_employee_id,
				'replacementEmployeeId', ${replacementEmployeeId}::uuid
			)
		FROM approval_stage_assignment a
		JOIN approval_workflow_stage s
			ON s.id = a.stage_id AND s.organization_id = a.organization_id
		JOIN approval_workflow w
			ON w.id = a.workflow_id AND w.organization_id = a.organization_id
		WHERE a.organization_id = ${identity.organizationId}
			AND a.approver_employee_id = ${identity.employeeId}::uuid AND a.status = 'pending'
			AND w.status = 'pending' AND s.status = 'pending' AND s.activation_mode = 'human'
			AND s.stage_order = w.current_stage_order
		ON CONFLICT DO NOTHING
	`);
	await tx.execute(sql`
		INSERT INTO employee_departure_review
			(organization_id, employee_id, employment_period_id, departure_id, kind, subject_id, metadata)
		SELECT r.organization_id, ${identity.employeeId}::uuid, ${identity.employmentPeriodId}::uuid,
			${identity.departureId}::uuid, 'approval_handover', r.id,
			jsonb_build_object(
				'reason', 'legacy_authority', 'source', 'legacy_approval_request',
				'approvalRequestId', r.id, 'entityType', r.entity_type, 'entityId', r.entity_id
			)
		FROM approval_request r
		WHERE r.organization_id = ${identity.organizationId}
			AND r.approver_id = ${identity.employeeId}::uuid AND r.status = 'pending'
			AND NOT EXISTS (
				SELECT 1 FROM approval_workflow_stage s
				WHERE s.organization_id = r.organization_id AND s.legacy_approval_request_id = r.id
			)
		ON CONFLICT DO NOTHING
	`);
}

type ApprovalHandoverRuntime = Pick<
	ReturnType<typeof createProductionApprovalWorkflowRuntime>,
	"repository" | "transitionEngine"
>;

function refuseFinalization(): never {
	throw new Error("Departure handover never finalizes an approval");
}

/** Reassignment never reaches terminal finalization, so every finalizer refuses. */
export function createApprovalHandoverRuntime(
	database: ApprovalWorkflowDatabase,
	clock: Clock,
): ApprovalHandoverRuntime {
	return createProductionApprovalWorkflowRuntime({
		db: database,
		adapters: {
			absence: {
				clock,
				finalizeAbsenceTerminal: async () => refuseFinalization(),
				deleteCancelledAbsence: async () => refuseFinalization(),
			},
			timeCorrection: {
				clock,
				finalizeTimeCorrectionTerminal: async () => refuseFinalization(),
				deleteCancelledCorrections: async () => refuseFinalization(),
			},
			ordinaryWorkPeriod: { finalizeTerminal: async () => refuseFinalization() },
		},
		canManageApproval: async () => false,
		clock,
	});
}

export type ApprovalHandoverOutcome = "transferred" | "source_resolved" | "employee_rehired";

/** Denials that only an admin decision (a new replacement or review) can fix. */
const NEEDS_ADMIN_REASONS = new Set([
	"target_mismatch",
	"target_is_requester",
	"target_already_pending",
	"target_ineligible",
	"departure_mismatch",
	"departure_not_effective",
	"task_mismatch",
	"workflow_mismatch",
	"replay_lineage_mismatch",
]);

/**
 * Delivers one claimed `approval_handover` task. The worker holds no task row
 * lock while the engine runs; the engine re-verifies the lease and every piece
 * of evidence in its own transaction. A committed transfer replays through its
 * receipt, a source that was decided or moved meanwhile is a distinct no-op,
 * and a missing or ineligible replacement becomes durable review work.
 */
export function createApprovalHandoverHandler(deps: {
	database: LifecycleRootDatabase;
	clock: Clock;
	runtime: ApprovalHandoverRuntime;
}): DepartureTaskHandler {
	return async (claim, context) => {
		const departureId = claim.departureId;
		const intent = parseApprovalHandoverTaskPayload(claim.payload);
		if (!departureId || !intent) {
			throw new DepartureTaskNeedsResolutionError("invalid_handover_payload");
		}
		const scope = {
			organizationId: claim.organizationId,
			employeeId: claim.employeeId,
			employmentPeriodId: claim.employmentPeriodId,
			departureId,
			handoverTaskId: claim.id,
		};
		if (intent.replacementEmployeeId === null) {
			await raiseHandoverReview(deps.database, scope, intent, "no_replacement");
			throw new DepartureTaskNeedsResolutionError("no_replacement");
		}

		for (let attempt = 0; attempt < VERSION_CONFLICT_ATTEMPTS; attempt += 1) {
			const snapshot = await deps.runtime.repository.withTransaction((transaction) =>
				transaction.repository.loadSnapshot({
					organizationId: claim.organizationId,
					workflowId: intent.workflowId,
				}),
			);
			const request: ApprovalWorkflowCommandRequest = {
				organizationId: claim.organizationId,
				workflowId: intent.workflowId,
				expectedVersion: snapshot.version,
				idempotencyKey: handoverIdempotencyKey(
					departureId,
					intent.assignmentId,
					claim.payload.resolutionRequestId,
				),
				principal: {
					kind: "system",
					systemId: "employee-offboarding",
					departureId,
					employmentPeriodId: claim.employmentPeriodId,
					assignmentId: intent.assignmentId,
					handoverTaskId: claim.id,
					claimToken: claim.claimToken,
				},
				command: {
					type: "reassign",
					stageId: intent.stageId,
					fromEmployeeId: intent.fromEmployeeId,
					toEmployeeId: intent.replacementEmployeeId,
				},
			};
			try {
				const result = await deps.runtime.transitionEngine.execute(request);
				const event = result.events.find(
					(candidate) =>
						candidate.eventType === "assignment.reassigned" &&
						candidate.references?.sourceAssignmentId === intent.assignmentId,
				);
				await context.recordProgress({
					outcome: "transferred" satisfies ApprovalHandoverOutcome,
					targetAssignmentId: event?.references?.targetAssignmentId ?? null,
				});
				await resolveHandoverReview(deps.database, scope, intent, deps.clock.nowInstant());
				return;
			} catch (error) {
				if (isVersionRace(error)) continue;
				if (error instanceof OffboardingReassignmentDeniedError) {
					if (error.reason === "lease_not_owned") throw new DepartureTaskLeaseNotOwnedError();
					if (error.reason === "source_not_pending") {
						// Decided or moved meanwhile: never a fabricated transfer.
						await context.recordProgress({
							outcome: "source_resolved" satisfies ApprovalHandoverOutcome,
						});
						await resolveHandoverReview(deps.database, scope, intent, deps.clock.nowInstant());
						return;
					}
					if (error.reason === "employee_rehired") {
						await context.recordProgress({
							outcome: "employee_rehired" satisfies ApprovalHandoverOutcome,
						});
						return;
					}
					if (NEEDS_ADMIN_REASONS.has(error.reason)) {
						await raiseHandoverReview(deps.database, scope, intent, error.reason);
						throw new DepartureTaskNeedsResolutionError(error.reason);
					}
				}
				if (
					error instanceof ApprovalTransitionEngineError &&
					error.code === "forbidden" &&
					error.details.field === "canonical_authority"
				) {
					// Legacy-authoritative workflows are not transferred canonically.
					await raiseHandoverReview(deps.database, scope, intent, "legacy_authority");
					throw new DepartureTaskNeedsResolutionError("legacy_authority");
				}
				if (
					error instanceof ApprovalTransitionEngineError &&
					error.code === "idempotency_mismatch"
				) {
					await raiseHandoverReview(deps.database, scope, intent, "receipt_conflict");
					throw new DepartureTaskNeedsResolutionError("receipt_conflict");
				}
				throw error;
			}
		}
		throw new Error("approval_handover_version_conflict");
	};
}

/**
 * Bound to the departure and the exact source assignment. A newly assigned
 * replacement for an unresolved task changes the target, so it gets its own
 * resolution suffix and never collides with an earlier attempt's receipt.
 */
function handoverIdempotencyKey(
	departureId: string,
	assignmentId: string,
	resolutionRequestId: unknown,
): string {
	const base = `offboarding:${departureId}:${assignmentId}`;
	return typeof resolutionRequestId === "string" && CANONICAL_UUID.test(resolutionRequestId)
		? `${base}:${resolutionRequestId}`
		: base;
}

function isVersionRace(error: unknown): boolean {
	return (
		(error instanceof ApprovalTransitionEngineError && error.code === "version_conflict") ||
		(error instanceof ApprovalStateMachineError && error.code === "STALE_STAGE")
	);
}

type HandoverScope = {
	organizationId: string;
	employeeId: string;
	employmentPeriodId: string;
	departureId: string;
	handoverTaskId: string;
};

/** Opens (or reopens) the review for this exact source assignment. */
async function raiseHandoverReview(
	database: LifecycleRootDatabase,
	scope: HandoverScope,
	intent: ApprovalHandoverTaskPayload | null,
	reason: string,
) {
	const metadata = {
		reason,
		handoverTaskId: scope.handoverTaskId,
		workflowId: intent?.workflowId ?? null,
		stageId: intent?.stageId ?? null,
		assignmentId: intent?.assignmentId ?? null,
		replacementEmployeeId: intent?.replacementEmployeeId ?? null,
	};
	await database
		.insert(employeeDepartureReview)
		.values({
			organizationId: scope.organizationId,
			employeeId: scope.employeeId,
			employmentPeriodId: scope.employmentPeriodId,
			departureId: scope.departureId,
			kind: "approval_handover",
			subjectId: intent?.assignmentId ?? null,
			metadata,
		})
		.onConflictDoUpdate({
			target: [
				employeeDepartureReview.organizationId,
				employeeDepartureReview.departureId,
				employeeDepartureReview.kind,
				employeeDepartureReview.subjectId,
			],
			set: {
				status: "open",
				metadata,
				resolvedAt: null,
				resolvedBy: null,
				resolution: null,
			},
		});
	await enqueueReviewNotifications(database, scope);
}

async function resolveHandoverReview(
	database: LifecycleRootDatabase,
	scope: HandoverScope,
	intent: ApprovalHandoverTaskPayload,
	now: Instant,
) {
	await database
		.update(employeeDepartureReview)
		.set({
			status: "resolved",
			resolvedAt: dateFromInstant(now),
			resolution: "handover_completed",
		})
		.where(
			and(
				eq(employeeDepartureReview.organizationId, scope.organizationId),
				eq(employeeDepartureReview.departureId, scope.departureId),
				eq(employeeDepartureReview.kind, "approval_handover"),
				eq(employeeDepartureReview.subjectId, intent.assignmentId),
				eq(employeeDepartureReview.status, "open"),
			),
		);
}

export type AssignDepartureReplacementErrorCode =
	| "actor_not_authorized"
	| "task_not_found"
	| "task_in_progress"
	| "task_already_completed"
	| "replacement_invalid"
	| "request_conflict";

export class AssignDepartureReplacementError extends Error {
	constructor(readonly code: AssignDepartureReplacementErrorCode) {
		super(code);
		this.name = "AssignDepartureReplacementError";
	}
}

/**
 * Sets a new replacement on an unresolved handover task and queues it for
 * delivery again. Only the task intent changes: completed decisions and
 * transfers are never touched, and the departed employee is never revived.
 * The request ID makes a retried submission return without a second change.
 */
export async function assignDepartureReplacement(
	database: Pick<typeof rootDatabase, "transaction">,
	actor: LifecycleActor,
	input: {
		departureId: string;
		handoverTaskId: string;
		replacementEmployeeId: string;
		requestId: string;
	},
	now: Instant,
): Promise<void> {
	const fingerprint = createHash("sha256")
		.update(JSON.stringify(["assign_departure_replacement", actor.userId, input]))
		.digest("hex");
	await database.transaction(async (tx) => {
		await assertReadCommitted(tx);
		if (!(await actorMayResolveDepartureWork(tx, actor.organizationId, actor.userId))) {
			throw new AssignDepartureReplacementError("actor_not_authorized");
		}
		const [receipt] = await tx
			.select({ fingerprint: employeeDepartureEvent.requestFingerprint })
			.from(employeeDepartureEvent)
			.where(
				and(
					eq(employeeDepartureEvent.organizationId, actor.organizationId),
					eq(employeeDepartureEvent.requestId, input.requestId),
					eq(employeeDepartureEvent.eventIndex, 0),
				),
			);
		if (receipt) {
			if (receipt.fingerprint !== fingerprint) {
				throw new AssignDepartureReplacementError("request_conflict");
			}
			return;
		}

		const tasks = await tx.execute<{
			employee_id: string;
			employment_period_id: string;
			status: string;
			payload: unknown;
		}>(sql`
			SELECT employee_id, employment_period_id, status, payload
			FROM employee_departure_task
			WHERE organization_id = ${actor.organizationId} AND id = ${input.handoverTaskId}::uuid
				AND departure_id = ${input.departureId}::uuid AND kind = 'approval_handover'
			FOR UPDATE
		`);
		const task = tasks.rows[0];
		const intent = parseApprovalHandoverTaskPayload(task?.payload);
		if (!task || !intent) throw new AssignDepartureReplacementError("task_not_found");
		if (task.status === "processing") throw new AssignDepartureReplacementError("task_in_progress");
		if (task.status === "completed") {
			throw new AssignDepartureReplacementError("task_already_completed");
		}

		const eligible = await tx.execute(sql`
			SELECT 1 FROM employee e
			JOIN member m ON m.user_id = e.user_id AND m.organization_id = e.organization_id
			WHERE e.organization_id = ${actor.organizationId}
				AND e.id = ${input.replacementEmployeeId}::uuid
				AND e.id <> ${task.employee_id}::uuid
				AND e.is_active = true AND m.status = 'approved'
				AND NOT employee_departure_denies_access(
					e.organization_id, e.id, ${dateFromInstant(now)}::timestamptz
				)
		`);
		if (eligible.rows.length === 0) {
			throw new AssignDepartureReplacementError("replacement_invalid");
		}

		const at = dateFromInstant(now);
		await tx.execute(sql`
			UPDATE employee_departure_task
			SET payload = (payload - 'outcome') || jsonb_build_object(
					'replacementEmployeeId', ${input.replacementEmployeeId}::uuid,
					'resolutionRequestId', ${input.requestId}::uuid
				),
				status = 'pending', claim_token = NULL, attempt_count = 0, last_error = NULL,
				available_at = ${at}, updated_at = ${at}
			WHERE organization_id = ${actor.organizationId} AND id = ${input.handoverTaskId}::uuid
		`);
		await tx.insert(employeeDepartureEvent).values({
			organizationId: actor.organizationId,
			employeeId: task.employee_id,
			employmentPeriodId: task.employment_period_id,
			departureId: input.departureId,
			requestId: input.requestId,
			eventIndex: 0,
			kind: "replacement_assigned",
			actorUserId: actor.userId,
			occurredAt: at,
			metadata: {
				handoverTaskId: input.handoverTaskId,
				assignmentId: intent.assignmentId,
				replacementEmployeeId: input.replacementEmployeeId,
			},
			requestFingerprint: fingerprint,
			result: {},
		});
	});
}
