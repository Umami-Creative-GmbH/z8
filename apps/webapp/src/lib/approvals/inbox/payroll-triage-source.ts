import "server-only";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import {
	absenceEntry,
	approvalChainStageInstance,
	approvalRequest,
	approvalStageAssignment,
	approvalWorkflow,
	approvalWorkflowStage,
	employee,
	timeRecord,
	userSettings,
	workPeriod,
} from "@/db/schema";
import { getAuthContext } from "@/lib/auth-helpers";
import {
	instantFromDate,
	instantToCanonicalString,
	parseInstant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { resolvePayrollAccessibleEmployeeIds } from "@/lib/payroll-access/permissions";
import { employeePayrollWindow } from "@/lib/payroll-allocation/protected-minutes";
import { isPayrollWorkCollectionActive } from "@/lib/payroll-collection/payroll-work-collection-reader";
import { getPayrollWorkspaceSummary } from "@/lib/payroll-workspace/summary";
import { resolveEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import { readApprovalAuthoritySnapshot } from "../authority";
import { compareLiveAbsenceWithRevision } from "../evidence/absence-facts";
import {
	loadCanonicalTimeCorrectionSubmittedRevision,
	loadCurrentAbsenceSubmittedRevision,
	loadLegacyAbsenceSubmittedRevision,
	loadLegacyTimeCorrectionSubmittedRevision,
} from "../evidence/store";
import { compareTimeCorrectionWithSubmittedRevision } from "../evidence/time-correction-evidence";
import type { ApprovalDatabase } from "../server/types";
import type {
	PayrollTriageAssessment,
	PayrollTriageAssessmentContext,
	PayrollTriageRequestSnapshot,
} from "./payroll-triage-evidence";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

function fingerprint(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
async function currentLifecycle(
	database: ApprovalDatabase,
	target: ApprovalInboxTriageTarget,
) {
	const organizationId = target.context.organizationId;
	if (
		(target.requestKind !== "absence" &&
			target.requestKind !== "time_correction") ||
		!target.authority
	)
		return null;
	const rollout = await readApprovalAuthoritySnapshot(database, {
		organizationId,
		workflowType: target.requestKind,
	});
	if (
		target.authority === "canonical_assignment" &&
		rollout.authority !== "canonical"
	)
		return null;
	const entityType =
		target.requestKind === "absence" ? "absence_entry" : "time_entry";
	if (target.authority === "compatibility_request") {
		const request = await database.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.id, target.context.requestId),
				eq(approvalRequest.entityId, target.context.entityId),
				eq(approvalRequest.entityType, entityType),
				eq(approvalRequest.status, "pending"),
			),
		});
		if (!request) return null;
		if (rollout.authority === "legacy") {
			return {
				workflowId: null,
				legacyApprovalRequestId: request.id,
				requesterEmployeeId: request.requestedBy,
				canonicalRecordId: request.canonicalRecordId,
				fingerprint: fingerprint({ authority: rollout.authority, request }),
			};
		}
		const aliases = await database
			.select({ workflow: approvalWorkflow, stage: approvalWorkflowStage })
			.from(approvalWorkflowStage)
			.innerJoin(
				approvalWorkflow,
				and(
					eq(approvalWorkflow.id, approvalWorkflowStage.workflowId),
					eq(approvalWorkflow.organizationId, organizationId),
					eq(
						approvalWorkflowStage.sequence,
						approvalWorkflow.currentStageOrder,
					),
				),
			)
			.where(
				and(
					eq(approvalWorkflowStage.organizationId, organizationId),
					eq(approvalWorkflowStage.legacyApprovalRequestId, request.id),
					eq(approvalWorkflowStage.status, "pending"),
					eq(approvalWorkflow.status, "pending"),
					eq(approvalWorkflow.workflowType, target.requestKind),
					eq(approvalWorkflow.sourceType, entityType),
					eq(approvalWorkflow.sourceId, target.context.entityId),
					eq(approvalWorkflow.requesterEmployeeId, request.requestedBy),
				),
			)
			.limit(2);
		const alias = aliases.length === 1 ? aliases[0] : null;
		return alias
			? {
					workflowId: alias.workflow.id,
					legacyApprovalRequestId: request.id,
					requesterEmployeeId: alias.workflow.requesterEmployeeId,
					canonicalRecordId: request.canonicalRecordId,
					fingerprint: fingerprint({
						authority: rollout.authority,
						request,
						...alias,
					}),
				}
			: null;
	}
	const rows = await database
		.select({
			workflow: approvalWorkflow,
			stage: approvalWorkflowStage,
			assignment: approvalStageAssignment,
		})
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
				eq(approvalWorkflowStage.sequence, approvalWorkflow.currentStageOrder),
			),
		)
		.where(
			and(
				eq(approvalStageAssignment.id, target.context.requestId),
				eq(approvalStageAssignment.organizationId, organizationId),
				eq(approvalStageAssignment.status, "pending"),
				eq(approvalWorkflowStage.status, "pending"),
				eq(approvalWorkflow.status, "pending"),
				eq(approvalWorkflow.workflowType, target.requestKind),
				eq(approvalWorkflow.sourceType, entityType),
				eq(approvalWorkflow.sourceId, target.context.entityId),
			),
		)
		.limit(2);
	const row = rows.length === 1 ? rows[0] : null;
	return row
		? {
				workflowId: row.workflow.id,
				legacyApprovalRequestId: row.stage.legacyApprovalRequestId,
				requesterEmployeeId: row.workflow.requesterEmployeeId,
				canonicalRecordId: null,
				fingerprint: fingerprint({ authority: rollout.authority, ...row }),
			}
		: null;
}

async function readCorrectionRequest(
	database: ApprovalDatabase,
	target: ApprovalInboxTriageTarget,
	lifecycle: NonNullable<Awaited<ReturnType<typeof currentLifecycle>>>,
): Promise<PayrollTriageRequestSnapshot | null> {
	if (!target.authority) return null;
	const organizationId = target.context.organizationId;
	const period = await database.query.workPeriod.findFirst({
		where: and(
			eq(workPeriod.organizationId, organizationId),
			eq(workPeriod.id, target.context.entityId),
		),
	});
	if (
		!period?.canonicalRecordId ||
		period.deletedAt ||
		!period.endTime ||
		!period.clockOutId ||
		(lifecycle.workflowId &&
			period.approvalWorkflowId !== lifecycle.workflowId) ||
		(lifecycle.canonicalRecordId &&
			lifecycle.canonicalRecordId !== period.canonicalRecordId)
	)
		return null;
	const [record, subject] = await Promise.all([
		database.query.timeRecord.findFirst({
			where: and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.id, period.canonicalRecordId),
				eq(timeRecord.recordKind, "work"),
				eq(timeRecord.employeeId, period.employeeId),
			),
		}),
		database.query.employee.findFirst({
			where: and(
				eq(employee.organizationId, organizationId),
				eq(employee.id, period.employeeId),
			),
			columns: { id: true, userId: true },
		}),
	]);
	if (!record?.endAt || !subject) return null;
	const legacyApprovalRequestId = lifecycle.legacyApprovalRequestId;
	if (legacyApprovalRequestId) {
		const alias = await database.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.organizationId, organizationId),
				eq(approvalRequest.id, legacyApprovalRequestId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, period.id),
				eq(approvalRequest.canonicalRecordId, record.id),
				eq(approvalRequest.status, "pending"),
			),
		});
		if (!alias || alias.requestedBy !== lifecycle.requesterEmployeeId)
			return null;
	}
	const chainStages =
		!lifecycle.workflowId && legacyApprovalRequestId
			? await database
					.select({
						chainInstanceId: approvalChainStageInstance.chainInstanceId,
					})
					.from(approvalChainStageInstance)
					.where(
						and(
							eq(approvalChainStageInstance.organizationId, organizationId),
							eq(
								approvalChainStageInstance.approvalRequestId,
								legacyApprovalRequestId,
							),
						),
					)
					.limit(2)
			: [];
	if (chainStages.length > 1) return null;
	const revision = lifecycle.workflowId
		? await loadCanonicalTimeCorrectionSubmittedRevision(database, {
				organizationId,
				workflowId: lifecycle.workflowId,
			})
		: legacyApprovalRequestId
			? await loadLegacyTimeCorrectionSubmittedRevision(database, {
					organizationId,
					workPeriodId: period.id,
					approvalRequestId: legacyApprovalRequestId,
					chainInstanceId: chainStages[0]?.chainInstanceId ?? null,
				})
			: null;
	if (
		!revision ||
		revision.subjectEmployeeId !== subject.id ||
		revision.requesterEmployeeId !== lifecycle.requesterEmployeeId ||
		revision.facts.canonicalRecordId !== record.id
	)
		return null;
	const start = instantToCanonicalString(instantFromDate(record.startAt)),
		end = instantToCanonicalString(instantFromDate(record.endAt));
	const comparison = await compareTimeCorrectionWithSubmittedRevision(
		database,
		revision,
	);
	const current =
		comparison.kind === "current" &&
		parseInstant(revision.facts.baseline.clockIn.at).equals(
			parseInstant(start),
		) &&
		!!revision.facts.baseline.clockOut &&
		parseInstant(revision.facts.baseline.clockOut.at).equals(
			parseInstant(end),
		) &&
		record.durationMinutes === revision.facts.baseline.storedDurationMinutes &&
		record.approvalState === period.approvalStatus;
	const [settings, organization] = await Promise.all([
		database.query.userSettings.findFirst({
			where: eq(userSettings.userId, subject.userId),
			columns: { timezone: true },
		}),
		database.query.organization.findFirst({
			where: (table, { eq }) => eq(table.id, organizationId),
			columns: { timezone: true },
		}),
	]);
	return {
		context: {
			...target.context,
			revision: `${revision.id}:${revision.materialFingerprint}`,
		},
		authority: target.authority,
		requestKind: "time_correction",
		subjectEmployeeId: subject.id,
		requesterEmployeeId: revision.requesterEmployeeId,
		canonicalRecordId: record.id,
		legacyApprovalRequestId,
		current,
		sourceFingerprint: fingerprint({
			lifecycle: lifecycle.fingerprint,
			period,
			record,
			revision: revision.id,
			materialFingerprint: revision.materialFingerprint,
		}),
		recordStartAt: start,
		recordEndAt: end,
		payrollTimezone: resolveEffectiveTimezone(
			settings?.timezone,
			organization?.timezone,
		),
		scopedCorrectionMapped:
			record.approvalState === "approved" && legacyApprovalRequestId !== null,
	};
}
export async function readPayrollTriageRequest(
	target: ApprovalInboxTriageTarget,
	suppliedDatabase?: ApprovalDatabase,
): Promise<PayrollTriageRequestSnapshot | null> {
	if (!target.authority) return null;
	const database = suppliedDatabase ?? (await import("@/db")).db;
	const organizationId = target.context.organizationId;
	const lifecycle = await currentLifecycle(database, target);
	if (!lifecycle?.requesterEmployeeId) return null;
	if (target.requestKind === "time_correction")
		return readCorrectionRequest(database, target, lifecycle);
	if (target.requestKind !== "absence") return null;
	const absence = await database.query.absenceEntry.findFirst({
		where: and(
			eq(absenceEntry.organizationId, organizationId),
			eq(absenceEntry.id, target.context.entityId),
			eq(absenceEntry.status, "pending"),
		),
		with: { category: true },
	});
	if (
		!absence ||
		absence.category.organizationId !== organizationId ||
		!absence.canonicalRecordId ||
		(lifecycle.workflowId &&
			lifecycle.workflowId !== absence.approvalWorkflowId) ||
		(lifecycle.canonicalRecordId &&
			lifecycle.canonicalRecordId !== absence.canonicalRecordId)
	)
		return null;
	const [record, subject] = await Promise.all([
		database.query.timeRecord.findFirst({
			where: and(
				eq(timeRecord.organizationId, organizationId),
				eq(timeRecord.id, absence.canonicalRecordId),
				eq(timeRecord.recordKind, "absence"),
				eq(timeRecord.employeeId, absence.employeeId),
				eq(timeRecord.approvalState, "pending"),
			),
		}),
		database.query.employee.findFirst({
			where: and(
				eq(employee.organizationId, organizationId),
				eq(employee.id, absence.employeeId),
			),
			columns: { id: true },
		}),
	]);
	if (!record?.endAt || !subject) return null;
	const revision = lifecycle.workflowId
		? await loadCurrentAbsenceSubmittedRevision(database, {
				organizationId,
				workflowId: lifecycle.workflowId,
			})
		: await loadLegacyAbsenceSubmittedRevision(database, {
				organizationId,
				absenceId: absence.id,
			});
	if (
		!revision ||
		revision.subjectEmployeeId !== subject.id ||
		revision.requesterEmployeeId !== lifecycle.requesterEmployeeId
	)
		return null;
	if ("legacy" in revision) {
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
			if (
				stages.length !== 1 ||
				stages[0]?.chainInstanceId !== revision.legacy.chainInstanceId
			)
				return null;
		} else if (revision.legacy.approvalRequestId !== target.context.requestId)
			return null;
	}
	const capturedRecord = revision.facts.compatibility.canonicalRecord;
	const start = instantToCanonicalString(instantFromDate(record.startAt)),
		end = instantToCanonicalString(instantFromDate(record.endAt));
	const current =
		capturedRecord.id === record.id &&
		parseInstant(capturedRecord.startAt).equals(parseInstant(start)) &&
		parseInstant(capturedRecord.endAt).equals(parseInstant(end)) &&
		compareLiveAbsenceWithRevision(revision.facts, revision.labels, {
			organizationId,
			absenceId: absence.id,
			employeeId: absence.employeeId,
			categoryId: absence.categoryId,
			categoryName: absence.category.name,
			startDate: absence.startDate,
			endDate: absence.endDate,
			startPeriod: absence.startPeriod,
			endPeriod: absence.endPeriod,
		}).kind === "current";
	return {
		context: {
			...target.context,
			revision: `${revision.id}:${revision.materialFingerprint}`,
		},
		authority: target.authority,
		requestKind: "absence",
		subjectEmployeeId: subject.id,
		requesterEmployeeId: revision.requesterEmployeeId,
		canonicalRecordId: record.id,
		legacyApprovalRequestId: lifecycle.legacyApprovalRequestId,
		current,
		sourceFingerprint: fingerprint({
			lifecycle: lifecycle.fingerprint,
			absence,
			record,
			revision: revision.id,
			materialFingerprint: revision.materialFingerprint,
		}),
		recordStartAt: start,
		recordEndAt: end,
	};
}

export async function readAuthorizedPayrollTriageAssessment(input: {
	target: ApprovalInboxTriageTarget;
	request: PayrollTriageRequestSnapshot;
	assessmentContext: PayrollTriageAssessmentContext;
}): Promise<PayrollTriageAssessment | null> {
	const { request, assessmentContext } = input;
	const auth = await getAuthContext();
	const organizationId = request.context.organizationId;
	if (
		!auth?.employee ||
		auth.session.activeOrganizationId !== organizationId ||
		auth.employee.organizationId !== organizationId ||
		auth.user.id !== assessmentContext.actor.userId ||
		auth.employee.id !== assessmentContext.actor.employeeId
	)
		return null;
	const allowedEmployeeIds = await resolvePayrollAccessibleEmployeeIds({
		organizationId,
		payrollEmployeeId: auth.employee.id,
	});
	if (!allowedEmployeeIds.includes(request.subjectEmployeeId)) return null;
	const { db } = await import("@/db");
	const scopedWork = await isPayrollWorkCollectionActive(db, organizationId);
	if (
		request.requestKind === "time_correction" &&
		scopedWork &&
		!request.scopedCorrectionMapped
	)
		return null;
	const scopedEmployeeIds = [request.subjectEmployeeId];
	if (request.requestKind === "time_correction" && !scopedWork) {
		if (
			!request.legacyApprovalRequestId ||
			!allowedEmployeeIds.includes(request.requesterEmployeeId)
		)
			return null;
		scopedEmployeeIds.push(request.requesterEmployeeId);
	}
	const startInstant = parsePlainDate(assessmentContext.period.startDate)
		.toZonedDateTime("UTC")
		.toInstant();
	const endExclusive = parsePlainDate(assessmentContext.period.endDate)
		.add({ days: 1 })
		.toZonedDateTime("UTC")
		.toInstant();
	// The legacy summary's pending-absence query uses these canonical UTC bounds.
	if (
		request.requestKind === "absence" &&
		(!request.recordStartAt ||
			!request.recordEndAt ||
			parseInstant(request.recordStartAt).epochNanoseconds >=
				endExclusive.epochNanoseconds ||
			parseInstant(request.recordEndAt).epochNanoseconds <
				startInstant.epochNanoseconds)
	)
		return null;
	if (request.requestKind === "time_correction") {
		if (
			!request.recordStartAt ||
			!request.recordEndAt ||
			!request.payrollTimezone
		)
			return null;
		const window = scopedWork
			? employeePayrollWindow(
					assessmentContext.period.startDate,
					assessmentContext.period.endDate,
					request.payrollTimezone,
				)
			: { start: startInstant, endExclusive };
		const sourceStart = parseInstant(request.recordStartAt).epochNanoseconds;
		const sourceEnd = parseInstant(request.recordEndAt).epochNanoseconds;
		const overlaps = scopedWork
			? sourceStart === sourceEnd
				? window.start.epochNanoseconds <= sourceStart &&
					sourceStart < window.endExclusive.epochNanoseconds
				: sourceStart < window.endExclusive.epochNanoseconds &&
					sourceEnd > window.start.epochNanoseconds
			: sourceStart < window.endExclusive.epochNanoseconds &&
				sourceEnd >= window.start.epochNanoseconds;
		if (!overlaps) return null;
	}
	// Luxon is an adapter to the existing payroll summary API, never used for new calendar logic.
	const summary = await getPayrollWorkspaceSummary({
		organizationId,
		allowedEmployeeIds: [...new Set(scopedEmployeeIds)],
		period: {
			start: DateTime.fromISO(startInstant.toString(), { zone: "utc" }),
			end: DateTime.fromISO(
				endExclusive.subtract({ milliseconds: 1 }).toString(),
				{ zone: "utc" },
			),
			label: assessmentContext.period.label,
		},
		generatedBy: {
			id: auth.employee.id,
			name: auth.user.name || auth.user.email,
		},
	});
	if ((await isPayrollWorkCollectionActive(db, organizationId)) !== scopedWork)
		return null;
	const freshScope = await resolvePayrollAccessibleEmployeeIds({
		organizationId,
		payrollEmployeeId: auth.employee.id,
	});
	if (scopedEmployeeIds.some((id) => !freshScope.includes(id))) return null;
	return {
		organizationId,
		context: request.context,
		allowedEmployeeIds: freshScope,
		workSource: scopedWork ? "scoped_collection" : "legacy_requests",
		summary: {
			period: summary.period,
			generatedAt: summary.generatedAt,
			employeeIds: summary.employees.map((row) => row.id),
			blockers: summary.blockers,
		},
	};
}
