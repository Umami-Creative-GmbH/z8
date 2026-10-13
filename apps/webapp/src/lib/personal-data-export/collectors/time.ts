/**
 * Time category of a personal data export (#811, #1167).
 *
 * Time entries, work periods with their corrections and break adjustments,
 * the work operation log (who changed the employee's work, and how),
 * historical repair proposals, automatic clock-outs, compliance exceptions,
 * work-policy violations, surcharge calculations, balances and balance
 * adjustments (cancelled ones too, with their reason).
 *
 * Time data follows the timekeeping rule: instants are UTC, every time entry
 * carries its own UTC offset and zone (a work period repeats the offsets of
 * its clock-in and clock-out entries), and calendar days are plain dates.
 * Nothing is converted to a viewer's timezone.
 *
 * Nothing in Time is withheld: both export kinds hold the same rows. Left
 * out are integrity and technical fields (the hash chain, operation receipts,
 * closure payloads, proposal fingerprints, balance refresh state), and the
 * IP address and device of an entry someone else recorded: those were
 * captured from the recorder, not the employee.
 */

import { and, asc, eq } from "drizzle-orm";
import {
	automaticClockOutExecution,
	balanceAdjustment,
	completedWorkOperation,
	complianceException,
	employeeTimeBalance,
	employeeWorkBalance,
	employeeWorkBalancePeriod,
	historicalWorkProposal,
	project,
	projectTask,
	surchargeCalculation,
	surchargeModel,
	surchargeRule,
	timeEntry,
	workCategory,
	workPeriod,
	workPolicy,
	workPolicyViolation,
} from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type CollectedCategory,
	type PersonalDataCollector,
	type PersonalDataExportDatabase,
	type PersonalDataExportScope,
	type PersonalDataPart,
	type PersonalDataValue,
	tablePart,
} from "../collector";
import { instantText, loadEmployeeNames, loadUserNames, nameOf } from "../values";
import { timeFieldGuide } from "./time-fields";

export const timeCollector: PersonalDataCollector = {
	category: "time",
	collect: collectTime,
	fields: timeFieldGuide,
};

async function collectTime(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<CollectedCategory> {
	const [work, compliance, balances] = await Promise.all([
		collectWorkParts(database, scope),
		collectComplianceParts(database, scope),
		collectBalanceParts(database, scope),
	]);
	return { category: "time", parts: [...work, ...compliance, ...balances] };
}

/** Time entries, work periods, break adjustments, the edit log, repairs, automatic clock-outs. */
async function collectWorkParts(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<PersonalDataPart[]> {
	const { organizationId, employeeId, userId } = scope;
	const [entries, periods, operations, proposals, automaticClockOuts] = await Promise.all([
		database
			.select({
				id: timeEntry.id,
				type: timeEntry.type,
				timestamp: timeEntry.timestamp,
				utcOffsetMinutes: timeEntry.utcOffsetMinutes,
				timezone: timeEntry.timezone,
				timezoneSource: timeEntry.timezoneSource,
				replacesEntryId: timeEntry.replacesEntryId,
				isSuperseded: timeEntry.isSuperseded,
				supersededById: timeEntry.supersededById,
				notes: timeEntry.notes,
				location: timeEntry.location,
				ipAddress: timeEntry.ipAddress,
				deviceInfo: timeEntry.deviceInfo,
				createdAt: timeEntry.createdAt,
				createdBy: timeEntry.createdBy,
			})
			.from(timeEntry)
			.where(
				and(eq(timeEntry.organizationId, organizationId), eq(timeEntry.employeeId, employeeId)),
			)
			.orderBy(asc(timeEntry.timestamp), asc(timeEntry.createdAt), asc(timeEntry.id)),
		database
			.select({
				id: workPeriod.id,
				clockInId: workPeriod.clockInId,
				clockOutId: workPeriod.clockOutId,
				startTime: workPeriod.startTime,
				endTime: workPeriod.endTime,
				durationMinutes: workPeriod.durationMinutes,
				isActive: workPeriod.isActive,
				project: project.name,
				task: projectTask.name,
				isBillable: workPeriod.isBillable,
				workCategory: workCategory.name,
				workLocationType: workPeriod.workLocationType,
				approvalStatus: workPeriod.approvalStatus,
				pendingChanges: workPeriod.pendingChanges,
				breakStartedAt: workPeriod.breakStartedAt,
				breakStartedZone: workPeriod.breakStartedZone,
				wasAutoAdjusted: workPeriod.wasAutoAdjusted,
				autoAdjustmentReason: workPeriod.autoAdjustmentReason,
				autoAdjustedAt: workPeriod.autoAdjustedAt,
				originalEndTime: workPeriod.originalEndTime,
				originalDurationMinutes: workPeriod.originalDurationMinutes,
				deletedAt: workPeriod.deletedAt,
				deletedBy: workPeriod.deletedBy,
				deletionReason: workPeriod.deletionReason,
				createdAt: workPeriod.createdAt,
				updatedAt: workPeriod.updatedAt,
			})
			.from(workPeriod)
			.leftJoin(
				project,
				and(eq(project.id, workPeriod.projectId), eq(project.organizationId, organizationId)),
			)
			.leftJoin(
				projectTask,
				and(eq(projectTask.id, workPeriod.taskId), eq(projectTask.organizationId, organizationId)),
			)
			.leftJoin(
				workCategory,
				and(
					eq(workCategory.id, workPeriod.workCategoryId),
					eq(workCategory.organizationId, organizationId),
				),
			)
			.where(
				and(eq(workPeriod.organizationId, organizationId), eq(workPeriod.employeeId, employeeId)),
			)
			.orderBy(asc(workPeriod.startTime), asc(workPeriod.id)),
		database
			.select({
				workPeriodId: completedWorkOperation.workPeriodId,
				kind: completedWorkOperation.kind,
				writer: completedWorkOperation.writer,
				actorKind: completedWorkOperation.actorKind,
				actorUserId: completedWorkOperation.actorUserId,
				createdAt: completedWorkOperation.createdAt,
			})
			.from(completedWorkOperation)
			.where(
				and(
					eq(completedWorkOperation.organizationId, organizationId),
					eq(completedWorkOperation.employeeId, employeeId),
				),
			)
			.orderBy(asc(completedWorkOperation.createdAt), asc(completedWorkOperation.id)),
		database
			.select({
				id: historicalWorkProposal.id,
				kind: historicalWorkProposal.kind,
				status: historicalWorkProposal.status,
				workPeriodId: historicalWorkProposal.workPeriodId,
				reason: historicalWorkProposal.reason,
				proposedBy: historicalWorkProposal.proposedBy,
				proposedAt: historicalWorkProposal.proposedAt,
				approvedBy: historicalWorkProposal.approvedBy,
				approvedAt: historicalWorkProposal.approvedAt,
				resolvedBy: historicalWorkProposal.resolvedBy,
				resolvedAt: historicalWorkProposal.resolvedAt,
			})
			.from(historicalWorkProposal)
			.where(
				and(
					eq(historicalWorkProposal.organizationId, organizationId),
					eq(historicalWorkProposal.employeeId, employeeId),
				),
			)
			.orderBy(asc(historicalWorkProposal.proposedAt), asc(historicalWorkProposal.id)),
		database
			.select({
				workPeriodId: automaticClockOutExecution.workPeriodId,
				startTime: automaticClockOutExecution.startTime,
				cutoffTime: automaticClockOutExecution.cutoffTime,
				maxUninterruptedMinutes: automaticClockOutExecution.maxUninterruptedMinutes,
				timezone: automaticClockOutExecution.timezone,
				utcOffsetMinutes: automaticClockOutExecution.utcOffsetMinutes,
				clockOutEntryId: automaticClockOutExecution.clockOutEntryId,
				processedAt: automaticClockOutExecution.processedAt,
			})
			.from(automaticClockOutExecution)
			.where(
				and(
					eq(automaticClockOutExecution.organizationId, organizationId),
					eq(automaticClockOutExecution.employeeId, employeeId),
				),
			)
			.orderBy(asc(automaticClockOutExecution.processedAt)),
	]);

	const pendingChanges = new Map(
		periods.map((row) => [row.id, jsonObject(row.pendingChanges)] as const),
	);
	const userNames = await loadUserNames(database, [
		...entries.map((row) => row.createdBy),
		...periods.map((row) => row.deletedBy),
		...[...pendingChanges.values()].map((changes) => stringField(changes, "requestedBy")),
		...operations.map((row) => row.actorUserId),
		...proposals.flatMap((row) => [row.proposedBy, row.approvedBy, row.resolvedBy]),
	]);
	const byUser = (id: string | null | undefined) => nameOf(userNames, id);
	const entryOffsets = new Map(entries.map((row) => [row.id, row.utcOffsetMinutes]));
	const offsetOf = (entryId: string | null) =>
		entryId ? (entryOffsets.get(entryId) ?? null) : null;

	return [
		tablePart(
			"time_entries",
			TIME_ENTRY_COLUMNS,
			entries.map((row) => {
				// Captured from whoever recorded the entry: the employee's own only.
				const ownCapture = row.createdBy === userId;
				return {
					id: row.id,
					type: row.type,
					timestamp: instantText(row.timestamp),
					utc_offset_minutes: row.utcOffsetMinutes,
					timezone: row.timezone,
					timezone_source: row.timezoneSource,
					replaces_entry_id: row.replacesEntryId,
					is_superseded: row.isSuperseded,
					superseded_by_id: row.supersededById,
					notes: row.notes,
					location: row.location,
					ip_address: ownCapture ? row.ipAddress : null,
					device_info: ownCapture ? row.deviceInfo : null,
					created_at: instantText(row.createdAt),
					created_by: byUser(row.createdBy),
				};
			}),
		),
		tablePart(
			"work_periods",
			WORK_PERIOD_COLUMNS,
			periods.map((row) => {
				const pending = pendingChanges.get(row.id) ?? null;
				return {
					id: row.id,
					start_time: instantText(row.startTime),
					start_utc_offset_minutes: offsetOf(row.clockInId),
					end_time: instantText(row.endTime),
					end_utc_offset_minutes: offsetOf(row.clockOutId),
					duration_minutes: row.durationMinutes,
					is_active: row.isActive,
					clock_in_entry_id: row.clockInId,
					clock_out_entry_id: row.clockOutId,
					project: row.project,
					task: row.task,
					is_billable: row.isBillable,
					work_category: row.workCategory,
					work_location_type: row.workLocationType,
					break_started_at: instantText(row.breakStartedAt),
					break_started_zone: row.breakStartedZone,
					approval_status: row.approvalStatus,
					pending_start_time: instantField(pending, "requestedStartTime"),
					pending_end_time: instantField(pending, "requestedEndTime"),
					pending_duration_minutes: numberField(pending, "requestedDurationMinutes"),
					pending_requested_at: instantField(pending, "requestedAt"),
					pending_requested_by: byUser(stringField(pending, "requestedBy")),
					pending_reason: stringField(pending, "reason"),
					deleted_at: instantText(row.deletedAt),
					deleted_by: byUser(row.deletedBy),
					deletion_reason: row.deletionReason,
					created_at: instantText(row.createdAt),
					updated_at: instantText(row.updatedAt),
				};
			}),
		),
		tablePart(
			"break_adjustments",
			BREAK_ADJUSTMENT_COLUMNS,
			periods
				.filter((row) => row.wasAutoAdjusted)
				.map((row) => {
					const reason = jsonObject(row.autoAdjustmentReason);
					const rule = objectField(reason, "ruleApplied");
					return {
						work_period_id: row.id,
						adjusted_at: instantText(row.autoAdjustedAt),
						policy: stringField(reason, "regulationName"),
						break_inserted_at: instantField(reason, "breakInsertedAt"),
						break_inserted_minutes: numberField(reason, "breakInsertedMinutes"),
						required_break_minutes: numberField(rule, "requiredBreakMinutes"),
						working_minutes_threshold: numberField(rule, "workingMinutesThreshold"),
						original_end_time: instantText(row.originalEndTime),
						original_duration_minutes: row.originalDurationMinutes,
						adjusted_duration_minutes: numberField(reason, "adjustedDurationMinutes"),
					};
				}),
		),
		tablePart(
			"work_operations",
			WORK_OPERATION_COLUMNS,
			operations.map((row) => ({
				work_period_id: row.workPeriodId,
				kind: row.kind,
				writer: row.writer,
				actor_kind: row.actorKind,
				actor: byUser(row.actorUserId),
				created_at: instantText(row.createdAt),
			})),
		),
		tablePart(
			"automatic_clock_outs",
			AUTOMATIC_CLOCK_OUT_COLUMNS,
			automaticClockOuts.map((row) => ({
				work_period_id: row.workPeriodId,
				start_time: instantText(row.startTime),
				cutoff_time: instantText(row.cutoffTime),
				max_uninterrupted_minutes: row.maxUninterruptedMinutes,
				timezone: row.timezone,
				utc_offset_minutes: row.utcOffsetMinutes,
				clock_out_entry_id: row.clockOutEntryId,
				processed_at: instantText(row.processedAt),
			})),
		),
		tablePart(
			"historical_repair_proposals",
			HISTORICAL_REPAIR_PROPOSAL_COLUMNS,
			proposals.map((row) => ({
				id: row.id,
				kind: row.kind,
				status: row.status,
				work_period_id: row.workPeriodId,
				reason: row.reason,
				proposed_by: byUser(row.proposedBy),
				proposed_at: instantText(row.proposedAt),
				approved_by: byUser(row.approvedBy),
				approved_at: instantText(row.approvedAt),
				resolved_by: byUser(row.resolvedBy),
				resolved_at: instantText(row.resolvedAt),
			})),
		),
	];
}

/** Compliance exceptions, work-policy violations and surcharge calculations. */
async function collectComplianceParts(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<PersonalDataPart[]> {
	const { organizationId, employeeId } = scope;
	const [exceptions, violations, surcharges] = await Promise.all([
		database
			.select({
				exceptionType: complianceException.exceptionType,
				status: complianceException.status,
				reason: complianceException.reason,
				plannedDurationMinutes: complianceException.plannedDurationMinutes,
				validFrom: complianceException.validFrom,
				validUntil: complianceException.validUntil,
				approverId: complianceException.approverId,
				approvedAt: complianceException.approvedAt,
				rejectedAt: complianceException.rejectedAt,
				rejectionReason: complianceException.rejectionReason,
				wasUsed: complianceException.wasUsed,
				usedAt: complianceException.usedAt,
				actualDurationMinutes: complianceException.actualDurationMinutes,
				workPeriodId: complianceException.workPeriodId,
				createdAt: complianceException.createdAt,
				createdBy: complianceException.createdBy,
				updatedAt: complianceException.updatedAt,
			})
			.from(complianceException)
			.where(
				and(
					eq(complianceException.organizationId, organizationId),
					eq(complianceException.employeeId, employeeId),
				),
			)
			.orderBy(asc(complianceException.validFrom), asc(complianceException.id)),
		database
			.select({
				policy: workPolicy.name,
				workPeriodId: workPolicyViolation.workPeriodId,
				violationType: workPolicyViolation.violationType,
				violationDate: workPolicyViolation.violationDate,
				details: workPolicyViolation.details,
				acknowledgedBy: workPolicyViolation.acknowledgedBy,
				acknowledgedAt: workPolicyViolation.acknowledgedAt,
				acknowledgedNote: workPolicyViolation.acknowledgedNote,
				createdAt: workPolicyViolation.createdAt,
			})
			.from(workPolicyViolation)
			.leftJoin(
				workPolicy,
				and(
					eq(workPolicy.id, workPolicyViolation.policyId),
					eq(workPolicy.organizationId, organizationId),
				),
			)
			.where(
				and(
					eq(workPolicyViolation.organizationId, organizationId),
					eq(workPolicyViolation.employeeId, employeeId),
				),
			)
			.orderBy(asc(workPolicyViolation.violationDate), asc(workPolicyViolation.id)),
		database
			.select({
				workPeriodId: surchargeCalculation.workPeriodId,
				surchargeModel: surchargeModel.name,
				surchargeRule: surchargeRule.name,
				calculationDate: surchargeCalculation.calculationDate,
				baseMinutes: surchargeCalculation.baseMinutes,
				qualifyingMinutes: surchargeCalculation.qualifyingMinutes,
				surchargeMinutes: surchargeCalculation.surchargeMinutes,
				appliedPercentage: surchargeCalculation.appliedPercentage,
				calculationDetails: surchargeCalculation.calculationDetails,
				createdAt: surchargeCalculation.createdAt,
			})
			.from(surchargeCalculation)
			.leftJoin(
				surchargeModel,
				and(
					eq(surchargeModel.id, surchargeCalculation.surchargeModelId),
					eq(surchargeModel.organizationId, organizationId),
				),
			)
			// A rule has no organization of its own: it belongs to the org-checked model.
			.leftJoin(
				surchargeRule,
				and(
					eq(surchargeRule.id, surchargeCalculation.surchargeRuleId),
					eq(surchargeRule.modelId, surchargeModel.id),
				),
			)
			.where(
				and(
					eq(surchargeCalculation.organizationId, organizationId),
					eq(surchargeCalculation.employeeId, employeeId),
				),
			)
			.orderBy(asc(surchargeCalculation.calculationDate), asc(surchargeCalculation.id)),
	]);

	const [userNames, employeeNames] = await Promise.all([
		loadUserNames(
			database,
			exceptions.map((row) => row.createdBy),
		),
		loadEmployeeNames(database, organizationId, [
			...exceptions.map((row) => row.approverId),
			...violations.map((row) => row.acknowledgedBy),
		]),
	]);

	return [
		tablePart(
			"compliance_exceptions",
			COMPLIANCE_EXCEPTION_COLUMNS,
			exceptions.map((row) => ({
				exception_type: row.exceptionType,
				status: row.status,
				reason: row.reason,
				planned_duration_minutes: row.plannedDurationMinutes,
				valid_from: instantText(row.validFrom),
				valid_until: instantText(row.validUntil),
				approver: nameOf(employeeNames, row.approverId),
				approved_at: instantText(row.approvedAt),
				rejected_at: instantText(row.rejectedAt),
				rejection_reason: row.rejectionReason,
				was_used: row.wasUsed,
				used_at: instantText(row.usedAt),
				actual_duration_minutes: row.actualDurationMinutes,
				work_period_id: row.workPeriodId,
				created_at: instantText(row.createdAt),
				created_by: nameOf(userNames, row.createdBy),
				updated_at: instantText(row.updatedAt),
			})),
		),
		tablePart(
			"work_policy_violations",
			WORK_POLICY_VIOLATION_COLUMNS,
			violations.map((row) => ({
				policy: row.policy,
				work_period_id: row.workPeriodId,
				violation_type: row.violationType,
				violated_at: instantText(row.violationDate),
				details: jsonText(row.details),
				acknowledged_by: nameOf(employeeNames, row.acknowledgedBy),
				acknowledged_at: instantText(row.acknowledgedAt),
				acknowledged_note: row.acknowledgedNote,
				created_at: instantText(row.createdAt),
			})),
		),
		tablePart(
			"surcharge_calculations",
			SURCHARGE_CALCULATION_COLUMNS,
			surcharges.map((row) => ({
				work_period_id: row.workPeriodId,
				surcharge_model: row.surchargeModel,
				surcharge_rule: row.surchargeRule,
				calculated_at: instantText(row.calculationDate),
				base_minutes: row.baseMinutes,
				qualifying_minutes: row.qualifyingMinutes,
				surcharge_minutes: row.surchargeMinutes,
				applied_percentage: row.appliedPercentage,
				calculation_details: jsonText(row.calculationDetails),
				created_at: instantText(row.createdAt),
			})),
		),
	];
}

/** The work balance, its periods, the legacy yearly balances and balance adjustments. */
async function collectBalanceParts(
	database: PersonalDataExportDatabase,
	scope: PersonalDataExportScope,
): Promise<PersonalDataPart[]> {
	const { organizationId, employeeId } = scope;
	const [balances, balancePeriods, yearlyBalances, adjustments] = await Promise.all([
		database
			.select({
				actualMinutes: employeeWorkBalance.actualMinutes,
				requiredMinutes: employeeWorkBalance.requiredMinutes,
				adjustmentMinutes: employeeWorkBalance.adjustmentMinutes,
				balanceMinutes: employeeWorkBalance.balanceMinutes,
				computedFromDate: employeeWorkBalance.computedFromDate,
				computedThroughDate: employeeWorkBalance.computedThroughDate,
				computedAt: employeeWorkBalance.computedAt,
			})
			.from(employeeWorkBalance)
			.where(
				and(
					eq(employeeWorkBalance.organizationId, organizationId),
					eq(employeeWorkBalance.employeeId, employeeId),
				),
			),
		database
			.select({
				periodType: employeeWorkBalancePeriod.periodType,
				periodStart: employeeWorkBalancePeriod.periodStart,
				periodEnd: employeeWorkBalancePeriod.periodEnd,
				actualMinutes: employeeWorkBalancePeriod.actualMinutes,
				requiredMinutes: employeeWorkBalancePeriod.requiredMinutes,
				balanceMinutes: employeeWorkBalancePeriod.balanceMinutes,
				isClosed: employeeWorkBalancePeriod.isClosed,
				computedAt: employeeWorkBalancePeriod.computedAt,
			})
			.from(employeeWorkBalancePeriod)
			.where(
				and(
					eq(employeeWorkBalancePeriod.organizationId, organizationId),
					eq(employeeWorkBalancePeriod.employeeId, employeeId),
				),
			)
			.orderBy(
				asc(employeeWorkBalancePeriod.periodStart),
				asc(employeeWorkBalancePeriod.periodType),
			),
		database
			.select({
				year: employeeTimeBalance.year,
				actualMinutes: employeeTimeBalance.actualMinutes,
				expectedMinutes: employeeTimeBalance.expectedMinutes,
				absenceAdjustedMinutes: employeeTimeBalance.absenceAdjustedMinutes,
				balanceMinutes: employeeTimeBalance.balanceMinutes,
				calculatedAt: employeeTimeBalance.calculatedAt,
			})
			.from(employeeTimeBalance)
			.where(
				and(
					eq(employeeTimeBalance.organizationId, organizationId),
					eq(employeeTimeBalance.employeeId, employeeId),
				),
			)
			.orderBy(asc(employeeTimeBalance.year)),
		database
			.select({
				id: balanceAdjustment.id,
				kind: balanceAdjustment.kind,
				day: balanceAdjustment.day,
				minutes: balanceAdjustment.minutes,
				reason: balanceAdjustment.reason,
				recordedBy: balanceAdjustment.recordedBy,
				recordedAt: balanceAdjustment.recordedAt,
				cancelledAt: balanceAdjustment.cancelledAt,
				cancelledBy: balanceAdjustment.cancelledBy,
				cancellationReason: balanceAdjustment.cancellationReason,
			})
			.from(balanceAdjustment)
			.where(
				and(
					eq(balanceAdjustment.organizationId, organizationId),
					eq(balanceAdjustment.employeeId, employeeId),
				),
			)
			.orderBy(asc(balanceAdjustment.day), asc(balanceAdjustment.recordedAt)),
	]);

	const userNames = await loadUserNames(
		database,
		adjustments.flatMap((row) => [row.recordedBy, row.cancelledBy]),
	);

	return [
		tablePart(
			"work_balance",
			WORK_BALANCE_COLUMNS,
			balances.map((row) => ({
				actual_minutes: row.actualMinutes,
				required_minutes: row.requiredMinutes,
				adjustment_minutes: row.adjustmentMinutes,
				balance_minutes: row.balanceMinutes,
				computed_from_date: row.computedFromDate,
				computed_through_date: row.computedThroughDate,
				computed_at: instantText(row.computedAt),
			})),
		),
		tablePart(
			"work_balance_periods",
			WORK_BALANCE_PERIOD_COLUMNS,
			balancePeriods.map((row) => ({
				period_type: row.periodType,
				period_start: row.periodStart,
				period_end: row.periodEnd,
				actual_minutes: row.actualMinutes,
				required_minutes: row.requiredMinutes,
				balance_minutes: row.balanceMinutes,
				is_closed: row.isClosed,
				computed_at: instantText(row.computedAt),
			})),
		),
		tablePart(
			"yearly_balances",
			YEARLY_BALANCE_COLUMNS,
			yearlyBalances.map((row) => ({
				year: row.year,
				actual_minutes: row.actualMinutes,
				expected_minutes: row.expectedMinutes,
				absence_adjusted_minutes: row.absenceAdjustedMinutes,
				balance_minutes: row.balanceMinutes,
				calculated_at: instantText(row.calculatedAt),
			})),
		),
		tablePart(
			"balance_adjustments",
			BALANCE_ADJUSTMENT_COLUMNS,
			adjustments.map((row) => ({
				id: row.id,
				kind: row.kind,
				day: row.day,
				minutes: row.minutes,
				reason: row.reason,
				recorded_by: nameOf(userNames, row.recordedBy),
				recorded_at: instantText(row.recordedAt),
				cancelled_at: instantText(row.cancelledAt),
				cancelled_by: nameOf(userNames, row.cancelledBy),
				cancellation_reason: row.cancellationReason,
			})),
		),
	];
}

type JsonObject = Record<string, unknown>;

/** A JSON text column, typed as its parsed shape but read as stored text. */
function jsonText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value : JSON.stringify(value);
}

/** A JSON text column (or an already parsed value) as an object, else null. */
function jsonObject(value: unknown): JsonObject | null {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value);
		} catch {
			return null;
		}
	}
	return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
		? (parsed as JsonObject)
		: null;
}

function objectField(source: JsonObject | null, key: string): JsonObject | null {
	return jsonObject(source?.[key] ?? null);
}

function stringField(source: JsonObject | null, key: string): string | null {
	const value = source?.[key];
	return typeof value === "string" ? value : null;
}

function numberField(source: JsonObject | null, key: string): number | null {
	const value = source?.[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** An ISO instant inside stored JSON, written like every other instant (UTC, `Z`). */
function instantField(source: JsonObject | null, key: string): PersonalDataValue {
	const value = stringField(source, key);
	if (value === null) return null;
	try {
		return parseInstant(value).toString();
	} catch {
		return value;
	}
}

const TIME_ENTRY_COLUMNS = [
	"id",
	"type",
	"timestamp",
	"utc_offset_minutes",
	"timezone",
	"timezone_source",
	"replaces_entry_id",
	"is_superseded",
	"superseded_by_id",
	"notes",
	"location",
	"ip_address",
	"device_info",
	"created_at",
	"created_by",
] as const;

const WORK_PERIOD_COLUMNS = [
	"id",
	"start_time",
	"start_utc_offset_minutes",
	"end_time",
	"end_utc_offset_minutes",
	"duration_minutes",
	"is_active",
	"clock_in_entry_id",
	"clock_out_entry_id",
	"project",
	"task",
	"is_billable",
	"work_category",
	"work_location_type",
	"break_started_at",
	"break_started_zone",
	"approval_status",
	"pending_start_time",
	"pending_end_time",
	"pending_duration_minutes",
	"pending_requested_at",
	"pending_requested_by",
	"pending_reason",
	"deleted_at",
	"deleted_by",
	"deletion_reason",
	"created_at",
	"updated_at",
] as const;

const BREAK_ADJUSTMENT_COLUMNS = [
	"work_period_id",
	"adjusted_at",
	"policy",
	"break_inserted_at",
	"break_inserted_minutes",
	"required_break_minutes",
	"working_minutes_threshold",
	"original_end_time",
	"original_duration_minutes",
	"adjusted_duration_minutes",
] as const;

const WORK_OPERATION_COLUMNS = [
	"work_period_id",
	"kind",
	"writer",
	"actor_kind",
	"actor",
	"created_at",
] as const;

const AUTOMATIC_CLOCK_OUT_COLUMNS = [
	"work_period_id",
	"start_time",
	"cutoff_time",
	"max_uninterrupted_minutes",
	"timezone",
	"utc_offset_minutes",
	"clock_out_entry_id",
	"processed_at",
] as const;

const HISTORICAL_REPAIR_PROPOSAL_COLUMNS = [
	"id",
	"kind",
	"status",
	"work_period_id",
	"reason",
	"proposed_by",
	"proposed_at",
	"approved_by",
	"approved_at",
	"resolved_by",
	"resolved_at",
] as const;

const COMPLIANCE_EXCEPTION_COLUMNS = [
	"exception_type",
	"status",
	"reason",
	"planned_duration_minutes",
	"valid_from",
	"valid_until",
	"approver",
	"approved_at",
	"rejected_at",
	"rejection_reason",
	"was_used",
	"used_at",
	"actual_duration_minutes",
	"work_period_id",
	"created_at",
	"created_by",
	"updated_at",
] as const;

const WORK_POLICY_VIOLATION_COLUMNS = [
	"policy",
	"work_period_id",
	"violation_type",
	"violated_at",
	"details",
	"acknowledged_by",
	"acknowledged_at",
	"acknowledged_note",
	"created_at",
] as const;

const SURCHARGE_CALCULATION_COLUMNS = [
	"work_period_id",
	"surcharge_model",
	"surcharge_rule",
	"calculated_at",
	"base_minutes",
	"qualifying_minutes",
	"surcharge_minutes",
	"applied_percentage",
	"calculation_details",
	"created_at",
] as const;

const WORK_BALANCE_COLUMNS = [
	"actual_minutes",
	"required_minutes",
	"adjustment_minutes",
	"balance_minutes",
	"computed_from_date",
	"computed_through_date",
	"computed_at",
] as const;

const WORK_BALANCE_PERIOD_COLUMNS = [
	"period_type",
	"period_start",
	"period_end",
	"actual_minutes",
	"required_minutes",
	"balance_minutes",
	"is_closed",
	"computed_at",
] as const;

const YEARLY_BALANCE_COLUMNS = [
	"year",
	"actual_minutes",
	"expected_minutes",
	"absence_adjusted_minutes",
	"balance_minutes",
	"calculated_at",
] as const;

const BALANCE_ADJUSTMENT_COLUMNS = [
	"id",
	"kind",
	"day",
	"minutes",
	"reason",
	"recorded_by",
	"recorded_at",
	"cancelled_at",
	"cancelled_by",
	"cancellation_reason",
] as const;
