import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import {
	type ApprovalEscalationAttentionAttempt,
	type ApprovalEscalationAttentionEventType,
	type ApprovalEscalationAttentionReason,
	type ApprovalEscalationAttentionStatus,
	type ApprovalEscalationChannel,
	type ApprovalEscalationPolicyProvenance,
	approvalEscalationAttention,
	approvalEscalationAttentionEvent,
	approvalEscalationControl,
	approvalEscalationPolicyRevision,
	employee,
} from "@/db/schema";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { escalationAttentionApprovalHref } from "./attention";
import {
	describeChannelDeliveryPreferences,
	type EscalationChannelDeliveryPreference,
} from "./policy";
import {
	loadEscalationPolicySources,
	prepareEscalationPolicy,
} from "./policy-store";

const OPEN_ATTENTION_LIMIT = 100;
const CLOSED_ATTENTION_LIMIT = 20;
const REVISION_LIMIT = 20;

export interface EscalationAttentionEventView {
	eventType: ApprovalEscalationAttentionEventType;
	actorKind: "system" | "user";
	actorName: string | null;
	detail: Record<string, unknown>;
	createdAt: string;
}

export interface EscalationAttentionView {
	id: string;
	reason: ApprovalEscalationAttentionReason;
	status: ApprovalEscalationAttentionStatus;
	approvalType: string | null;
	approvalRequestId: string | null;
	workflowId: string | null;
	assignmentId: string | null;
	deliveryChannel: ApprovalEscalationChannel | null;
	currentApprover: { employeeId: string; name: string } | null;
	evidence: Record<string, unknown>;
	attempts: ApprovalEscalationAttentionAttempt[];
	policyRevision: number | null;
	observationCount: number;
	firstRaisedAt: string;
	lastObservedAt: string;
	adminAlertedAt: string | null;
	closedAt: string | null;
	closureNote: string | null;
	disposedByName: string | null;
	approvalHref: string;
	events: EscalationAttentionEventView[];
}

export interface EscalationPolicyRevisionView {
	revision: number;
	enabled: boolean;
	responseWindowHours: number;
	origin: "migration" | "management_edit";
	changedByName: string | null;
	reason: string | null;
	createdAt: string;
}

export interface EscalationManagementOverview {
	control: { owner: "legacy" | "escalation"; automationPaused: boolean };
	policy: {
		enabled: boolean;
		responseWindowHours: number;
		revision: number;
		migratedAt: string;
		provenance: ApprovalEscalationPolicyProvenance;
		conflictReviewStatus: "none" | "pending" | "reviewed";
		conflictReviewedAt: string | null;
		conflictReviewedByName: string | null;
		updatedAt: string;
	};
	revisions: EscalationPolicyRevisionView[];
	channels: EscalationChannelDeliveryPreference[];
	openAttention: EscalationAttentionView[];
	closedAttention: EscalationAttentionView[];
}

const toIso = (value: Date) => value.toISOString();
const toIsoOrNull = (value: Date | null) =>
	value ? value.toISOString() : null;

/**
 * Everything an approval manager needs to review the organization escalation
 * policy and its unresolved attention. Callers must authorize management for
 * `organizationId` first; every read here is scoped to it.
 */
export async function getEscalationManagementOverview(
	organizationId: string,
): Promise<EscalationManagementOverview> {
	if (!organizationId)
		throw new Error("Escalation overview requires organization scope");

	const policy = await prepareEscalationPolicy(organizationId);
	const attentionColumns = {
		id: approvalEscalationAttention.id,
		reason: approvalEscalationAttention.reason,
		status: approvalEscalationAttention.status,
		approvalType: approvalEscalationAttention.approvalType,
		approvalRequestId: approvalEscalationAttention.approvalRequestId,
		workflowId: approvalEscalationAttention.workflowId,
		assignmentId: approvalEscalationAttention.assignmentId,
		deliveryChannel: approvalEscalationAttention.deliveryChannel,
		currentApproverEmployeeId:
			approvalEscalationAttention.currentApproverEmployeeId,
		evidence: approvalEscalationAttention.evidence,
		attempts: approvalEscalationAttention.attempts,
		policyRevision: approvalEscalationAttention.policyRevision,
		observationCount: approvalEscalationAttention.observationCount,
		firstRaisedAt: approvalEscalationAttention.firstRaisedAt,
		lastObservedAt: approvalEscalationAttention.lastObservedAt,
		adminAlertedAt: approvalEscalationAttention.adminAlertedAt,
		closedAt: approvalEscalationAttention.closedAt,
		closureNote: approvalEscalationAttention.closureNote,
		disposedByUserId: approvalEscalationAttention.disposedByUserId,
	};

	const [control, sources, revisions, openRows, closedRows] = await Promise.all(
		[
			db.query.approvalEscalationControl.findFirst({
				where: eq(approvalEscalationControl.organizationId, organizationId),
				columns: { owner: true, automationPaused: true },
			}),
			loadEscalationPolicySources(db, organizationId),
			db
				.select({
					revision: approvalEscalationPolicyRevision.revision,
					enabled: approvalEscalationPolicyRevision.enabled,
					responseWindowHours:
						approvalEscalationPolicyRevision.responseWindowHours,
					origin: approvalEscalationPolicyRevision.origin,
					changedByUserId: approvalEscalationPolicyRevision.changedByUserId,
					reason: approvalEscalationPolicyRevision.reason,
					createdAt: approvalEscalationPolicyRevision.createdAt,
				})
				.from(approvalEscalationPolicyRevision)
				.where(
					eq(approvalEscalationPolicyRevision.organizationId, organizationId),
				)
				.orderBy(desc(approvalEscalationPolicyRevision.revision))
				.limit(REVISION_LIMIT),
			db
				.select(attentionColumns)
				.from(approvalEscalationAttention)
				.where(
					and(
						eq(approvalEscalationAttention.organizationId, organizationId),
						eq(approvalEscalationAttention.status, "open"),
					),
				)
				.orderBy(desc(approvalEscalationAttention.lastObservedAt))
				.limit(OPEN_ATTENTION_LIMIT),
			db
				.select(attentionColumns)
				.from(approvalEscalationAttention)
				.where(
					and(
						eq(approvalEscalationAttention.organizationId, organizationId),
						ne(approvalEscalationAttention.status, "open"),
					),
				)
				.orderBy(desc(approvalEscalationAttention.closedAt))
				.limit(CLOSED_ATTENTION_LIMIT),
		],
	);

	const attentionRows = [...openRows, ...closedRows];
	const attentionIds = attentionRows.map((row) => row.id);
	const approverIds = [
		...new Set(
			attentionRows
				.map((row) => row.currentApproverEmployeeId)
				.filter((id): id is string => id !== null),
		),
	];

	const [events, approvers] = await Promise.all([
		attentionIds.length
			? db
					.select({
						attentionId: approvalEscalationAttentionEvent.attentionId,
						eventType: approvalEscalationAttentionEvent.eventType,
						actorKind: approvalEscalationAttentionEvent.actorKind,
						actorUserId: approvalEscalationAttentionEvent.actorUserId,
						detail: approvalEscalationAttentionEvent.detail,
						createdAt: approvalEscalationAttentionEvent.createdAt,
					})
					.from(approvalEscalationAttentionEvent)
					.where(
						and(
							eq(
								approvalEscalationAttentionEvent.organizationId,
								organizationId,
							),
							inArray(
								approvalEscalationAttentionEvent.attentionId,
								attentionIds,
							),
						),
					)
					.orderBy(approvalEscalationAttentionEvent.createdAt)
			: [],
		approverIds.length
			? db
					.select({
						id: employee.id,
						firstName: user.firstName,
						lastName: user.lastName,
						name: user.name,
					})
					.from(employee)
					.leftJoin(user, eq(user.id, employee.userId))
					.where(
						and(
							eq(employee.organizationId, organizationId),
							inArray(employee.id, approverIds),
						),
					)
			: [],
	]);

	const userIds = [
		...new Set(
			[
				policy.conflictReviewedByUserId,
				...revisions.map((row) => row.changedByUserId),
				...attentionRows.map((row) => row.disposedByUserId),
				...events.map((row) => row.actorUserId),
			].filter((id): id is string => id !== null),
		),
	];
	const users = userIds.length
		? await db
				.select({ id: user.id, name: user.name })
				.from(user)
				.where(inArray(user.id, userIds))
		: [];
	const userName = new Map(users.map((row) => [row.id, row.name]));
	const nameOf = (id: string | null) =>
		id ? (userName.get(id) ?? null) : null;
	const approverName = new Map(
		approvers.map((row) => [
			row.id,
			buildAuthUserDisplayName(row) || row.id,
		]),
	);
	const eventsByAttention = new Map<string, EscalationAttentionEventView[]>();
	for (const event of events) {
		const list = eventsByAttention.get(event.attentionId) ?? [];
		list.push({
			eventType: event.eventType,
			actorKind: event.actorKind,
			actorName: nameOf(event.actorUserId),
			detail: event.detail,
			createdAt: toIso(event.createdAt),
		});
		eventsByAttention.set(event.attentionId, list);
	}

	const toView = (
		row: (typeof attentionRows)[number],
	): EscalationAttentionView => ({
		id: row.id,
		reason: row.reason,
		status: row.status,
		approvalType: row.approvalType,
		approvalRequestId: row.approvalRequestId,
		workflowId: row.workflowId,
		assignmentId: row.assignmentId,
		deliveryChannel: row.deliveryChannel,
		currentApprover: row.currentApproverEmployeeId
			? {
					employeeId: row.currentApproverEmployeeId,
					name:
						approverName.get(row.currentApproverEmployeeId) ??
						row.currentApproverEmployeeId,
				}
			: null,
		evidence: row.evidence,
		attempts: row.attempts,
		policyRevision: row.policyRevision,
		observationCount: row.observationCount,
		firstRaisedAt: toIso(row.firstRaisedAt),
		lastObservedAt: toIso(row.lastObservedAt),
		adminAlertedAt: toIsoOrNull(row.adminAlertedAt),
		closedAt: toIsoOrNull(row.closedAt),
		closureNote: row.closureNote,
		disposedByName: nameOf(row.disposedByUserId),
		approvalHref: escalationAttentionApprovalHref(row.approvalType),
		events: eventsByAttention.get(row.id) ?? [],
	});

	return {
		control: {
			owner: control?.owner ?? "legacy",
			automationPaused: control?.automationPaused ?? false,
		},
		policy: {
			enabled: policy.enabled,
			responseWindowHours: policy.responseWindowHours,
			revision: policy.revision,
			migratedAt: toIso(policy.migratedAt),
			provenance: policy.migrationProvenance,
			conflictReviewStatus: policy.conflictReviewStatus,
			conflictReviewedAt: toIsoOrNull(policy.conflictReviewedAt),
			conflictReviewedByName: nameOf(policy.conflictReviewedByUserId),
			updatedAt: toIso(policy.updatedAt),
		},
		revisions: revisions.map((row) => ({
			revision: row.revision,
			enabled: row.enabled,
			responseWindowHours: row.responseWindowHours,
			origin: row.origin,
			changedByName: nameOf(row.changedByUserId),
			reason: row.reason,
			createdAt: toIso(row.createdAt),
		})),
		channels: describeChannelDeliveryPreferences(sources, policy),
		openAttention: openRows.map(toView),
		closedAttention: closedRows.map(toView),
	};
}
