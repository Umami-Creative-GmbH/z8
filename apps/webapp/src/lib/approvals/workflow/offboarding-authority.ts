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
import {
	type ApprovalCommandResult,
	type ApprovalDbService,
	type ApprovalWorkflowSnapshot,
	isDeactivationHandoverPrincipal,
	type OffboardingHandoverPrincipal,
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
	/** The deactivation a deactivation principal names (#1440). */
	deactivation?: {
		id: string;
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string | null;
		/**
		 * Not reactivated, and the employee is still off with the
		 * `deactivated_at` this deactivation wrote.
		 */
		effective: boolean;
	} | null;
	task: {
		id: string;
		organizationId: string;
		departureId: string | null;
		deactivationId?: string | null;
		employmentPeriodId: string;
		employeeId: string;
		kind: string;
		status: "pending" | "processing" | "completed" | "failed";
		claimToken: string | null;
		/** While processing, the lease expiry. */
		leaseUntil: Instant;
		payload: ApprovalHandoverTaskPayload | null;
	} | null;
	/**
	 * A newer employment period is open (departure) or the deactivation was
	 * reactivated: the old anchor's retries must not act.
	 */
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
	/** The deactivation the principal names doesn't match its persisted row (#1440). */
	| "deactivation_mismatch"
	/** The deactivation no longer holds: superseded, or the instant changed. */
	| "deactivation_not_effective"
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
	const { principal, command, workflow, task } = facts;
	if (command.type !== "reassign") return denied("command_not_reassign");
	if (workflow.organizationId !== facts.organizationId) return denied("workflow_mismatch");

	const anchor = verifiedAnchor(facts, command.fromEmployeeId);
	if (anchor.kind === "denied") return anchor;

	const intent = task?.payload;
	if (
		!task ||
		!intent ||
		task.id !== principal.handoverTaskId ||
		task.organizationId !== facts.organizationId ||
		task.departureId !== anchor.departureId ||
		(task.deactivationId ?? null) !== anchor.deactivationId ||
		task.employmentPeriodId !== principal.employmentPeriodId ||
		task.employeeId !== command.fromEmployeeId ||
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

type VerifiedAnchor =
	| { kind: "verified"; departureId: string | null; deactivationId: string | null }
	| { kind: "denied"; reason: OffboardingReassignmentDenial };

/**
 * The persisted anchor the principal names: an effective departure, or a
 * deactivation that still holds (#1440). A reactivated deactivation is not
 * refused here; like a rehire it is reported after a receipt replay check.
 */
function verifiedAnchor(
	facts: OffboardingReassignmentFacts,
	fromEmployeeId: string,
): VerifiedAnchor {
	const { principal } = facts;
	if (isDeactivationHandoverPrincipal(principal)) {
		const deactivation = facts.deactivation;
		if (
			!deactivation ||
			deactivation.id !== principal.deactivationId ||
			deactivation.organizationId !== facts.organizationId ||
			deactivation.employmentPeriodId !== principal.employmentPeriodId ||
			deactivation.employeeId !== fromEmployeeId
		) {
			return { kind: "denied", reason: "deactivation_mismatch" };
		}
		if (!deactivation.effective && !facts.rehired) {
			return { kind: "denied", reason: "deactivation_not_effective" };
		}
		return { kind: "verified", departureId: null, deactivationId: deactivation.id };
	}
	const departure = facts.departure;
	if (
		!departure ||
		departure.id !== principal.departureId ||
		departure.organizationId !== facts.organizationId ||
		departure.employmentPeriodId !== principal.employmentPeriodId ||
		departure.employeeId !== fromEmployeeId
	) {
		return { kind: "denied", reason: "departure_mismatch" };
	}
	if (departure.status !== "effective") {
		return { kind: "denied", reason: "departure_not_effective" };
	}
	return { kind: "verified", departureId: departure.id, deactivationId: null };
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
	const deactivationPrincipal = isDeactivationHandoverPrincipal(input.principal)
		? input.principal
		: null;
	const departurePrincipal = isDeactivationHandoverPrincipal(input.principal)
		? null
		: input.principal;
	const [departure] = !departurePrincipal
		? []
		: rows<{
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
					WHERE organization_id = ${input.organizationId}
						AND id = ${departurePrincipal.departureId}::uuid
					FOR SHARE
				`),
			);
	// A reactivation stamps the row, so the share lock keeps it from ending
	// the deactivation while this command commits.
	const [deactivation] = deactivationPrincipal
		? rows<{
				id: string;
				organization_id: string;
				employee_id: string;
				employment_period_id: string | null;
				reactivated: boolean;
				effective: boolean;
			}>(
				await database.execute(sql`
					SELECT d.id, d.organization_id, d.employee_id, d.employment_period_id,
						(d.reactivated_at IS NOT NULL OR e.is_active = true) AS reactivated,
						(d.reactivated_at IS NULL AND e.is_active = false
							AND (e.deactivated_at IS NOT DISTINCT FROM d.deactivated_at
								-- A backfilled deactivation whose date was not recorded (#1442):
								-- the employee keeps no instant, the row keeps the run's.
								OR (d.reason = 'employee_deactivation_backfill' AND e.deactivated_at IS NULL)))
							AS effective
					FROM employee_deactivation d
					JOIN employee e ON e.id = d.employee_id AND e.organization_id = d.organization_id
					WHERE d.organization_id = ${input.organizationId}
						AND d.id = ${deactivationPrincipal.deactivationId}::uuid
					FOR SHARE OF d
				`),
			)
		: [];
	const [task] = rows<{
		id: string;
		organization_id: string;
		departure_id: string | null;
		deactivation_id: string | null;
		employment_period_id: string;
		employee_id: string;
		kind: string;
		status: "pending" | "processing" | "completed" | "failed";
		claim_token: string | null;
		available_at: Date;
		payload: unknown;
	}>(
		await database.execute(sql`
			SELECT id, organization_id, departure_id, deactivation_id, employment_period_id, employee_id,
				kind, status, claim_token, available_at, payload
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
		: deactivation
			? [{ rehired: deactivation.reactivated === true }]
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
		deactivation: deactivation
			? {
					id: deactivation.id,
					organizationId: deactivation.organization_id,
					employeeId: deactivation.employee_id,
					employmentPeriodId: deactivation.employment_period_id,
					effective: deactivation.effective === true,
				}
			: null,
		task: task
			? {
					id: task.id,
					organizationId: task.organization_id,
					departureId: task.departure_id,
					deactivationId: task.deactivation_id,
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
