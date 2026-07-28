import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { db } from "@/db";
import { parsePostgresTimestampWithoutTimeZoneAsUtc } from "@/db/postgres-utc";
import {
	approvalChainInstance,
	approvalChainStageInstance,
	approvalRequest,
} from "@/db/schema";
import { instantToDB } from "@/lib/datetime/drizzle-adapter";
import {
	normalizeTimeCorrectionWorkflowPayload,
	type TimeCorrectionWorkflowPayload,
} from "../domain-adapters/time-correction-contract";
import {
	type OrdinaryWorkPeriodWorkflowPayload,
	parseOrdinaryWorkPeriodWorkflowPayload,
} from "../domain-adapters/work-period-contract";
import type {
	ApprovalCommandResult,
	ApprovalDbService,
	ApprovalEventActorIdentity,
	ApprovalOutboxWriter,
	ApprovalProjectionWriter,
	ApprovalWriteGate,
	ObservedLegacyTransitionResult,
	TransactionalWorkflowRepository,
	VerifiedLegacyApprovalState,
} from "./ports";
import { normalizeObservedLegacyTransition } from "./repository";
import { normalizeStableData } from "./stable-data";

export interface LegacyCanonicalIdMapping {
	organizationId: string;
	workflowId: string;
	stageId: string;
	legacyApprovalRequestId: string;
}

export interface LegacyApprovalPersistence {
	resolveOrCreateStableIds(input: {
		organizationId: string;
		workflowId: string;
		stageIds: string[];
	}): Promise<LegacyCanonicalIdMapping[]>;
	writeLegacyRows(input: {
		organizationId: string;
		result: ApprovalCommandResult;
		legacyIds: LegacyCanonicalIdMapping[];
	}): Promise<void>;
}

export interface LegacyApprovalRowWriter {
	writeLegacyRows(input: {
		organizationId: string;
		result: ApprovalCommandResult;
		legacyIds: LegacyCanonicalIdMapping[];
	}): Promise<void>;
}

export interface ApprovalCompatibilityWriter {
	withWriteGate(writeGate: ApprovalWriteGate): ApprovalCompatibilityWriter;
	mirrorLegacyToCanonical(input: {
		before: VerifiedLegacyApprovalState;
		after: VerifiedLegacyApprovalState;
		actor: ApprovalEventActorIdentity;
		idempotencyKey: string;
		expectedVersion: number | null;
	}): Promise<ObservedLegacyTransitionResult | null>;
	mirrorCanonicalToLegacy(input: {
		result: ApprovalCommandResult;
	}): Promise<void>;
}

type ApprovalMutationClient = Pick<
	Parameters<Parameters<typeof db.transaction>[0]>[0],
	"delete" | "update"
>;

export async function cancelLegacyTimeCorrectionApprovalRows(input: {
	dbService: { db: ApprovalMutationClient };
	organizationId: string;
	workPeriodId: string;
	requesterEmployeeId: string;
	state: VerifiedLegacyApprovalState;
	cancelledAt: Date;
	retainDirectCancellation: boolean;
	directCancellationMetadata: Record<string, unknown>;
}): Promise<void> {
	const request = input.state.approvalRequest;
	if (!request) throw new Error("Time correction cancellation is unavailable");
	if (input.state.chain) {
		const pendingStages = input.state.chainRows.filter(
			(stage) => stage.status === "pending",
		);
		for (const stage of pendingStages) {
			const updated = await input.dbService.db
				.update(approvalChainStageInstance)
				.set({
					status: "cancelled",
					approvalRequestId: null,
					decidedBy: null,
					decidedAt: null,
				})
				.where(
					and(
						eq(approvalChainStageInstance.id, stage.id),
						eq(approvalChainStageInstance.organizationId, input.organizationId),
						eq(
							approvalChainStageInstance.chainInstanceId,
							input.state.chain.id,
						),
						eq(approvalChainStageInstance.status, "pending"),
						stage.approvalRequestId
							? eq(
									approvalChainStageInstance.approvalRequestId,
									stage.approvalRequestId,
								)
							: isNull(approvalChainStageInstance.approvalRequestId),
					),
				)
				.returning({ id: approvalChainStageInstance.id });
			if (updated.length !== 1 || updated[0]?.id !== stage.id) {
				throw new Error("Time correction cancellation is unavailable");
			}
		}
		const chains = await input.dbService.db
			.update(approvalChainInstance)
			.set({ status: "cancelled", completedAt: input.cancelledAt })
			.where(
				and(
					eq(approvalChainInstance.id, input.state.chain.id),
					eq(approvalChainInstance.organizationId, input.organizationId),
					eq(approvalChainInstance.entityType, "time_entry"),
					eq(approvalChainInstance.entityId, input.workPeriodId),
					eq(approvalChainInstance.status, "pending"),
				),
			)
			.returning({ id: approvalChainInstance.id });
		if (chains.length !== 1 || chains[0]?.id !== input.state.chain.id) {
			throw new Error("Time correction cancellation is unavailable");
		}
	}
	if (input.retainDirectCancellation) {
		const updated = await input.dbService.db
			.update(approvalRequest)
			.set({
				status: "rejected",
				rejectionReason: null,
				approvedAt: input.cancelledAt,
				metadata: input.directCancellationMetadata,
			})
			.where(
				and(
					eq(approvalRequest.id, request.id),
					eq(approvalRequest.organizationId, input.organizationId),
					eq(approvalRequest.entityType, "time_entry"),
					eq(approvalRequest.entityId, input.workPeriodId),
					eq(approvalRequest.requestedBy, input.requesterEmployeeId),
					eq(approvalRequest.status, "pending"),
					request.metadata === null
						? isNull(approvalRequest.metadata)
						: eq(approvalRequest.metadata, request.metadata),
				),
			)
			.returning({ id: approvalRequest.id });
		if (updated.length !== 1 || updated[0]?.id !== request.id) {
			throw new Error("Time correction cancellation is unavailable");
		}
		return;
	}
	const deleted = await input.dbService.db
		.delete(approvalRequest)
		.where(
			and(
				eq(approvalRequest.id, request.id),
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.workPeriodId),
				eq(approvalRequest.requestedBy, input.requesterEmployeeId),
				eq(approvalRequest.status, "pending"),
				request.metadata === null
					? isNull(approvalRequest.metadata)
					: eq(approvalRequest.metadata, request.metadata),
			),
		)
		.returning({ id: approvalRequest.id });
	if (deleted.length !== 1 || deleted[0]?.id !== request.id) {
		throw new Error("Time correction cancellation is unavailable");
	}
}

interface CompatibilityWriterDependencies {
	writeGate: ApprovalWriteGate;
	repository: TransactionalWorkflowRepository;
	projectionWriter: ApprovalProjectionWriter;
	outboxWriter: ApprovalOutboxWriter;
	legacyPersistence: LegacyApprovalPersistence;
}

interface LegacyStageIdRow {
	id: string;
	organizationId: string;
	workflowId: string;
	legacyApprovalRequestId: string | null;
}

interface LegacyApprovalRequestIdRow {
	id: string;
	organizationId: string;
}

export const LEGACY_ID_CANDIDATE_LIMIT = 8;
const LEGACY_ID_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

function uuidBytes(value: string): Buffer {
	const hexadecimal = value.replaceAll("-", "");
	if (!/^[0-9a-f]{32}$/i.test(hexadecimal)) {
		throw new Error(`Stable ID candidate requires a UUID stage ID: ${value}`);
	}
	return Buffer.from(hexadecimal, "hex");
}

function formatUuid(bytes: Uint8Array): string {
	const hexadecimal = Buffer.from(bytes).toString("hex");
	return [
		hexadecimal.slice(0, 8),
		hexadecimal.slice(8, 12),
		hexadecimal.slice(12, 16),
		hexadecimal.slice(16, 20),
		hexadecimal.slice(20),
	].join("-");
}

export function deterministicLegacyApprovalRequestId(
	stageId: string,
	attempt: number,
): string {
	if (!Number.isInteger(attempt) || attempt < 0) {
		throw new Error(
			"Stable ID candidate attempt must be a non-negative integer",
		);
	}
	if (attempt === 0) return stageId;
	const digest = createHash("sha1")
		.update(uuidBytes(LEGACY_ID_NAMESPACE))
		.update(`z8:approval-stage:${stageId}:${attempt}`)
		.digest();
	const bytes = new Uint8Array(digest.subarray(0, 16));
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	return formatUuid(bytes);
}

function exactlyOneLegacyRow(
	result: unknown,
	expectedId: string,
	entity: string,
): Record<string, unknown> {
	const returned = resultRows(result);
	const row = returned[0];
	if (
		returned.length !== 1 ||
		!row ||
		typeof row !== "object" ||
		!("id" in row) ||
		row.id !== expectedId
	) {
		throw new Error(`Legacy row writer affected-row mismatch for ${entity}`);
	}
	return row as Record<string, unknown>;
}

function assertLegacyRequestEvidence(
	row: Record<string, unknown>,
	input: {
		organizationId: string;
		sourceType: string;
		sourceId: string;
	},
): void {
	if (
		row.organization_id !== input.organizationId ||
		row.entity_type !== input.sourceType ||
		row.entity_id !== input.sourceId
	) {
		throw new Error("Legacy row writer returned a foreign approval request");
	}
}

function mappingByStage(
	result: ApprovalCommandResult,
	legacyIds: LegacyCanonicalIdMapping[],
): Map<string, LegacyCanonicalIdMapping> {
	assertStableMappings(result, legacyIds);
	return new Map(legacyIds.map((mapping) => [mapping.stageId, mapping]));
}

function policyChainEvidence(result: ApprovalCommandResult): {
	policyId: string;
	policyName: string;
	policyStageIds: Map<number, string>;
} {
	const policy = result.snapshot.policySnapshot;
	if (
		typeof policy.id !== "string" ||
		typeof policy.name !== "string" ||
		!Array.isArray(policy.stages)
	) {
		throw new Error(
			"Legacy row writer requires exact multistage policy evidence",
		);
	}
	const policyStageIds = new Map<number, string>();
	for (const stage of policy.stages) {
		if (
			!stage ||
			typeof stage !== "object" ||
			!("id" in stage) ||
			!("stepOrder" in stage) ||
			typeof stage.id !== "string" ||
			typeof stage.stepOrder !== "number" ||
			policyStageIds.has(stage.stepOrder)
		) {
			throw new Error("Legacy row writer received malformed policy stages");
		}
		policyStageIds.set(stage.stepOrder, stage.id);
	}
	if (
		result.snapshot.stages.some((stage) => !policyStageIds.has(stage.sequence))
	) {
		throw new Error(
			"Legacy row writer policy stages do not cover the workflow",
		);
	}
	return { policyId: policy.id, policyName: policy.name, policyStageIds };
}

function legacyStageStatus(
	status: ApprovalCommandResult["snapshot"]["stages"][number]["status"],
): "pending" | "approved" | "rejected" | "cancelled" {
	if (
		status === "approved" ||
		status === "rejected" ||
		status === "cancelled"
	) {
		return status;
	}
	return "pending";
}

interface LockedLegacyRequest {
	id: string;
	organizationId: string;
	entityType: string;
	entityId: string;
	requestedBy: string;
	approverId: string;
	status: "pending" | "approved" | "rejected";
	reason: string | null;
	rejectionReason: string | null;
	approvedAt: Date | null;
	metadata: unknown;
	updatedAt: Date;
}

interface LockedLegacyChain {
	id: string;
	organizationId: string;
	policyId: string;
	policyName: string;
	entityType: string;
	entityId: string;
	requesterEmployeeId: string;
	currentStageOrder: number;
	status: "pending" | "approved" | "rejected" | "cancelled";
	createdAt: Date;
	updatedAt: Date;
	completedAt: Date | null;
}

interface LockedLegacyChainStage {
	id: string;
	organizationId: string;
	chainInstanceId: string;
	policyStageId: string;
	stepOrder: number;
	label: string;
	approverType: string;
	approverEmployeeId: string;
	approvalRequestId: string | null;
	status: "pending" | "approved" | "rejected" | "cancelled";
	decidedBy: string | null;
	decidedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

function requiredString(row: Record<string, unknown>, key: string): string {
	const value = row[key];
	if (typeof value !== "string") {
		throw new Error(`Legacy row writer lock returned malformed ${key}`);
	}
	return value;
}

function nullableString(
	row: Record<string, unknown>,
	key: string,
): string | null {
	const value = row[key];
	if (value !== null && typeof value !== "string") {
		throw new Error(`Legacy row writer lock returned malformed ${key}`);
	}
	return value;
}

function requiredNumber(row: Record<string, unknown>, key: string): number {
	const value = row[key];
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new Error(`Legacy row writer lock returned malformed ${key}`);
	}
	return value;
}

function nullableDate(row: Record<string, unknown>, key: string): Date | null {
	const value = row[key];
	if (value === null) return null;
	if (typeof value === "string") {
		const parsed = parsePostgresTimestampWithoutTimeZoneAsUtc(value);
		if (parsed instanceof Date) return parsed;
	}
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
		throw new Error(`Legacy row writer lock returned malformed ${key}`);
	}
	return value;
}

function requiredDate(row: Record<string, unknown>, key: string): Date {
	return (
		nullableDate(row, key) ??
		(() => {
			throw new Error(`Legacy row writer lock returned malformed ${key}`);
		})()
	);
}

function lockedRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Legacy row writer lock returned malformed row");
	}
	return value as Record<string, unknown>;
}

function parseLockedRequests(result: unknown): LockedLegacyRequest[] {
	return resultRows(result).map((value) => {
		const row = lockedRecord(value);
		const status = requiredString(row, "status");
		if (
			status !== "pending" &&
			status !== "approved" &&
			status !== "rejected"
		) {
			throw new Error("Legacy row writer lock returned invalid request status");
		}
		return {
			id: requiredString(row, "id"),
			organizationId: requiredString(row, "organization_id"),
			entityType: requiredString(row, "entity_type"),
			entityId: requiredString(row, "entity_id"),
			requestedBy: requiredString(row, "requested_by"),
			approverId: requiredString(row, "approver_id"),
			status,
			reason: nullableString(row, "reason"),
			rejectionReason: nullableString(row, "rejection_reason"),
			approvedAt: nullableDate(row, "approved_at"),
			metadata: row.metadata,
			updatedAt: requiredDate(row, "updated_at"),
		};
	});
}

function parseLockedChains(result: unknown): LockedLegacyChain[] {
	return resultRows(result).map((value) => {
		const row = lockedRecord(value);
		const status = requiredString(row, "status");
		if (
			!(["pending", "approved", "rejected", "cancelled"] as const).includes(
				status as never,
			)
		) {
			throw new Error("Legacy row writer lock returned invalid chain status");
		}
		return {
			id: requiredString(row, "id"),
			organizationId: requiredString(row, "organization_id"),
			policyId: requiredString(row, "policy_id"),
			policyName: requiredString(row, "policy_name_snapshot"),
			entityType: requiredString(row, "entity_type"),
			entityId: requiredString(row, "entity_id"),
			requesterEmployeeId: requiredString(row, "requester_employee_id"),
			currentStageOrder: requiredNumber(row, "current_stage_order"),
			status: status as LockedLegacyChain["status"],
			createdAt: requiredDate(row, "created_at"),
			updatedAt: requiredDate(row, "updated_at"),
			completedAt: nullableDate(row, "completed_at"),
		};
	});
}

function parseLockedChainStages(result: unknown): LockedLegacyChainStage[] {
	return resultRows(result).map((value) => {
		const row = lockedRecord(value);
		const status = requiredString(row, "status");
		if (
			!(["pending", "approved", "rejected", "cancelled"] as const).includes(
				status as never,
			)
		) {
			throw new Error(
				"Legacy row writer lock returned invalid chain-stage status",
			);
		}
		return {
			id: requiredString(row, "id"),
			organizationId: requiredString(row, "organization_id"),
			chainInstanceId: requiredString(row, "chain_instance_id"),
			policyStageId: requiredString(row, "policy_stage_id"),
			stepOrder: requiredNumber(row, "step_order"),
			label: requiredString(row, "label_snapshot"),
			approverType: requiredString(row, "approver_type_snapshot"),
			approverEmployeeId: requiredString(row, "resolved_approver_employee_id"),
			approvalRequestId: nullableString(row, "approval_request_id"),
			status: status as LockedLegacyChainStage["status"],
			decidedBy: nullableString(row, "decided_by"),
			decidedAt: nullableDate(row, "decided_at"),
			createdAt: requiredDate(row, "created_at"),
			updatedAt: requiredDate(row, "updated_at"),
		};
	});
}

function sameDate(left: Date | null, right: Date | null): boolean {
	return left === null
		? right === null
		: right !== null && left.getTime() === right.getTime();
}

function canonicalJsonValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalJsonValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, canonicalJsonValue(child)]),
		);
	}
	return value;
}

function canonicalJson(value: unknown): string {
	return JSON.stringify(canonicalJsonValue(normalizeStableData(value)));
}

function sameJson(left: unknown, right: unknown): boolean {
	return canonicalJson(left) === canonicalJson(right);
}

function timeCorrectionCompatibilityPayload(
	snapshot: ApprovalCommandResult["snapshot"],
): TimeCorrectionWorkflowPayload["timeCorrection"] | null {
	if (
		snapshot.workflowType !== "time_correction" ||
		snapshot.sourceType !== "time_entry"
	) {
		return null;
	}
	try {
		const descriptor = Object.getOwnPropertyDescriptor(
			snapshot.contextSnapshot,
			"timeCorrection",
		);
		if (!descriptor?.enumerable || !("value" in descriptor)) {
			throw new Error();
		}
		return normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: descriptor.value,
		}).timeCorrection;
	} catch {
		throw new Error("Legacy time correction compatibility metadata is invalid");
	}
}

function timeCorrectionSubmissionEvidence(
	snapshot: ApprovalCommandResult["snapshot"],
): Record<string, string> | null {
	if (snapshot.workflowType !== "time_correction") return null;
	const descriptor = Object.getOwnPropertyDescriptor(
		snapshot.contextSnapshot,
		"submission",
	);
	if (!descriptor) return null;
	if (!descriptor.enumerable || !("value" in descriptor)) {
		throw new Error("Legacy time correction compatibility metadata is invalid");
	}
	const value = descriptor.value;
	const submissionIdDescriptor =
		value !== null && typeof value === "object" && !Array.isArray(value)
			? Object.getOwnPropertyDescriptor(value, "submissionId")
			: undefined;
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		(Object.getPrototypeOf(value) !== Object.prototype &&
			Object.getPrototypeOf(value) !== null) ||
		(Reflect.ownKeys(value).length !== 3 &&
			Reflect.ownKeys(value).length !== 4) ||
		!(["key", "resultKind", "originalStatus"] as const).every((key) => {
			const child = Object.getOwnPropertyDescriptor(value, key);
			return child?.enumerable && "value" in child;
		}) ||
		(Reflect.ownKeys(value).length === 4 &&
			(!submissionIdDescriptor?.enumerable ||
				!("value" in submissionIdDescriptor) ||
				typeof submissionIdDescriptor.value !== "string" ||
				submissionIdDescriptor.value.length === 0))
	) {
		throw new Error("Legacy time correction compatibility metadata is invalid");
	}
	const key = Object.getOwnPropertyDescriptor(value, "key")?.value;
	const resultKind = Object.getOwnPropertyDescriptor(
		value,
		"resultKind",
	)?.value;
	const originalStatus = Object.getOwnPropertyDescriptor(
		value,
		"originalStatus",
	)?.value;
	if (
		typeof key !== "string" ||
		key.length === 0 ||
		(resultKind !== "default_created" &&
			resultKind !== "chain_created" &&
			resultKind !== "auto_completed") ||
		(originalStatus !== "pending" && originalStatus !== "approved") ||
		(resultKind === "auto_completed") !== (originalStatus === "approved")
	) {
		throw new Error("Legacy time correction compatibility metadata is invalid");
	}
	return {
		key,
		resultKind,
		originalStatus,
		...(submissionIdDescriptor && "value" in submissionIdDescriptor
			? { submissionId: submissionIdDescriptor.value as string }
			: {}),
	};
}

function ordinaryWorkPeriodCompatibilityPayload(
	snapshot: ApprovalCommandResult["snapshot"],
): Readonly<OrdinaryWorkPeriodWorkflowPayload> | null {
	if (
		snapshot.sourceType !== "time_entry" ||
		(snapshot.workflowType !== "manual_time_submission" &&
			snapshot.workflowType !== "policy_clock_out")
	) {
		return null;
	}
	return parseOrdinaryWorkPeriodWorkflowPayload(
		snapshot.contextSnapshot,
		snapshot.workflowType,
	);
}

function legacyRequestMetadata(
	snapshot: ApprovalCommandResult["snapshot"],
	stage: CanonicalStage,
	assignment: CanonicalAssignment | undefined,
	correction: TimeCorrectionWorkflowPayload["timeCorrection"] | null,
	ordinaryPayload: Readonly<OrdinaryWorkPeriodWorkflowPayload> | null,
): Record<string, unknown> {
	const submission = timeCorrectionSubmissionEvidence(snapshot);
	return {
		workflow: {
			id: snapshot.id,
			organizationId: snapshot.organizationId,
		},
		stage: {
			id: stage.id,
			sequence: stage.sequence,
			...(assignment && !ordinaryPayload
				? { assignmentId: assignment.id }
				: {}),
		},
		...(correction ? { timeCorrection: correction } : {}),
		...(ordinaryPayload ?? {}),
		...(submission ? { submission } : {}),
	};
}

function stageDecisionActor(
	result: ApprovalCommandResult,
	stageId: string,
	assignment:
		| ApprovalCommandResult["snapshot"]["stages"][number]["assignments"][number]
		| undefined,
): string | null {
	if (assignment?.resolvedBy?.kind === "employee")
		return assignment.resolvedBy.employeeId;
	const event = result.events.find(
		(candidate) =>
			(candidate.eventType === "stage.approved" ||
				candidate.eventType === "stage.rejected" ||
				candidate.eventType === "stage.cancelled") &&
			candidate.metadata?.stageId === stageId,
	);
	return event?.actor.kind === "employee" ? event.actor.employeeId : null;
}

type CanonicalStage = ApprovalCommandResult["snapshot"]["stages"][number];
type CanonicalAssignment = CanonicalStage["assignments"][number];

function selectCanonicalStageAssignment(
	stage: CanonicalStage,
): CanonicalAssignment | undefined {
	if (
		stage.status === "approved" &&
		stage.activationMode === "requester_auto_approve"
	) {
		if (stage.assignments.length !== 0) {
			throw new Error(
				"Legacy row writer auto-approved stage has assignment candidates",
			);
		}
		return undefined;
	}
	if (stage.status === "waiting") {
		if (
			stage.assignments.some((assignment) => assignment.status === "pending")
		) {
			throw new Error(
				"Legacy row writer waiting stage has a pending assignment",
			);
		}
		return undefined;
	}
	if (stage.status === "cancelled") {
		if (
			stage.assignments.some((assignment) => assignment.status === "pending")
		) {
			throw new Error(
				"Legacy row writer cancelled stage has a pending assignment",
			);
		}
		return undefined;
	}
	const expectedStatus =
		stage.status === "pending"
			? "pending"
			: stage.status === "approved"
				? "approved"
				: stage.status === "rejected"
					? "rejected"
					: null;
	if (expectedStatus === null) {
		throw new Error("Legacy row writer cannot select an assignment candidate");
	}
	const candidates = stage.assignments.filter(
		(assignment) => assignment.status === expectedStatus,
	);
	if (
		(expectedStatus === "pending" && candidates.length === 0) ||
		(expectedStatus !== "pending" && candidates.length !== 1)
	) {
		throw new Error(
			`Legacy row writer requires ${expectedStatus === "pending" ? "an active" : "exactly one"} ${expectedStatus} assignment candidate`,
		);
	}
	const selected = candidates.toSorted(
		(left, right) =>
			left.sequence - right.sequence || left.id.localeCompare(right.id),
	)[0];
	if (!selected) {
		throw new Error("Legacy row writer assignment candidate is unavailable");
	}
	if (
		expectedStatus !== "pending" &&
		(selected.resolvedAt === null || selected.resolvedBy === null)
	) {
		throw new Error(
			"Legacy row writer resolved assignment evidence is missing",
		);
	}
	return selected;
}

function metadataAssignment(
	stage: CanonicalStage,
): CanonicalAssignment | undefined {
	if (stage.status !== "cancelled")
		return selectCanonicalStageAssignment(stage);
	return stage.assignments.toSorted(
		(left, right) =>
			left.sequence - right.sequence || left.id.localeCompare(right.id),
	)[0];
}

function metadataWithoutAssignmentId(metadata: unknown): unknown {
	const normalized = normalizeStableData(metadata);
	if (
		!normalized ||
		typeof normalized !== "object" ||
		Array.isArray(normalized)
	) {
		throw new Error("Legacy row writer request metadata is malformed");
	}
	const stageDescriptor = Object.getOwnPropertyDescriptor(normalized, "stage");
	if (
		!stageDescriptor?.enumerable ||
		!("value" in stageDescriptor) ||
		!stageDescriptor.value ||
		typeof stageDescriptor.value !== "object" ||
		Array.isArray(stageDescriptor.value)
	) {
		throw new Error("Legacy row writer request metadata is malformed");
	}
	return {
		...normalized,
		stage: Object.fromEntries(
			Object.entries(stageDescriptor.value).filter(
				([key]) => key !== "assignmentId",
			),
		),
	};
}

function sameRequestMetadataExceptAssignment(
	left: unknown,
	right: unknown,
): boolean {
	try {
		return sameJson(
			metadataWithoutAssignmentId(left),
			metadataWithoutAssignmentId(right),
		);
	} catch {
		return false;
	}
}

function assertCoherentPendingAdvancement(
	snapshot: ApprovalCommandResult["snapshot"],
): void {
	const desiredStageOrder = snapshot.currentStageOrder;
	if (desiredStageOrder === null) {
		throw new Error(
			"Legacy row writer pending chain has no active stage order",
		);
	}
	const activeStage = snapshot.stages.find(
		(stage) => stage.sequence === desiredStageOrder,
	);
	if (activeStage?.status !== "pending") {
		throw new Error(
			"Legacy row writer pending advancement has no coherent active stage",
		);
	}
	for (const stage of snapshot.stages) {
		if (stage.sequence >= desiredStageOrder) continue;
		if (stage.status !== "approved") {
			throw new Error(
				"Legacy row writer pending advancement skipped a non-approved stage",
			);
		}
		selectCanonicalStageAssignment(stage);
	}
}

export function createLegacyApprovalRowWriter(
	dbService: ApprovalDbService,
): LegacyApprovalRowWriter {
	return {
		async writeLegacyRows(input) {
			const snapshot = input.result.snapshot;
			if (
				input.organizationId !== snapshot.organizationId ||
				snapshot.requesterEmployeeId === null ||
				input.result.projection.organizationId !== input.organizationId ||
				input.result.projection.workflowId !== snapshot.id
			) {
				throw new Error("Legacy row writer canonical scope mismatch");
			}
			const correction = timeCorrectionCompatibilityPayload(snapshot);
			const ordinaryPayload = ordinaryWorkPeriodCompatibilityPayload(snapshot);
			const mappings = mappingByStage(input.result, input.legacyIds);
			const orderedStages = [...snapshot.stages].sort(
				(left, right) => left.sequence - right.sequence,
			);
			if (
				orderedStages.some((stage, index) => stage.sequence !== index + 1) ||
				orderedStages.some(
					(stage) =>
						stage.organizationId !== input.organizationId ||
						stage.workflowId !== snapshot.id,
				)
			) {
				throw new Error("Legacy row writer stage scope or order mismatch");
			}
			const occurredAt =
				input.result.events.at(-1)?.occurredAt ?? snapshot.submittedAt;
			const updatedAt = instantToDB(occurredAt);
			const legacyIdValues = sql.join(
				input.legacyIds.map(
					(mapping) => sql`${mapping.legacyApprovalRequestId}`,
				),
				sql`, `,
			);
			const currentRequests = parseLockedRequests(
				await dbService.db.execute(sql`
					select id, organization_id, entity_type, entity_id, requested_by,
						approver_id, status, reason, rejection_reason, approved_at,
						metadata, updated_at
					from approval_request
					where organization_id = ${input.organizationId}
						and entity_type = ${snapshot.sourceType}
						and entity_id = ${snapshot.sourceId}
						and id in (${legacyIdValues})
					order by id
					for update
				`),
			);
			const currentRequestById = new Map(
				currentRequests.map((request) => [request.id, request]),
			);
			if (
				currentRequestById.size !== currentRequests.length ||
				currentRequests.some(
					(request) =>
						request.organizationId !== input.organizationId ||
						request.entityType !== snapshot.sourceType ||
						request.entityId !== snapshot.sourceId ||
						![...mappings.values()].some(
							(mapping) => mapping.legacyApprovalRequestId === request.id,
						),
				)
			) {
				throw new Error("Legacy row writer locked foreign request state");
			}

			let currentChain: LockedLegacyChain | null = null;
			const currentChainStageById = new Map<string, LockedLegacyChainStage>();
			if (orderedStages.length > 1) {
				const stageIdValues = sql.join(
					orderedStages.map((stage) => sql`${stage.id}`),
					sql`, `,
				);
				const chains = parseLockedChains(
					await dbService.db.execute(sql`
						select id, organization_id, policy_id, policy_name_snapshot,
							entity_type, entity_id, requester_employee_id,
							current_stage_order, status, created_at, updated_at, completed_at
						from approval_chain_instance
						where organization_id = ${input.organizationId}
							and id = ${snapshot.id}
							and entity_type = ${snapshot.sourceType}
							and entity_id = ${snapshot.sourceId}
						for update
					`),
				);
				if (chains.length > 1) {
					throw new Error("Legacy row writer locked duplicate chain state");
				}
				currentChain = chains[0] ?? null;
				const chainStages = parseLockedChainStages(
					await dbService.db.execute(sql`
						select id, organization_id, chain_instance_id, policy_stage_id,
							step_order, label_snapshot, approver_type_snapshot,
							resolved_approver_employee_id, approval_request_id, status,
							decided_by, decided_at, created_at, updated_at
						from approval_chain_stage_instance
						where organization_id = ${input.organizationId}
							and chain_instance_id = ${snapshot.id}
							and id in (${stageIdValues})
						order by step_order, id
						for update
					`),
				);
				for (const chainStage of chainStages) {
					if (
						currentChainStageById.has(chainStage.id) ||
						chainStage.organizationId !== input.organizationId ||
						chainStage.chainInstanceId !== snapshot.id ||
						!orderedStages.some((stage) => stage.id === chainStage.id)
					) {
						throw new Error(
							"Legacy row writer locked foreign chain-stage state",
						);
					}
					currentChainStageById.set(chainStage.id, chainStage);
				}
			}
			if (snapshot.status === "pending" && currentChain) {
				if (
					snapshot.currentStageOrder === null ||
					snapshot.currentStageOrder < currentChain.currentStageOrder
				) {
					throw new Error(
						"Legacy row writer cannot regress pending chain order",
					);
				}
				assertCoherentPendingAdvancement(snapshot);
			}
			const requestMetadataByStageId = new Map(
				orderedStages.map((stage) => [
					stage.id,
					legacyRequestMetadata(
						snapshot,
						stage,
						metadataAssignment(stage),
						correction,
						ordinaryPayload,
					),
				]),
			);
			for (const stage of orderedStages) {
				const mapping = mappings.get(stage.id);
				const requestMetadata = requestMetadataByStageId.get(stage.id);
				if (!mapping || !requestMetadata) {
					throw new Error("Legacy row writer missing stable request evidence");
				}
				const currentRequest = currentRequestById.get(
					mapping.legacyApprovalRequestId,
				);
				const exactMetadata = currentRequest
					? sameJson(currentRequest.metadata, requestMetadata)
					: true;
				const representativeMetadataUpdate =
					currentRequest?.status === "pending" &&
					sameRequestMetadataExceptAssignment(
						currentRequest.metadata,
						requestMetadata,
					);
				if (
					currentRequest &&
					(currentRequest.requestedBy !== snapshot.requesterEmployeeId ||
						(!exactMetadata && !representativeMetadataUpdate))
				) {
					throw new Error(
						"Legacy row writer request immutable evidence mismatch",
					);
				}
			}

			for (const stage of orderedStages) {
				const mapping = mappings.get(stage.id);
				if (!mapping)
					throw new Error("Legacy row writer missing stable mapping");
				const assignment = selectCanonicalStageAssignment(stage);
				const currentRequest = currentRequestById.get(
					mapping.legacyApprovalRequestId,
				);
				const approverId =
					assignment?.approverEmployeeId ?? snapshot.requesterEmployeeId;
				const requestMetadata = requestMetadataByStageId.get(stage.id);
				if (!requestMetadata) {
					throw new Error("Legacy row writer missing request metadata");
				}
				const requestMetadataJson = canonicalJson(requestMetadata);
				if (stage.status === "waiting") {
					if (currentRequest) {
						throw new Error(
							"Legacy row writer found a request for a waiting stage",
						);
					}
					continue;
				}
				if (
					stage.status === "approved" &&
					stage.activationMode === "requester_auto_approve"
				) {
					if (currentRequest) {
						throw new Error(
							"Legacy row writer auto-approved stage has a legacy request",
						);
					}
					continue;
				}
				if (stage.status === "cancelled") {
					if (!currentRequest) {
						const durableCancelled =
							currentChainStageById.get(stage.id)?.status === "cancelled";
						const neverActivated =
							stage.activatedAt === null && stage.assignments.length === 0;
						if (!durableCancelled && !neverActivated) {
							throw new Error(
								"Legacy row writer missing active request for cancellation",
							);
						}
						continue;
					}
					if (currentRequest.status !== "pending") {
						throw new Error(
							"Legacy row writer cannot cancel a decided request",
						);
					}
					const deleted = exactlyOneLegacyRow(
						await dbService.db.execute(sql`
							delete from approval_request
							where id = ${mapping.legacyApprovalRequestId}
								and organization_id = ${input.organizationId}
								and entity_type = ${snapshot.sourceType}
								and entity_id = ${snapshot.sourceId}
								and requested_by = ${snapshot.requesterEmployeeId}
								and approver_id = ${currentRequest.approverId}
								and status = 'pending'
							returning id, organization_id, entity_type, entity_id
						`),
						mapping.legacyApprovalRequestId,
						"approval_request cancellation",
					);
					assertLegacyRequestEvidence(deleted, {
						organizationId: input.organizationId,
						sourceType: snapshot.sourceType,
						sourceId: snapshot.sourceId,
					});
					continue;
				}
				const requestStatus =
					stage.status === "approved"
						? "approved"
						: stage.status === "rejected"
							? "rejected"
							: "pending";
				const decisionAt = instantToDB(stage.decidedAt);
				const requestUpdatedAt =
					decisionAt ??
					instantToDB(assignment?.assignedAt ?? stage.activatedAt) ??
					instantToDB(snapshot.submittedAt);
				if (requestStatus !== "pending" && decisionAt === null) {
					throw new Error(
						"Legacy row writer decided request has no decision instant",
					);
				}
				if (requestStatus === "rejected" && !stage.decisionReason) {
					throw new Error("Legacy row writer rejected request has no reason");
				}
				if (
					currentRequest?.status === "pending" &&
					requestStatus === "pending" &&
					(currentRequest.approverId !== approverId ||
						!sameDate(currentRequest.updatedAt, requestUpdatedAt) ||
						!sameJson(currentRequest.metadata, requestMetadata))
				) {
					const reassigned = exactlyOneLegacyRow(
						await dbService.db.execute(sql`
							update approval_request set
								approver_id = ${approverId},
								metadata = ${requestMetadataJson}::jsonb,
								updated_at = ${requestUpdatedAt}
							where id = ${mapping.legacyApprovalRequestId}
								and organization_id = ${input.organizationId}
								and entity_type = ${snapshot.sourceType}
								and entity_id = ${snapshot.sourceId}
								and requested_by = ${snapshot.requesterEmployeeId}
								and approver_id = ${currentRequest.approverId}
								and status = 'pending'
								and updated_at = ${currentRequest.updatedAt}
							returning id, organization_id, entity_type, entity_id
						`),
						mapping.legacyApprovalRequestId,
						"approval_request reassignment",
					);
					assertLegacyRequestEvidence(reassigned, {
						organizationId: input.organizationId,
						sourceType: snapshot.sourceType,
						sourceId: snapshot.sourceId,
					});
					continue;
				}
				const resolvingPendingRepresentative =
					currentRequest?.status === "pending" && requestStatus !== "pending";
				if (
					currentRequest &&
					currentRequest.approverId !== approverId &&
					!resolvingPendingRepresentative
				) {
					throw new Error(
						"Legacy row writer request approver evidence mismatch",
					);
				}
				if (currentRequest?.status === requestStatus) {
					const exactReplay =
						currentRequest.reason === stage.decisionReason &&
						currentRequest.rejectionReason ===
							(requestStatus === "rejected" ? stage.decisionReason : null) &&
						sameDate(
							currentRequest.approvedAt,
							requestStatus === "approved" ? decisionAt : null,
						) &&
						sameDate(currentRequest.updatedAt, requestUpdatedAt);
					if (!exactReplay) {
						throw new Error(
							"Legacy row writer request replay evidence mismatch",
						);
					}
					continue;
				}
				if (currentRequest && currentRequest.status !== "pending") {
					throw new Error("Legacy row writer cannot regress a decided request");
				}
				if (!currentRequest && requestStatus !== "pending") {
					throw new Error(
						"Legacy row writer missing active request for decision",
					);
				}
				const written = exactlyOneLegacyRow(
					await dbService.db.execute(
						currentRequest
							? sql`
						update approval_request set
							approver_id = ${approverId},
							${sameJson(currentRequest.metadata, requestMetadata) ? sql`` : sql`metadata = ${requestMetadataJson}::jsonb,`}
							status = ${requestStatus},
							reason = ${stage.decisionReason},
							approved_at = ${requestStatus === "approved" ? decisionAt : null},
							rejection_reason = ${requestStatus === "rejected" ? stage.decisionReason : null},
							updated_at = ${requestUpdatedAt}
						where id = ${mapping.legacyApprovalRequestId}
							and organization_id = ${input.organizationId}
							and entity_type = ${snapshot.sourceType}
							and entity_id = ${snapshot.sourceId}
							and requested_by = ${snapshot.requesterEmployeeId}
							and approver_id = ${currentRequest.approverId}
							and status = 'pending'
						returning id, organization_id, entity_type, entity_id
					`
							: sql`
						insert into approval_request (
							id, organization_id, entity_type, entity_id, requested_by,
							approver_id, status, reason, metadata, approved_at,
							rejection_reason, created_at, updated_at
						) values (
							${mapping.legacyApprovalRequestId}, ${input.organizationId},
							${snapshot.sourceType}, ${snapshot.sourceId},
							${snapshot.requesterEmployeeId}, ${approverId}, ${requestStatus},
							${stage.decisionReason}, ${requestMetadataJson}::jsonb,
							${requestStatus === "approved" ? decisionAt : null},
							${requestStatus === "rejected" ? stage.decisionReason : null},
							${instantToDB(snapshot.submittedAt)}, ${requestUpdatedAt}
						)
						returning id, organization_id, entity_type, entity_id
					`,
					),
					mapping.legacyApprovalRequestId,
					"approval_request",
				);
				assertLegacyRequestEvidence(written, {
					organizationId: input.organizationId,
					sourceType: snapshot.sourceType,
					sourceId: snapshot.sourceId,
				});
			}

			if (orderedStages.length < 2) return;
			const policy = policyChainEvidence(input.result);
			const chainStatus =
				snapshot.status === "pending" ? "pending" : snapshot.status;
			if (chainStatus === "expired") {
				throw new Error("Legacy row writer cannot represent expired chains");
			}
			const currentStageOrder =
				snapshot.currentStageOrder ?? orderedStages.at(-1)?.sequence ?? 1;
			const chainCompletedAt =
				chainStatus === "pending"
					? null
					: (instantToDB(snapshot.cancelledAt ?? snapshot.completedAt) ??
						updatedAt);
			if (
				currentChain &&
				(currentChain.organizationId !== input.organizationId ||
					currentChain.policyId !== policy.policyId ||
					currentChain.policyName !== policy.policyName ||
					currentChain.entityType !== snapshot.sourceType ||
					currentChain.entityId !== snapshot.sourceId ||
					currentChain.requesterEmployeeId !== snapshot.requesterEmployeeId)
			) {
				throw new Error("Legacy row writer chain immutable evidence mismatch");
			}
			const pendingAdvancement =
				currentChain?.status === "pending" &&
				chainStatus === "pending" &&
				currentStageOrder > currentChain.currentStageOrder;
			if (currentChain?.status === chainStatus) {
				if (pendingAdvancement) {
					if (
						!sameDate(
							currentChain.createdAt,
							instantToDB(snapshot.submittedAt),
						) ||
						currentChain.completedAt !== null
					) {
						throw new Error(
							"Legacy row writer pending advancement evidence mismatch",
						);
					}
					exactlyOneLegacyRow(
						await dbService.db.execute(sql`
							update approval_chain_instance set
								current_stage_order = ${currentStageOrder},
								updated_at = ${updatedAt}
							where id = ${snapshot.id}
								and organization_id = ${input.organizationId}
								and policy_id = ${policy.policyId}
								and entity_type = ${snapshot.sourceType}
								and entity_id = ${snapshot.sourceId}
								and status = 'pending'
								and current_stage_order = ${currentChain.currentStageOrder}
								and updated_at = ${currentChain.updatedAt}
							returning id
						`),
						snapshot.id,
						"approval_chain_instance advancement",
					);
				} else if (
					currentChain.currentStageOrder !== currentStageOrder ||
					!sameDate(
						currentChain.createdAt,
						instantToDB(snapshot.submittedAt),
					) ||
					!sameDate(currentChain.updatedAt, updatedAt) ||
					!sameDate(currentChain.completedAt, chainCompletedAt)
				) {
					throw new Error("Legacy row writer chain replay evidence mismatch");
				}
			} else {
				if (!currentChain && chainStatus !== "pending") {
					throw new Error(
						"Legacy row writer missing active chain for decision",
					);
				}
				if (
					currentChain &&
					currentChain.status !== "pending" &&
					!(currentChain.status === "approved" && chainStatus === "cancelled")
				) {
					throw new Error("Legacy row writer cannot regress a decided chain");
				}
				exactlyOneLegacyRow(
					await dbService.db.execute(
						currentChain
							? sql`
					update approval_chain_instance set
						current_stage_order = ${currentStageOrder},
						status = ${chainStatus},
						updated_at = ${updatedAt},
						completed_at = ${chainCompletedAt}
					where id = ${snapshot.id}
						and organization_id = ${input.organizationId}
						and policy_id = ${policy.policyId}
						and entity_type = ${snapshot.sourceType}
						and entity_id = ${snapshot.sourceId}
						and status = ${currentChain.status}
					returning id
				`
							: sql`
					insert into approval_chain_instance (
						id, organization_id, policy_id, policy_name_snapshot,
						entity_type, entity_id, requester_employee_id,
						current_stage_order, status, created_at, updated_at, completed_at
					) values (
						${snapshot.id}, ${input.organizationId}, ${policy.policyId},
						${policy.policyName}, ${snapshot.sourceType}, ${snapshot.sourceId},
						${snapshot.requesterEmployeeId}, ${currentStageOrder}, ${chainStatus},
						${instantToDB(snapshot.submittedAt)}, ${updatedAt},
						${chainCompletedAt}
					)
					returning id
				`,
					),
					snapshot.id,
					"approval_chain_instance",
				);
			}

			for (const stage of orderedStages) {
				const mapping = mappings.get(stage.id);
				const policyStageId = policy.policyStageIds.get(stage.sequence);
				if (!mapping || !policyStageId) {
					throw new Error("Legacy row writer missing chain-stage identity");
				}
				const assignment = selectCanonicalStageAssignment(stage);
				const stageStatus = legacyStageStatus(stage.status);
				const approverId =
					assignment?.approverEmployeeId ?? snapshot.requesterEmployeeId;
				const approverType =
					typeof stage.resolverSnapshot.approverType === "string"
						? stage.resolverSnapshot.approverType
						: "canonical";
				const decisionAt = instantToDB(stage.decidedAt);
				const stageUpdatedAt =
					decisionAt ??
					instantToDB(assignment?.assignedAt ?? stage.activatedAt) ??
					instantToDB(snapshot.submittedAt);
				const decidedBy = stageDecisionActor(
					input.result,
					stage.id,
					assignment,
				);
				const approvalRequestId =
					stage.status === "waiting" ||
					stage.status === "cancelled" ||
					stage.activationMode === "requester_auto_approve"
						? null
						: mapping.legacyApprovalRequestId;
				const currentStage = currentChainStageById.get(stage.id);
				if (
					currentStage &&
					(currentStage.organizationId !== input.organizationId ||
						currentStage.chainInstanceId !== snapshot.id ||
						currentStage.policyStageId !== policyStageId ||
						currentStage.stepOrder !== stage.sequence ||
						currentStage.label !== stage.label ||
						currentStage.approverType !== approverType)
				) {
					throw new Error(
						"Legacy row writer chain-stage immutable evidence mismatch",
					);
				}
				const exactReplay =
					currentStage?.status === stageStatus &&
					currentStage.approverEmployeeId === approverId &&
					currentStage.approvalRequestId === approvalRequestId &&
					currentStage.decidedBy === decidedBy &&
					sameDate(currentStage.decidedAt, decisionAt) &&
					sameDate(currentStage.updatedAt, stageUpdatedAt);
				if (exactReplay) continue;
				if (!currentStage && snapshot.status !== "pending") {
					throw new Error(
						"Legacy row writer missing active chain stage for decision",
					);
				}
				if (currentStage?.status === "approved") {
					throw new Error(
						"Legacy row writer cannot regress an approved chain stage",
					);
				}
				if (currentStage && currentStage.status !== "pending") {
					throw new Error(
						"Legacy row writer cannot regress a decided chain stage",
					);
				}
				exactlyOneLegacyRow(
					await dbService.db.execute(
						currentStage
							? sql`
						update approval_chain_stage_instance set
							resolved_approver_employee_id = ${approverId},
							approval_request_id = ${approvalRequestId},
							status = ${stageStatus},
							decided_by = ${decidedBy},
							decided_at = ${decisionAt},
							updated_at = ${stageUpdatedAt}
						where id = ${stage.id}
							and organization_id = ${input.organizationId}
							and chain_instance_id = ${snapshot.id}
							and policy_stage_id = ${policyStageId}
							and step_order = ${stage.sequence}
							and resolved_approver_employee_id = ${currentStage.approverEmployeeId}
							and status = 'pending'
							and updated_at = ${currentStage.updatedAt}
						returning id
					`
							: sql`
						insert into approval_chain_stage_instance (
							id, organization_id, chain_instance_id, policy_stage_id,
							step_order, label_snapshot, approver_type_snapshot,
							resolved_approver_employee_id, approval_request_id, status,
							decided_by, decided_at, created_at, updated_at
						) values (
							${stage.id}, ${input.organizationId}, ${snapshot.id}, ${policyStageId},
							${stage.sequence}, ${stage.label}, ${approverType}, ${approverId},
							${approvalRequestId}, ${stageStatus}, ${decidedBy},
							${decisionAt}, ${instantToDB(snapshot.submittedAt)}, ${stageUpdatedAt}
						)
						returning id
					`,
					),
					stage.id,
					"approval_chain_stage_instance",
				);
			}
		},
	};
}

function resultRows(result: unknown): unknown[] {
	if (!result || typeof result !== "object" || !("rows" in result)) return [];
	return Array.isArray(result.rows) ? result.rows : [];
}

function parseStageRows(result: unknown): LegacyStageIdRow[] {
	return resultRows(result).map((row) => {
		if (
			!row ||
			typeof row !== "object" ||
			!("id" in row) ||
			!("organization_id" in row) ||
			!("workflow_id" in row) ||
			!("legacy_approval_request_id" in row) ||
			typeof row.id !== "string" ||
			typeof row.organization_id !== "string" ||
			typeof row.workflow_id !== "string" ||
			(row.legacy_approval_request_id !== null &&
				typeof row.legacy_approval_request_id !== "string")
		) {
			throw new Error("Stable ID stage query returned malformed rows");
		}
		return {
			id: row.id,
			organizationId: row.organization_id,
			workflowId: row.workflow_id,
			legacyApprovalRequestId: row.legacy_approval_request_id,
		};
	});
}

function validateLoadedStages(
	input: { organizationId: string; workflowId: string; stageIds: string[] },
	rows: LegacyStageIdRow[],
): void {
	const requested = new Set(input.stageIds);
	if (
		rows.length !== requested.size ||
		rows.some(
			(row) =>
				!requested.has(row.id) ||
				row.organizationId !== input.organizationId ||
				row.workflowId !== input.workflowId,
		)
	) {
		throw new Error(
			"Stable ID stage set contains a missing, foreign, or out-of-scope stage",
		);
	}
}

function validateUniqueLegacyIds(rows: LegacyStageIdRow[]): void {
	const ids = rows.flatMap((row) =>
		row.legacyApprovalRequestId ? [row.legacyApprovalRequestId] : [],
	);
	if (new Set(ids).size !== ids.length) {
		throw new Error("Stable ID stage set contains duplicate legacy IDs");
	}
}

async function loadStableIdRows(
	dbService: ApprovalDbService,
	input: { organizationId: string; workflowId: string; stageIds: string[] },
): Promise<LegacyStageIdRow[]> {
	const sortedStageIds = [...input.stageIds].sort();
	const stageValues = sql.join(
		sortedStageIds.map((stageId) => sql`${stageId}`),
		sql`, `,
	);
	const result = await dbService.db.execute(sql`
		select id, organization_id, workflow_id, legacy_approval_request_id
		from approval_workflow_stage
		where organization_id = ${input.organizationId}
			and workflow_id = ${input.workflowId}
			and id in (${stageValues})
		order by id
		for update
	`);
	const rows = parseStageRows(result);
	validateLoadedStages(input, rows);
	validateUniqueLegacyIds(rows);
	return rows;
}

function parseApprovalRequestIdRows(
	result: unknown,
): LegacyApprovalRequestIdRow[] {
	return resultRows(result).map((row) => {
		if (
			!row ||
			typeof row !== "object" ||
			!("id" in row) ||
			!("organization_id" in row) ||
			typeof row.id !== "string" ||
			typeof row.organization_id !== "string"
		) {
			throw new Error(
				"Stable ID approval-request query returned malformed rows",
			);
		}
		return { id: row.id, organizationId: row.organization_id };
	});
}

async function allocateMissingLegacyIds(
	dbService: ApprovalDbService,
	input: { organizationId: string; workflowId: string },
	missing: LegacyStageIdRow[],
): Promise<Map<string, string>> {
	const sortedMissing = [...missing].sort((left, right) =>
		left.id.localeCompare(right.id),
	);
	const candidatesByStage = new Map(
		sortedMissing.map((stage) => [
			stage.id,
			Array.from({ length: LEGACY_ID_CANDIDATE_LIMIT }, (_, attempt) =>
				deterministicLegacyApprovalRequestId(stage.id, attempt),
			),
		]),
	);
	const candidates = [
		...new Set([...candidatesByStage.values()].flat()),
	].sort();
	const candidateSet = new Set(candidates);
	const candidateValues = sql.join(
		candidates.map((candidate) => sql`${candidate}`),
		sql`, `,
	);

	// Deliberately organization-scoped: the global approval_request PK remains the
	// final atomic guard for a cross-organization collision at legacy insert time.
	const approvalRequests = parseApprovalRequestIdRows(
		await dbService.db.execute(sql`
			select id, organization_id
			from approval_request
			where organization_id = ${input.organizationId}
				and id in (${candidateValues})
			order by id
			for update
		`),
	);
	if (
		approvalRequests.some(
			(row) =>
				row.organizationId !== input.organizationId ||
				!candidateSet.has(row.id),
		)
	) {
		throw new Error(
			"Stable ID approval-request lock returned out-of-scope rows",
		);
	}

	const mappedRows = parseStageRows(
		await dbService.db.execute(sql`
			select id, organization_id, workflow_id, legacy_approval_request_id
			from approval_workflow_stage
			where organization_id = ${input.organizationId}
				and legacy_approval_request_id in (${candidateValues})
			order by legacy_approval_request_id, id
			for update
		`),
	);
	if (
		mappedRows.some(
			(row) =>
				row.organizationId !== input.organizationId ||
				row.legacyApprovalRequestId === null ||
				!candidateSet.has(row.legacyApprovalRequestId),
		)
	) {
		throw new Error(
			"Stable ID candidate mapping lock returned out-of-scope rows",
		);
	}

	const occupied = new Set([
		...approvalRequests.map((row) => row.id),
		...mappedRows.flatMap((row) =>
			row.legacyApprovalRequestId ? [row.legacyApprovalRequestId] : [],
		),
	]);
	const selected = new Map<string, string>();
	for (const stage of sortedMissing) {
		const candidate = candidatesByStage
			.get(stage.id)
			?.find((value) => !occupied.has(value));
		if (!candidate) {
			throw new Error(
				`Stable ID deterministic candidate set exhausted for stage ${stage.id}`,
			);
		}
		selected.set(stage.id, candidate);
		occupied.add(candidate);
	}
	return selected;
}

async function lockOrganizationLegacyIdMappings(
	dbService: ApprovalDbService,
	input: { organizationId: string; workflowId: string },
	resolved: LegacyStageIdRow[],
): Promise<void> {
	const expected = new Map(
		resolved.map((stage) => [stage.legacyApprovalRequestId, stage]),
	);
	if (expected.has(null) || expected.size !== resolved.length) {
		throw new Error(
			"Stable ID organization conflict check received invalid mappings",
		);
	}
	const sortedLegacyIds = resolved
		.map((stage) => stage.legacyApprovalRequestId)
		.filter((value): value is string => value !== null)
		.sort();
	const legacyIdValues = sql.join(
		sortedLegacyIds.map((legacyId) => sql`${legacyId}`),
		sql`, `,
	);
	const result = await dbService.db.execute(sql`
		select id, organization_id, workflow_id, legacy_approval_request_id
		from approval_workflow_stage
		where organization_id = ${input.organizationId}
			and legacy_approval_request_id in (${legacyIdValues})
		order by legacy_approval_request_id, id
		for update
	`);
	const rows = parseStageRows(result);
	if (
		rows.length !== resolved.length ||
		rows.some((row) => {
			if (row.legacyApprovalRequestId === null) return true;
			const expectedStage = expected.get(row.legacyApprovalRequestId);
			return (
				!expectedStage ||
				row.organizationId !== input.organizationId ||
				row.workflowId !== input.workflowId ||
				row.id !== expectedStage.id ||
				expectedStage.workflowId !== input.workflowId ||
				expectedStage.organizationId !== input.organizationId
			);
		})
	) {
		throw new Error(
			"Stable ID organization conflict check found a foreign or conflicting mapping",
		);
	}
	validateUniqueLegacyIds(rows);
}

export function createTransactionBoundLegacyApprovalPersistence(input: {
	dbService: ApprovalDbService;
	rowWriter: LegacyApprovalRowWriter;
}): LegacyApprovalPersistence {
	return {
		async resolveOrCreateStableIds(identity) {
			if (new Set(identity.stageIds).size !== identity.stageIds.length) {
				throw new Error(
					"Stable ID resolution received a duplicate stage request",
				);
			}
			if (identity.stageIds.length === 0) return [];

			const initial = await loadStableIdRows(input.dbService, identity);
			const missing = initial.filter(
				(stage) => stage.legacyApprovalRequestId === null,
			);
			const selectedIds =
				missing.length > 0
					? await allocateMissingLegacyIds(input.dbService, identity, missing)
					: new Map<string, string>();
			for (const stage of [...missing].sort((left, right) =>
				left.id.localeCompare(right.id),
			)) {
				const selectedId = selectedIds.get(stage.id);
				if (!selectedId) {
					throw new Error(
						"Stable ID allocation did not select every missing stage",
					);
				}
				await input.dbService.db.execute(sql`
					update approval_workflow_stage
					set legacy_approval_request_id = ${selectedId}, updated_at = now()
					where organization_id = ${identity.organizationId}
						and workflow_id = ${identity.workflowId}
						and id = ${stage.id}
						and legacy_approval_request_id is null
				`);
			}

			const resolved =
				missing.length > 0
					? await loadStableIdRows(input.dbService, identity)
					: initial;
			const initialById = new Map(initial.map((stage) => [stage.id, stage]));
			for (const stage of resolved) {
				const previous = initialById.get(stage.id)?.legacyApprovalRequestId;
				const expected = previous ?? selectedIds.get(stage.id);
				if (stage.legacyApprovalRequestId !== expected) {
					throw new Error("Stable ID reload mismatch after scoped persistence");
				}
			}
			validateUniqueLegacyIds(resolved);
			await lockOrganizationLegacyIdMappings(
				input.dbService,
				identity,
				resolved,
			);
			const byId = new Map(resolved.map((stage) => [stage.id, stage]));
			return identity.stageIds.map((stageId) => {
				const stage = byId.get(stageId);
				if (!stage?.legacyApprovalRequestId) {
					throw new Error("Stable ID persistence did not resolve every stage");
				}
				return {
					organizationId: identity.organizationId,
					workflowId: identity.workflowId,
					stageId,
					legacyApprovalRequestId: stage.legacyApprovalRequestId,
				};
			});
		},
		writeLegacyRows: (writeInput) =>
			input.rowWriter.writeLegacyRows(writeInput),
	};
}

function assertSameVerifiedScope(
	before: VerifiedLegacyApprovalState,
	after: VerifiedLegacyApprovalState,
): void {
	const beforeScope = [
		before.organizationId,
		before.source.organizationId,
		before.source.workflowType,
		before.source.sourceType,
		before.source.sourceId,
	];
	const afterScope = [
		after.organizationId,
		after.source.organizationId,
		after.source.workflowType,
		after.source.sourceType,
		after.source.sourceId,
	];
	if (beforeScope.some((value, index) => value !== afterScope[index])) {
		throw new Error(
			"Legacy before/after snapshots do not share a verified scope",
		);
	}
	for (const state of [before, after]) {
		if (state.organizationId !== state.source.organizationId) {
			throw new Error(
				"Legacy source organization does not match persistence scope",
			);
		}
		if (
			state.approvalRequest &&
			(state.approvalRequest.organizationId !== state.organizationId ||
				state.approvalRequest.entityType !== state.source.sourceType ||
				state.approvalRequest.entityId !== state.source.sourceId)
		) {
			throw new Error(
				"Legacy approval request does not match its verified scope",
			);
		}
		if (
			(state.chain !== null &&
				(state.chain.organizationId !== state.organizationId ||
					state.chain.entityType !== state.source.sourceType ||
					state.chain.entityId !== state.source.sourceId)) ||
			state.chainRows.some(
				(row) =>
					row.organizationId !== state.organizationId ||
					state.chain === null ||
					row.chainInstanceId !== state.chain.id,
			)
		) {
			throw new Error("Legacy chain row does not match its verified scope");
		}
	}
}

function assertResultScope(
	result: ApprovalCommandResult,
	after: VerifiedLegacyApprovalState,
): void {
	const workflowScopeMatches =
		result.snapshot.organizationId === after.organizationId &&
		result.snapshot.workflowType === after.source.workflowType &&
		result.snapshot.sourceType === after.source.sourceType &&
		result.snapshot.sourceId === after.source.sourceId &&
		result.projection.organizationId === after.organizationId &&
		result.projection.workflowId === result.snapshot.id &&
		result.projection.workflowType === after.source.workflowType &&
		result.projection.sourceType === after.source.sourceType &&
		result.projection.sourceId === after.source.sourceId &&
		result.projection.status === result.snapshot.status &&
		result.projection.currentStageOrder === result.snapshot.currentStageOrder;
	const childrenMatch =
		result.events.every(
			(event) =>
				event.organizationId === after.organizationId &&
				event.workflowId === result.snapshot.id &&
				event.version === result.snapshot.version,
		) &&
		result.outbox.every(
			(outbox) =>
				outbox.organizationId === after.organizationId &&
				outbox.workflowId === result.snapshot.id,
		);
	if (!workflowScopeMatches || !childrenMatch) {
		throw new Error("Observed transition result is outside the verified scope");
	}
}

function detachedCanonicalMirrorResult(input: {
	result: ApprovalCommandResult;
}): ApprovalCommandResult {
	const detachedInput = normalizeStableData(input) as typeof input;
	const result = detachedInput.result;
	try {
		if (
			typeof result.snapshot.organizationId !== "string" ||
			typeof result.snapshot.id !== "string" ||
			typeof result.snapshot.workflowType !== "string" ||
			typeof result.snapshot.sourceType !== "string" ||
			typeof result.snapshot.sourceId !== "string" ||
			typeof result.snapshot.status !== "string" ||
			!Number.isInteger(result.snapshot.version) ||
			!Array.isArray(result.snapshot.stages) ||
			result.snapshot.stages.some(
				(stage) =>
					typeof stage.id !== "string" ||
					typeof stage.organizationId !== "string" ||
					typeof stage.workflowId !== "string" ||
					!Number.isInteger(stage.sequence) ||
					!Array.isArray(stage.assignments),
			) ||
			!Array.isArray(result.events) ||
			!Array.isArray(result.outbox) ||
			result.projection.organizationId !== result.snapshot.organizationId ||
			result.projection.workflowId !== result.snapshot.id ||
			result.projection.workflowType !== result.snapshot.workflowType ||
			result.projection.sourceType !== result.snapshot.sourceType ||
			result.projection.sourceId !== result.snapshot.sourceId ||
			result.projection.status !== result.snapshot.status ||
			result.projection.currentStageOrder !==
				result.snapshot.currentStageOrder ||
			result.projection.requesterEmployeeId !==
				result.snapshot.requesterEmployeeId ||
			result.events.some(
				(event) =>
					event.organizationId !== result.snapshot.organizationId ||
					event.workflowId !== result.snapshot.id ||
					!Number.isInteger(event.version) ||
					event.version < 1 ||
					event.version > result.snapshot.version,
			) ||
			result.outbox.some(
				(outbox) =>
					outbox.organizationId !== result.snapshot.organizationId ||
					outbox.workflowId !== result.snapshot.id,
			)
		) {
			throw new Error();
		}
	} catch {
		throw new Error("Canonical compatibility result is invalid");
	}
	const correction = timeCorrectionCompatibilityPayload(result.snapshot);
	if (correction !== null) {
		return normalizeStableData({
			...result,
			snapshot: {
				...result.snapshot,
				contextSnapshot: {
					...result.snapshot.contextSnapshot,
					timeCorrection: correction,
				},
			},
		}) as ApprovalCommandResult;
	}
	const ordinaryPayload = ordinaryWorkPeriodCompatibilityPayload(
		result.snapshot,
	);
	if (ordinaryPayload === null) return result;
	return normalizeStableData({
		...result,
		snapshot: {
			...result.snapshot,
			contextSnapshot: ordinaryPayload,
		},
	}) as ApprovalCommandResult;
}

function assertObservedEventPersistence(
	result: ObservedLegacyTransitionResult,
): void {
	const eventIds = result.events.map((event) => event.id);
	const persistedIds = result.eventPersistence.eventIds;
	if (
		result.eventPersistence.kind !== "aggregate_and_events_persisted" ||
		eventIds.length !== new Set(eventIds).size ||
		eventIds.length !== persistedIds.length ||
		eventIds.some((eventId, index) => eventId !== persistedIds[index])
	) {
		throw new Error("Repository event persistence evidence is not exact-once");
	}
	for (const outbox of result.outbox) {
		if (
			!result.events.some(
				(event) =>
					event.id === outbox.eventId && event.eventType === outbox.eventType,
			)
		) {
			throw new Error(
				"Observed outbox intent does not match a persisted event",
			);
		}
	}
}

function assertStableMappings(
	result: ApprovalCommandResult,
	legacyIds: LegacyCanonicalIdMapping[],
): void {
	const stageIds = result.snapshot.stages.map((stage) => stage.id);
	const expectedStageIds = new Set(stageIds);
	if (expectedStageIds.size !== stageIds.length) {
		throw new Error(
			"Stable ID mapping cannot cover duplicate canonical stages",
		);
	}
	const keys = new Set<string>();
	const legacyIdValues = new Set<string>();
	for (const mapping of legacyIds) {
		if (
			mapping.organizationId !== result.snapshot.organizationId ||
			mapping.workflowId !== result.snapshot.id
		) {
			throw new Error(
				"Stable ID mapping is outside the canonical workflow scope",
			);
		}
		if (!expectedStageIds.has(mapping.stageId)) {
			throw new Error("Stable ID mapping contains an unknown canonical stage");
		}
		const key = mapping.stageId;
		if (keys.has(key))
			throw new Error("Stable ID mapping contains a duplicate canonical stage");
		keys.add(key);
		if (legacyIdValues.has(mapping.legacyApprovalRequestId)) {
			throw new Error("Stable ID mapping contains a duplicate legacy ID");
		}
		legacyIdValues.add(mapping.legacyApprovalRequestId);
	}
	if (keys.size !== expectedStageIds.size) {
		throw new Error("Stable ID mapping does not cover every canonical stage");
	}
}

export function createApprovalCompatibilityWriter(
	dependencies: CompatibilityWriterDependencies,
): ApprovalCompatibilityWriter {
	return {
		withWriteGate(writeGate) {
			return createApprovalCompatibilityWriter({
				...dependencies,
				writeGate,
			});
		},
		async mirrorLegacyToCanonical(input) {
			const normalizedInput = normalizeStableData(input) as typeof input;
			const observedInput = normalizeObservedLegacyTransition({
				organizationId: normalizedInput.after.organizationId,
				source: normalizedInput.after.source,
				before: normalizedInput.before,
				after: normalizedInput.after,
				actor: normalizedInput.actor,
				idempotencyKey: normalizedInput.idempotencyKey,
				expectedVersion: normalizedInput.expectedVersion,
			});
			const { behavior } = await dependencies.writeGate.acquire({
				organizationId: observedInput.organizationId,
				workflowType: observedInput.source.workflowType,
			});
			if (behavior.mirror !== "legacy_to_canonical") return null;
			assertSameVerifiedScope(observedInput.before, observedInput.after);
			const result =
				await dependencies.repository.applyObservedLegacyTransition(
					observedInput,
				);
			assertResultScope(result, observedInput.after);
			assertObservedEventPersistence(result);
			if (result.outbox.some((outbox) => outbox.disposition !== "observe")) {
				throw new Error(
					"Observed legacy transitions require observe-only outbox rows",
				);
			}
			await dependencies.projectionWriter.write(result.projection);
			for (const outbox of result.outbox) {
				await dependencies.outboxWriter.write(outbox);
			}
			return result;
		},

		async mirrorCanonicalToLegacy(input) {
			const result = detachedCanonicalMirrorResult(input);
			const { behavior } = await dependencies.writeGate.acquire({
				organizationId: result.snapshot.organizationId,
				workflowType: result.snapshot.workflowType,
			});
			if (behavior.mirror !== "canonical_to_legacy") return;
			const legacyIds =
				await dependencies.legacyPersistence.resolveOrCreateStableIds({
					organizationId: result.snapshot.organizationId,
					workflowId: result.snapshot.id,
					stageIds: result.snapshot.stages.map((stage) => stage.id),
				});
			assertStableMappings(result, legacyIds);
			await dependencies.legacyPersistence.writeLegacyRows({
				organizationId: result.snapshot.organizationId,
				result,
				legacyIds,
			});
		},
	};
}
