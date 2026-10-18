import { and, eq } from "drizzle-orm";
import {
	absenceEntry,
	approvalChainStageInstance,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
} from "@/db/schema";
import { readApprovalAuthoritySnapshot } from "../authority";
import {
	loadCurrentAbsenceSubmittedRevision,
	loadLegacyAbsenceSubmittedRevision,
} from "../evidence/store";
import type { ApprovalDatabase } from "../server/types";
import type { AbsenceCoverageSnapshot } from "./absence-coverage-evidence";
import { readOrganizationStaffingEvidence } from "./staffing-evidence-source";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

/** Reads source identity and staffing afresh; never accepts a previously computed assessment. */
export async function readAbsenceCoverageSnapshot(
	target: ApprovalInboxTriageTarget,
	suppliedDatabase?: ApprovalDatabase,
): Promise<AbsenceCoverageSnapshot | null> {
	const database = suppliedDatabase ?? (await import("@/db")).db;
	const organizationId = target.context.organizationId;
	const absenceId = target.context.entityId;
	if (target.requestKind !== "absence" || !target.authority) return null;
	const rollout = await readApprovalAuthoritySnapshot(database, {
		organizationId,
		workflowType: "absence",
	});
	if (
		rollout.authority !==
		(target.authority === "canonical_assignment" ? "canonical" : "legacy")
	)
		return null;
	let workflowId: string | null = null;
	if (target.authority === "canonical_assignment") {
		const rows = await database
			.select({ workflowId: approvalWorkflow.id })
			.from(approvalStageAssignment)
			.innerJoin(
				approvalWorkflowStage,
				and(
					eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
					eq(approvalWorkflowStage.organizationId, organizationId),
				),
			)
			.innerJoin(
				approvalWorkflow,
				and(
					eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
					eq(approvalWorkflow.organizationId, organizationId),
					eq(approvalWorkflowStage.workflowId, approvalWorkflow.id),
					eq(
						approvalWorkflowStage.sequence,
						approvalWorkflow.currentStageOrder,
					),
				),
			)
			.where(
				and(
					eq(approvalStageAssignment.id, target.context.requestId),
					eq(approvalStageAssignment.organizationId, organizationId),
					eq(approvalStageAssignment.status, "pending"),
					eq(approvalWorkflowStage.status, "pending"),
					eq(approvalWorkflow.status, "pending"),
					eq(approvalWorkflow.workflowType, "absence"),
					eq(approvalWorkflow.sourceType, "absence_entry"),
					eq(approvalWorkflow.sourceId, absenceId),
				),
			)
			.limit(2);
		if (rows.length !== 1 || !rows[0]) return null;
		workflowId = rows[0].workflowId;
	} else {
		const request = await database.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.id, target.context.requestId),
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.entityType, "absence_entry"),
				eq(approvalRequest.entityId, absenceId),
				eq(approvalRequest.status, "pending"),
			),
		});
		if (!request) return null;
	}
	const live = await database.query.absenceEntry.findFirst({
		where: and(
			eq(absenceEntry.id, absenceId),
			eq(absenceEntry.organizationId, organizationId),
			eq(absenceEntry.status, "pending"),
		),
		with: { category: true },
	});
	if (
		!live ||
		live.category.organizationId !== organizationId ||
		(workflowId && live.approvalWorkflowId !== workflowId)
	)
		return null;
	const subject = await database.query.employee.findFirst({
		where: and(
			eq(employee.id, live.employeeId),
			eq(employee.organizationId, organizationId),
		),
		columns: { id: true },
	});
	if (!subject) return null;
	const organization = await database.query.organization.findFirst({
		where: (table, { eq }) => eq(table.id, organizationId),
		columns: { timezone: true },
	});
	const revision = workflowId
		? await loadCurrentAbsenceSubmittedRevision(database, {
				organizationId,
				workflowId,
			})
		: await loadLegacyAbsenceSubmittedRevision(database, {
				organizationId,
				absenceId,
			});
	let matchesRevision = !!revision;
	if (revision && "legacy" in revision) {
		if (revision.legacy.chainInstanceId) {
			const stages = await database
				.select({ chainInstanceId: approvalChainStageInstance.chainInstanceId })
				.from(approvalChainStageInstance)
				.where(
					and(
						eq(approvalChainStageInstance.organizationId, organizationId),
						eq(
							approvalChainStageInstance.approvalRequestId,
							target.context.requestId,
						),
					),
				)
				.limit(2);
			matchesRevision =
				stages.length === 1 &&
				stages[0]?.chainInstanceId === revision.legacy.chainInstanceId;
		} else
			matchesRevision =
				revision.legacy.approvalRequestId === target.context.requestId;
	}
	const snapshot: AbsenceCoverageSnapshot = {
		organizationId,
		requestId: target.context.requestId,
		authority: target.authority,
		currentAuthority: rollout.authority,
		status: live.status,
		timezone: organization?.timezone ?? null,
		live: {
			organizationId,
			absenceId: live.id,
			employeeId: live.employeeId,
			categoryId: live.categoryId,
			categoryName: live.category.name,
			startDate: live.startDate,
			endDate: live.endDate,
			startPeriod: live.startPeriod,
			endPeriod: live.endPeriod,
		},
		requiresWorkTime: live.category.requiresWorkTime,
		revision:
			revision && matchesRevision
				? {
						id: revision.id,
						materialFingerprint: revision.materialFingerprint,
						requestId: target.context.requestId,
						facts: revision.facts,
					}
				: null,
		shifts: [],
		rules: [],
		absences: [],
	};
	if (
		!snapshot.revision ||
		!snapshot.timezone ||
		snapshot.revision.facts.coverage.kind !== "full_day"
	)
		return snapshot;
	const range = snapshot.revision.facts.coverage;
	Object.assign(
		snapshot,
		await readOrganizationStaffingEvidence(database, {
			organizationId,
			employeeId: live.employeeId,
			startDate: range.startDate,
			endDate: range.endDate,
			timezone: snapshot.timezone,
		}),
	);
	return snapshot;
}
