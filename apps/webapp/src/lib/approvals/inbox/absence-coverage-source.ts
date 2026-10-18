import { and, eq, gte, inArray, lt, lte } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	approvalChainStageInstance,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	coverageRule,
	employee,
	shift,
} from "@/db/schema";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import {
	shiftCalendarDate,
	shiftDateRangeBounds,
} from "@/lib/scheduling/shift-date";
import { readApprovalAuthoritySnapshot } from "../authority";
import {
	loadCurrentAbsenceSubmittedRevision,
	loadLegacyAbsenceSubmittedRevision,
} from "../evidence/store";
import type { ApprovalDatabase } from "../server/types";
import type { AbsenceCoverageSnapshot } from "./absence-coverage-evidence";
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
	const timezone = snapshot.timezone;
	const bounds = shiftDateRangeBounds(
		parsePlainDate(range.startDate).subtract({ days: 1 }),
		parsePlainDate(range.endDate).add({ days: 1 }),
		snapshot.timezone,
	);
	const ownShifts = await database.query.shift.findMany({
		where: and(
			eq(shift.organizationId, organizationId),
			eq(shift.employeeId, live.employeeId),
			eq(shift.status, "published"),
			gte(shift.date, bounds.start),
			lt(shift.date, bounds.endExclusive),
		),
	});
	const subareas = [...new Set(ownShifts.map((row) => row.subareaId))];
	if (!subareas.length) return snapshot;
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
	snapshot.shifts = published.map((row) => ({
		...row,
		date: shiftCalendarDate(row.date, timezone).toString(),
	}));
	snapshot.rules = rules.map((rule) => ({
		...rule,
		subareaName: rule.subarea.name,
	}));
	const employeeIds = [
		...new Set(
			published.flatMap((row) => (row.employeeId ? [row.employeeId] : [])),
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
					lte(absenceEntry.startDate, range.endDate),
					gte(absenceEntry.endDate, range.startDate),
				),
			);
	return snapshot;
}
