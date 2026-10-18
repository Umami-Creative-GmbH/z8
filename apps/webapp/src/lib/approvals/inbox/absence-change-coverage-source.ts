import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
	absenceChangeRequest,
	absenceEntry,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	auditLog,
	employee,
	timeRecord,
} from "@/db/schema";
import { originalAbsence } from "@/lib/absences/change-request-records";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { readApprovalAuthoritySnapshot } from "../authority";
import { canonicalJson } from "../evidence/absence-facts";
import type { ApprovalDatabase } from "../server/types";
import type { AbsenceChangeCoverageSnapshot } from "./absence-change-coverage-evidence";
import { readOrganizationStaffingEvidence } from "./staffing-evidence-source";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";
/** Re-reads canonical identity, captured submission and the effective absence within one organization. */
export async function readAbsenceChangeCoverageSnapshot(
	target: ApprovalInboxTriageTarget,
	suppliedDatabase?: ApprovalDatabase,
): Promise<AbsenceChangeCoverageSnapshot | null> {
	if (
		target.requestKind !== "absence_change" ||
		target.authority !== "canonical_assignment" ||
		target.status !== "pending"
	)
		return null;
	const database = suppliedDatabase ?? (await import("@/db")).db;
	const organizationId = target.context.organizationId;
	const currentAuthority = (
		await readApprovalAuthoritySnapshot(database, {
			organizationId,
			workflowType: "absence_change",
		})
	).authority;
	if (currentAuthority !== "canonical") return null;
	const matches = await database
		.select({ change: absenceChangeRequest })
		.from(approvalStageAssignment)
		.innerJoin(
			approvalWorkflowStage,
			and(
				eq(approvalWorkflowStage.id, approvalStageAssignment.stageId),
				eq(approvalWorkflowStage.organizationId, organizationId),
				eq(
					approvalWorkflowStage.workflowId,
					approvalStageAssignment.workflowId,
				),
			),
		)
		.innerJoin(
			approvalWorkflow,
			and(
				eq(approvalWorkflow.id, approvalStageAssignment.workflowId),
				eq(approvalWorkflow.organizationId, organizationId),
				eq(approvalWorkflow.currentStageOrder, approvalWorkflowStage.sequence),
			),
		)
		.innerJoin(
			absenceChangeRequest,
			and(
				eq(absenceChangeRequest.id, approvalWorkflow.sourceId),
				eq(absenceChangeRequest.organizationId, organizationId),
				eq(absenceChangeRequest.approvalWorkflowId, approvalWorkflow.id),
				eq(
					absenceChangeRequest.employeeId,
					approvalWorkflow.requesterEmployeeId,
				),
			),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, absenceChangeRequest.employeeId),
				eq(employee.organizationId, organizationId),
			),
		)
		.where(
			and(
				eq(approvalStageAssignment.organizationId, organizationId),
				eq(approvalStageAssignment.id, target.context.requestId),
				eq(approvalStageAssignment.status, "pending"),
				eq(approvalWorkflowStage.status, "pending"),
				eq(approvalWorkflow.status, "pending"),
				eq(approvalWorkflow.workflowType, "absence_change"),
				eq(approvalWorkflow.sourceType, "absence_change_request"),
				eq(absenceChangeRequest.id, target.context.entityId),
				eq(absenceChangeRequest.status, "pending"),
			),
		)
		.limit(2);
	const row = matches.length === 1 ? matches[0]?.change : null;
	if (
		!row ||
		(target.requesterEmployeeId &&
			target.requesterEmployeeId !== row.employeeId)
	)
		return null;
	const [live, organization, submitted] = await Promise.all([
		database.query.absenceEntry.findFirst({
			where: and(
				eq(absenceEntry.id, row.absenceId),
				eq(absenceEntry.organizationId, organizationId),
				eq(absenceEntry.employeeId, row.employeeId),
			),
			with: { category: true },
		}),
		database.query.organization.findFirst({
			where: (table, { eq }) => eq(table.id, organizationId),
			columns: { timezone: true },
		}),
		database.query.auditLog.findMany({
			where: and(
				eq(auditLog.organizationId, organizationId),
				eq(auditLog.entityType, "absence_change_request"),
				eq(auditLog.entityId, row.id),
				eq(auditLog.action, "absence_change.submitted"),
				eq(auditLog.employeeId, row.employeeId),
				eq(auditLog.performedBy, row.submittedBy),
			),
			limit: 2,
		}),
	]);
	const audit = submitted.length === 1 ? submitted[0] : null;
	let submittedRevision: string | null = null;
	let submittedMatchesCurrent = false;
	if (audit?.changes) {
		try {
			const captured = JSON.parse(audit.changes) as unknown;
			submittedRevision = `absence_change:v1:${audit.id}:${createHash("sha256").update(canonicalJson(captured)).digest("hex")}`;
			submittedMatchesCurrent =
				canonicalJson(captured) ===
				canonicalJson({
					original: row.original,
					proposed: row.proposed,
					kind: row.kind,
					reason: row.reason,
				});
		} catch {
			/* Missing or malformed submitted evidence cannot certify current facts. */
		}
	}
	let liveOriginal: AbsenceChangeCoverageSnapshot["liveOriginal"] = null;
	if (
		live?.status === "approved" &&
		live.category.organizationId === organizationId &&
		live.category.isActive
	) {
		const record = live.canonicalRecordId
			? await database.query.timeRecord.findFirst({
					where: and(
						eq(timeRecord.id, live.canonicalRecordId),
						eq(timeRecord.organizationId, organizationId),
						eq(timeRecord.employeeId, row.employeeId),
						eq(timeRecord.recordKind, "absence"),
						eq(timeRecord.approvalState, "approved"),
					),
				})
			: null;
		if (!live.canonicalRecordId || record?.endAt)
			liveOriginal = originalAbsence(
				live,
				record?.endAt
					? {
							startAt: instantFromDate(record.startAt).toString(),
							endAt: instantFromDate(record.endAt).toString(),
						}
					: null,
			);
	}
	const snapshot: AbsenceChangeCoverageSnapshot = {
		organizationId,
		requestId: target.context.requestId,
		changeId: row.id,
		absenceId: row.absenceId,
		employeeId: row.employeeId,
		kind: row.kind,
		status: row.status,
		currentAuthority,
		original: row.original,
		proposed: row.proposed,
		submittedRevision,
		submittedMatchesCurrent,
		liveOriginal,
		timezone: organization?.timezone ?? null,
		requiresWorkTime: live?.category.requiresWorkTime ?? true,
		shifts: [],
		rules: [],
		absences: [],
	};
	if (
		!liveOriginal ||
		!snapshot.timezone ||
		!submittedMatchesCurrent ||
		snapshot.requiresWorkTime
	)
		return snapshot;
	const ranges = [row.original, ...(row.proposed ? [row.proposed] : [])];
	const startDate = ranges.map((range) => range.startDate).sort()[0];
	const endDate = ranges
		.map((range) => range.endDate)
		.sort()
		.at(-1);
	if (!startDate || !endDate) return snapshot;
	Object.assign(
		snapshot,
		await readOrganizationStaffingEvidence(database, {
			organizationId,
			employeeId: row.employeeId,
			startDate,
			endDate,
			timezone: snapshot.timezone,
		}),
	);
	return snapshot;
}
