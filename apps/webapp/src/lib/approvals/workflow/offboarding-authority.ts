import { sql } from "drizzle-orm";
import type { db } from "@/db";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { hasApprovalDecisionPath } from "../escalation/candidates";
import type {
	ApprovalCommandResult,
	ApprovalDbService,
	ApprovalWorkflowSnapshot,
	OffboardingHandoverPrincipal,
} from "./ports";
import type { ApprovalWorkflowCommand } from "./state-machine";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Persisted intent of one `approval_handover` departure task: the exact
 * pending assignment captured when the departure became effective, and the
 * replacement chosen for it (null until an admin assigns one).
 */
export interface ApprovalHandoverTaskPayload {
	workflowId: string;
	stageId: string;
	assignmentId: string;
	fromEmployeeId: string;
	replacementEmployeeId: string | null;
}

/** Validates a task payload into the handover intent; progress keys are ignored. */
export function parseApprovalHandoverTaskPayload(
	value: unknown,
): ApprovalHandoverTaskPayload | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		!isCanonicalUuid(record.workflowId) ||
		!isCanonicalUuid(record.stageId) ||
		!isCanonicalUuid(record.assignmentId) ||
		!isCanonicalUuid(record.fromEmployeeId) ||
		(record.replacementEmployeeId !== null && !isCanonicalUuid(record.replacementEmployeeId))
	) {
		return null;
	}
	return {
		workflowId: record.workflowId,
		stageId: record.stageId,
		assignmentId: record.assignmentId,
		fromEmployeeId: record.fromEmployeeId,
		replacementEmployeeId: record.replacementEmployeeId as string | null,
	};
}

export interface OffboardingReassignmentFacts {
	now: Instant;
	organizationId: string;
	principal: OffboardingHandoverPrincipal;
	command: ApprovalWorkflowCommand;
	workflow: ApprovalWorkflowSnapshot;
	departure: {
		id: string;
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		status: "pending" | "canceled" | "blocked" | "effective";
		cutoffAt: Instant;
	} | null;
	task: {
		id: string;
		organizationId: string;
		departureId: string | null;
		employmentPeriodId: string;
		employeeId: string;
		kind: string;
		status: "pending" | "processing" | "completed" | "failed";
		claimToken: string | null;
		/** While processing, the lease expiry. */
		leaseUntil: Instant;
		payload: ApprovalHandoverTaskPayload | null;
	} | null;
	/** A newer employment period is open: the old departure's retries must not act. */
	rehired: boolean;
	target: {
		employeeId: string;
		organizationId: string;
		/** Active, approved member and not past a due departure. */
		hasOrganizationAccess: boolean;
		/** May decide this requester's approvals under current authorization. */
		hasDecisionPath: boolean;
	} | null;
	replay: ApprovalCommandResult | null;
}

export type OffboardingReassignmentDenial =
	| "command_not_reassign"
	| "workflow_mismatch"
	| "departure_mismatch"
	| "departure_not_effective"
	| "task_mismatch"
	| "lease_not_owned"
	| "target_mismatch"
	| "employee_rehired"
	| "source_not_pending"
	| "target_is_requester"
	| "target_already_pending"
	| "target_ineligible"
	| "replay_lineage_mismatch";

export type OffboardingReassignmentEvaluation =
	| { kind: "authorized" }
	| { kind: "denied"; reason: OffboardingReassignmentDenial };

function denied(reason: OffboardingReassignmentDenial): OffboardingReassignmentEvaluation {
	return { kind: "denied", reason };
}

/**
 * Decides whether the offboarding principal may execute this command. Every
 * supplied identifier must match persisted evidence: an effective departure,
 * the handover task it owns under a live lease, and the exact pending
 * assignment the task captured when the departure became effective (the
 * capture, not an assignment timestamp, is the identity evidence). A fresh
 * execution also requires a currently eligible target; a receipt replay
 * instead proves the recorded transfer.
 */
export function evaluateOffboardingReassignment(
	facts: OffboardingReassignmentFacts,
): OffboardingReassignmentEvaluation {
	const { principal, command, workflow, departure, task } = facts;
	if (command.type !== "reassign") return denied("command_not_reassign");
	if (workflow.organizationId !== facts.organizationId) return denied("workflow_mismatch");

	if (
		!departure ||
		departure.id !== principal.departureId ||
		departure.organizationId !== facts.organizationId ||
		departure.employmentPeriodId !== principal.employmentPeriodId ||
		departure.employeeId !== command.fromEmployeeId
	) {
		return denied("departure_mismatch");
	}
	if (departure.status !== "effective") return denied("departure_not_effective");

	const intent = task?.payload;
	if (
		!task ||
		!intent ||
		task.id !== principal.handoverTaskId ||
		task.organizationId !== facts.organizationId ||
		task.departureId !== departure.id ||
		task.employmentPeriodId !== departure.employmentPeriodId ||
		task.employeeId !== departure.employeeId ||
		task.kind !== "approval_handover" ||
		intent.assignmentId !== principal.assignmentId ||
		intent.workflowId !== workflow.id ||
		intent.stageId !== command.stageId ||
		intent.fromEmployeeId !== command.fromEmployeeId
	) {
		return denied("task_mismatch");
	}
	if (
		task.status !== "processing" ||
		task.claimToken !== principal.claimToken ||
		compareInstants(task.leaseUntil, facts.now) <= 0
	) {
		return denied("lease_not_owned");
	}
	if (
		intent.replacementEmployeeId === null ||
		intent.replacementEmployeeId !== command.toEmployeeId
	) {
		return denied("target_mismatch");
	}

	if (facts.replay) {
		return replayRecordsTransfer(facts.replay, principal.assignmentId, command.toEmployeeId)
			? { kind: "authorized" }
			: denied("replay_lineage_mismatch");
	}

	if (facts.rehired) return denied("employee_rehired");

	const stage = workflow.stages.find((candidate) => candidate.id === command.stageId);
	const source = stage?.assignments.find((candidate) => candidate.id === principal.assignmentId);
	if (
		workflow.status !== "pending" ||
		!stage ||
		stage.sequence !== workflow.currentStageOrder ||
		stage.status !== "pending" ||
		stage.activationMode !== "human" ||
		!source ||
		source.status !== "pending" ||
		source.approverEmployeeId !== command.fromEmployeeId
	) {
		return denied("source_not_pending");
	}
	if (command.toEmployeeId === workflow.requesterEmployeeId) return denied("target_is_requester");
	if (
		stage.assignments.some(
			(assignment) =>
				assignment.status === "pending" && assignment.approverEmployeeId === command.toEmployeeId,
		)
	) {
		return denied("target_already_pending");
	}
	const target = facts.target;
	if (
		!target ||
		target.employeeId !== command.toEmployeeId ||
		target.organizationId !== facts.organizationId ||
		!target.hasOrganizationAccess ||
		!target.hasDecisionPath
	) {
		return denied("target_ineligible");
	}
	return { kind: "authorized" };
}

/** The receipt must contain the transfer of exactly this source to this target. */
function replayRecordsTransfer(
	result: ApprovalCommandResult,
	sourceAssignmentId: string,
	targetEmployeeId: string,
): boolean {
	const event = result.events.find(
		(candidate) =>
			candidate.eventType === "assignment.reassigned" &&
			candidate.references?.sourceAssignmentId === sourceAssignmentId,
	);
	const targetAssignmentId = event?.references?.targetAssignmentId;
	if (!targetAssignmentId) return false;
	const target = result.snapshot.stages
		.flatMap((stage) => stage.assignments)
		.find((assignment) => assignment.id === targetAssignmentId);
	return (
		target?.approverEmployeeId === targetEmployeeId &&
		target.reassignedFromAssignmentId === sourceAssignmentId
	);
}

export class OffboardingReassignmentDeniedError extends Error {
	constructor(readonly reason: OffboardingReassignmentDenial) {
		super(`Offboarding reassignment denied: ${reason}`);
		this.name = "OffboardingReassignmentDeniedError";
	}
}

function rows<T>(result: unknown): T[] {
	return typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
		? (result.rows as T[])
		: [];
}

/**
 * Loads the handover evidence inside the engine transaction and evaluates it.
 * The departure and task rows are share-locked, so the lease cannot rotate and
 * the departure cannot change while this command commits. Lock order within
 * the engine transaction: organization rollout gate, departure, task, then the
 * workflow version CAS. The worker never holds the task row while waiting.
 */
export function createOffboardingReassignmentAuthority(options: {
	clock: { nowInstant(): Instant };
}) {
	return {
		async authorize(input: {
			dbService: ApprovalDbService;
			organizationId: string;
			workflow: ApprovalWorkflowSnapshot;
			principal: OffboardingHandoverPrincipal;
			command: ApprovalWorkflowCommand;
			replay: ApprovalCommandResult | null;
		}): Promise<"offboarding_reassignment"> {
			const now = options.clock.nowInstant();
			const facts = await loadOffboardingReassignmentFacts({ ...input, now });
			const evaluation = evaluateOffboardingReassignment(facts);
			if (evaluation.kind === "denied") {
				throw new OffboardingReassignmentDeniedError(evaluation.reason);
			}
			return "offboarding_reassignment";
		},
	};
}

async function loadOffboardingReassignmentFacts(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	workflow: ApprovalWorkflowSnapshot;
	principal: OffboardingHandoverPrincipal;
	command: ApprovalWorkflowCommand;
	replay: ApprovalCommandResult | null;
	now: Instant;
}): Promise<OffboardingReassignmentFacts> {
	const database = input.dbService.db;
	const [departure] = rows<{
		id: string;
		organization_id: string;
		employee_id: string;
		employment_period_id: string;
		status: "pending" | "canceled" | "blocked" | "effective";
		cutoff_at: Date;
	}>(
		await database.execute(sql`
			SELECT id, organization_id, employee_id, employment_period_id, status, cutoff_at
			FROM employee_departure
			WHERE organization_id = ${input.organizationId} AND id = ${input.principal.departureId}::uuid
			FOR SHARE
		`),
	);
	const [task] = rows<{
		id: string;
		organization_id: string;
		departure_id: string | null;
		employment_period_id: string;
		employee_id: string;
		kind: string;
		status: "pending" | "processing" | "completed" | "failed";
		claim_token: string | null;
		available_at: Date;
		payload: unknown;
	}>(
		await database.execute(sql`
			SELECT id, organization_id, departure_id, employment_period_id, employee_id, kind, status,
				claim_token, available_at, payload
			FROM employee_departure_task
			WHERE organization_id = ${input.organizationId} AND id = ${input.principal.handoverTaskId}::uuid
			FOR SHARE
		`),
	);
	const [rehired] = departure
		? rows<{ rehired: boolean }>(
				await database.execute(sql`
					SELECT EXISTS (
						SELECT 1 FROM employee_employment_period
						WHERE organization_id = ${input.organizationId}
							AND employee_id = ${departure.employee_id}::uuid AND status = 'open'
					) AS rehired
				`),
			)
		: [];

	const toEmployeeId = input.command.type === "reassign" ? input.command.toEmployeeId : null;
	const requesterEmployeeId = input.workflow.requesterEmployeeId;
	let target: OffboardingReassignmentFacts["target"] = null;
	if (!input.replay && toEmployeeId && isCanonicalUuid(toEmployeeId) && requesterEmployeeId) {
		const [candidate] = rows<{
			id: string;
			organization_id: string;
			user_id: string;
			has_access: boolean;
		}>(
			await database.execute(sql`
				SELECT e.id, e.organization_id, e.user_id,
					(e.is_active = true
						AND EXISTS (
							SELECT 1 FROM member m
							WHERE m.organization_id = e.organization_id AND m.user_id = e.user_id
								AND m.status = 'approved'
						)
						AND NOT employee_departure_denies_access(
							e.organization_id, e.id, ${dateFromInstant(input.now)}::timestamptz
						)) AS has_access
				FROM employee e
				WHERE e.organization_id = ${input.organizationId} AND e.id = ${toEmployeeId}::uuid
			`),
		);
		if (candidate) {
			target = {
				employeeId: candidate.id,
				organizationId: candidate.organization_id,
				hasOrganizationAccess: candidate.has_access === true,
				hasDecisionPath:
					candidate.has_access === true &&
					(await hasApprovalDecisionPath(database as unknown as DatabaseTransaction, {
						organizationId: input.organizationId,
						requesterEmployeeId,
						managerEmployeeId: candidate.id,
						managerUserId: candidate.user_id,
					})),
			};
		}
	}

	return {
		now: input.now,
		organizationId: input.organizationId,
		principal: input.principal,
		command: input.command,
		workflow: input.workflow,
		departure: departure
			? {
					id: departure.id,
					organizationId: departure.organization_id,
					employeeId: departure.employee_id,
					employmentPeriodId: departure.employment_period_id,
					status: departure.status,
					cutoffAt: instantFromDate(new Date(departure.cutoff_at)),
				}
			: null,
		task: task
			? {
					id: task.id,
					organizationId: task.organization_id,
					departureId: task.departure_id,
					employmentPeriodId: task.employment_period_id,
					employeeId: task.employee_id,
					kind: task.kind,
					status: task.status,
					claimToken: task.claim_token,
					leaseUntil: instantFromDate(new Date(task.available_at)),
					payload: parseApprovalHandoverTaskPayload(task.payload),
				}
			: null,
		rehired: rehired?.rehired === true,
		target,
		replay: input.replay,
	};
}
