import { createHash } from "node:crypto";
import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import {
	absenceCategory,
	absenceChangeRequest,
	absenceEntry,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	auditLog,
	coverageRule,
	employee,
	location,
	locationSubarea,
	shift,
	timeRecord,
} from "@/db/schema";
import { originalAbsence } from "@/lib/absences/change-request-records";
import { instantFromDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	shiftCalendarDate,
	shiftDateRangeBounds,
} from "@/lib/scheduling/shift-date";
import { readApprovalAuthoritySnapshot } from "../authority";
import { canonicalJson } from "../evidence/absence-facts";
import type { ApprovalDatabase } from "../server/types";
import type { AbsenceChangeCoverageSnapshot } from "./absence-change-coverage-evidence";
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
	const timezone = snapshot.timezone;
	const bounds = shiftDateRangeBounds(
		parsePlainDate(startDate).subtract({ days: 1 }),
		parsePlainDate(endDate).add({ days: 1 }),
		timezone,
	);
	const ownShifts = await database.query.shift.findMany({
		where: and(
			eq(shift.organizationId, organizationId),
			eq(shift.employeeId, row.employeeId),
			eq(shift.status, "published"),
			gte(shift.date, bounds.start),
			lt(shift.date, bounds.endExclusive),
		),
	});
	const subareas = [...new Set(ownShifts.map((own) => own.subareaId))];
	if (!subareas.length) return snapshot;
	const allowedAreas = await database
		.select({ id: locationSubarea.id })
		.from(locationSubarea)
		.innerJoin(
			location,
			and(
				eq(location.id, locationSubarea.locationId),
				eq(location.organizationId, organizationId),
			),
		)
		.where(inArray(locationSubarea.id, subareas));
	if (allowedAreas.length !== subareas.length) return snapshot;
	const [rules, published] = await Promise.all([
		database.query.coverageRule.findMany({
			with: { subarea: true },
			where: and(
				eq(coverageRule.organizationId, organizationId),
				inArray(coverageRule.subareaId, subareas),
			),
		}),
		database
			.select({
				id: shift.id,
				organizationId: shift.organizationId,
				employeeId: shift.employeeId,
				subareaId: shift.subareaId,
				date: shift.date,
				startTime: shift.startTime,
				endTime: shift.endTime,
			})
			.from(shift)
			.innerJoin(
				employee,
				and(
					eq(employee.id, shift.employeeId),
					eq(employee.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(shift.organizationId, organizationId),
					eq(shift.status, "published"),
					inArray(shift.subareaId, subareas),
					gte(shift.date, bounds.start),
					lt(shift.date, bounds.endExclusive),
				),
			),
	]);
	snapshot.shifts = published.map((own) => ({
		...own,
		date: shiftCalendarDate(own.date, timezone).toString(),
	}));
	snapshot.rules = rules.map((rule) => ({
		...rule,
		subareaName: rule.subarea.name,
	}));
	const employeeIds = [
		...new Set(
			published.flatMap((own) => (own.employeeId ? [own.employeeId] : [])),
		),
	];
	if (employeeIds.length)
		snapshot.absences = await database
			.select({
				id: absenceEntry.id,
				organizationId: absenceCategory.organizationId,
				employeeId: absenceEntry.employeeId,
				status: absenceEntry.status,
				startDate: absenceEntry.startDate,
				endDate: absenceEntry.endDate,
				startPeriod: absenceEntry.startPeriod,
				endPeriod: absenceEntry.endPeriod,
				requiresWorkTime: absenceCategory.requiresWorkTime,
			})
			.from(absenceEntry)
			.innerJoin(
				absenceCategory,
				and(
					eq(absenceCategory.id, absenceEntry.categoryId),
					eq(absenceCategory.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(absenceEntry.organizationId, organizationId),
					inArray(absenceEntry.employeeId, employeeIds),
					lte(absenceEntry.startDate, endDate),
					gte(absenceEntry.endDate, startDate),
				),
			);
	return snapshot;
}
