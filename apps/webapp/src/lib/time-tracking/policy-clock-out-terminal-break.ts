import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { OrdinaryWorkPeriodFinalizerDbService } from "@/lib/approvals/domain-adapters/work-period-contract";
import {
	compareInstants,
	dateFromInstant,
	type Instant,
	instantFromDate,
} from "@/lib/datetime/temporal-core";
import { calculateHash } from "./blockchain";
import { calculateBreakDeficit } from "./break-policy-calculation";
import type { PolicyClockOutBreakSnapshot } from "./policy-clock-out-break-snapshot";
import {
	isValidIanaTimezone,
	resolveFallbackTimezoneCapture,
} from "./timezone-capture";

type WorkLocationType = "office" | "home" | "remote" | "other" | null;

export interface PolicyClockOutTerminalPeriodSnapshot {
	id: string;
	organizationId: string;
	employeeId: string;
	clockInId: string;
	clockOutId: string;
	canonicalRecordId: string;
	approvalWorkflowId: string | null;
	startTime: Date;
	endTime: Date;
	durationMinutes: number;
	projectId: string | null;
	workCategoryId: string | null;
	workLocationType: WorkLocationType;
}

export interface EnforcePolicyClockOutTerminalBreakInput {
	dbService: OrdinaryWorkPeriodFinalizerDbService;
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	period: PolicyClockOutTerminalPeriodSnapshot;
	adjustedAt: Instant;
	breakPolicySnapshot: PolicyClockOutBreakSnapshot;
}

export type PolicyClockOutTerminalBreakResult =
	| { kind: "not_required" }
	| { kind: "adjusted"; breakMinutes: number };

interface LockedSource extends PolicyClockOutTerminalPeriodSnapshot {
	approvalStatus: string;
	pendingChanges: unknown;
	isActive: boolean;
	deletedAt: Date | null;
	wasAutoAdjusted: boolean;
	originalEndTime: Date | null;
	originalDurationMinutes: number | null;
	clockInType: string;
	clockInTimestamp: Date;
	clockOutType: string;
	clockOutTimestamp: Date;
	clockOutTimezone: string | null;
	employeeTimezone: string | null;
	canonicalId: string;
	canonicalStartAt: Date;
	canonicalEndAt: Date;
	canonicalDurationMinutes: number;
	canonicalApprovalState: string;
	canonicalOrigin: string;
	canonicalWorkCategoryId: string | null;
	canonicalWorkLocationType: WorkLocationType;
	computationMetadata: string | null;
	allocations: unknown[];
}

function fail(): never {
	throw new Error("Policy clock-out terminal break enforcement conflict");
}

function rows(result: unknown): unknown[] {
	if (
		typeof result !== "object" ||
		result === null ||
		!("rows" in result) ||
		!Array.isArray(result.rows)
	) {
		return fail();
	}
	return result.rows;
}

function object(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return fail();
	}
	return value as Record<string, unknown>;
}

function sameDate(left: unknown, right: Date): boolean {
	return left instanceof Date && left.getTime() === right.getTime();
}

function exactWrite(rowsValue: unknown[], expectedId: string): void {
	if (rowsValue.length !== 1 || object(rowsValue[0]).id !== expectedId) {
		fail();
	}
}

function validateAllocation(value: unknown): {
	allocationKind: "project" | "cost_center";
	projectId: string | null;
	costCenterId: string | null;
	weightPercent: number;
} {
	const allocation = object(value);
	if (
		(allocation.allocationKind !== "project" &&
			allocation.allocationKind !== "cost_center") ||
		(allocation.projectId !== null &&
			typeof allocation.projectId !== "string") ||
		(allocation.costCenterId !== null &&
			typeof allocation.costCenterId !== "string") ||
		!Number.isSafeInteger(allocation.weightPercent) ||
		(allocation.weightPercent as number) <= 0 ||
		(allocation.allocationKind === "project" &&
			(typeof allocation.projectId !== "string" ||
				allocation.costCenterId !== null)) ||
		(allocation.allocationKind === "cost_center" &&
			(typeof allocation.costCenterId !== "string" ||
				allocation.projectId !== null))
	) {
		return fail();
	}
	return allocation as ReturnType<typeof validateAllocation>;
}

function validateLockedSource(
	value: unknown,
	input: EnforcePolicyClockOutTerminalBreakInput,
): LockedSource {
	const source = object(value) as unknown as LockedSource;
	const period = input.period;
	if (
		period.organizationId !== input.organizationId ||
		period.employeeId !== input.employeeId ||
		source.id !== period.id ||
		source.organizationId !== input.organizationId ||
		source.employeeId !== input.employeeId ||
		source.clockInId !== period.clockInId ||
		source.clockOutId !== period.clockOutId ||
		source.canonicalRecordId !== period.canonicalRecordId ||
		source.approvalWorkflowId !== period.approvalWorkflowId ||
		source.approvalStatus !== "approved" ||
		source.pendingChanges !== null ||
		source.isActive !== false ||
		source.deletedAt !== null ||
		source.wasAutoAdjusted !== false ||
		source.originalEndTime !== null ||
		source.originalDurationMinutes !== null ||
		!sameDate(source.startTime, period.startTime) ||
		!sameDate(source.endTime, period.endTime) ||
		source.durationMinutes !== period.durationMinutes ||
		source.projectId !== period.projectId ||
		source.workCategoryId !== period.workCategoryId ||
		source.workLocationType !== period.workLocationType ||
		source.clockInType !== "clock_in" ||
		source.clockOutType !== "clock_out" ||
		!sameDate(source.clockInTimestamp, period.startTime) ||
		!sameDate(source.clockOutTimestamp, period.endTime) ||
		source.canonicalId !== period.canonicalRecordId ||
		!sameDate(source.canonicalStartAt, period.startTime) ||
		!sameDate(source.canonicalEndAt, period.endTime) ||
		source.canonicalDurationMinutes !== period.durationMinutes ||
		source.canonicalApprovalState !== "approved" ||
		source.canonicalOrigin !== "clock" ||
		source.canonicalWorkCategoryId !== period.workCategoryId ||
		source.canonicalWorkLocationType !== period.workLocationType ||
		!Array.isArray(source.allocations)
	) {
		return fail();
	}
	return source;
}

export async function applyPolicyClockOutTerminalBreakInTransaction(
	input: EnforcePolicyClockOutTerminalBreakInput,
): Promise<PolicyClockOutTerminalBreakResult> {
	const db = input.dbService.db;
	const employeeLock = await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${input.employeeId}, 0)) as locked`,
	);
	if (rows(employeeLock).length !== 1) return fail();
	const ownershipLockKey = JSON.stringify([
		input.organizationId,
		input.employeeId,
	]);
	const ownershipLock = await db.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${ownershipLockKey}, 0)) as locked`,
	);
	if (rows(ownershipLock).length !== 1) return fail();

	const sourceResult = await db.execute(sql`
		select
			period.id,
			period.organization_id as "organizationId",
			period.employee_id as "employeeId",
			period.clock_in_id as "clockInId",
			period.clock_out_id as "clockOutId",
			period.canonical_record_id as "canonicalRecordId",
			period.approval_workflow_id as "approvalWorkflowId",
			period.approval_status as "approvalStatus",
			period.pending_changes as "pendingChanges",
			period.is_active as "isActive",
			period.deleted_at as "deletedAt",
			period.was_auto_adjusted as "wasAutoAdjusted",
			period.original_end_time as "originalEndTime",
			period.original_duration_minutes as "originalDurationMinutes",
			period.start_time as "startTime",
			period.end_time as "endTime",
			period.duration_minutes as "durationMinutes",
			period.project_id as "projectId",
			period.work_category_id as "workCategoryId",
			period.work_location_type as "workLocationType",
			clock_in.type as "clockInType",
			clock_in.timestamp as "clockInTimestamp",
			clock_out.type as "clockOutType",
			clock_out.timestamp as "clockOutTimestamp",
			clock_out.timezone as "clockOutTimezone",
			settings.timezone as "employeeTimezone",
			canonical.id as "canonicalId",
			canonical.start_at as "canonicalStartAt",
			canonical.end_at as "canonicalEndAt",
			canonical.duration_minutes as "canonicalDurationMinutes",
			canonical.approval_state as "canonicalApprovalState",
			canonical.origin as "canonicalOrigin",
			canonical_work.work_category_id as "canonicalWorkCategoryId",
			canonical_work.work_location_type as "canonicalWorkLocationType",
			canonical_work.computation_metadata as "computationMetadata",
			coalesce((
				select json_agg(json_build_object(
					'allocationKind', allocation.allocation_kind,
					'projectId', allocation.project_id,
					'costCenterId', allocation.cost_center_id,
					'weightPercent', allocation.weight_percent
				) order by allocation.id)
				from time_record_allocation allocation
				where allocation.organization_id = period.organization_id
					and allocation.record_id = canonical.id
			), '[]'::json) as allocations
		from work_period period
		join employee employee_row
			on employee_row.id = period.employee_id
			and employee_row.organization_id = period.organization_id
		join time_entry clock_in
			on clock_in.id = period.clock_in_id
			and clock_in.organization_id = period.organization_id
			and clock_in.employee_id = period.employee_id
		join time_entry clock_out
			on clock_out.id = period.clock_out_id
			and clock_out.organization_id = period.organization_id
			and clock_out.employee_id = period.employee_id
		join time_record canonical
			on canonical.id = period.canonical_record_id
			and canonical.organization_id = period.organization_id
			and canonical.employee_id = period.employee_id
			and canonical.record_kind = 'work'
		join time_record_work canonical_work
			on canonical_work.record_id = canonical.id
			and canonical_work.organization_id = canonical.organization_id
		left join user_settings settings on settings.user_id = employee_row.user_id
		where period.id = ${input.period.id}::uuid
			and period.organization_id = ${input.organizationId}
			and period.employee_id = ${input.employeeId}::uuid
		limit 2
		for update of period, clock_in, clock_out, canonical, canonical_work
	`);
	const sourceRows = rows(sourceResult);
	if (sourceRows.length !== 1) return fail();
	const source = validateLockedSource(sourceRows[0], input);

	if (input.breakPolicySnapshot.resolution === "none") {
		return { kind: "not_required" };
	}
	const breakRules = input.breakPolicySnapshot.breakRules.map((rule) => ({
		workingMinutesThreshold: rule.workingMinutesThreshold,
		requiredBreakMinutes: rule.requiredBreakMinutes,
	}));
	const calculation = calculateBreakDeficit({
		sessionDurationMinutes: source.durationMinutes,
		alreadyTakenBreakMinutes: 0,
		regulation: {
			id: input.breakPolicySnapshot.regulation.id,
			name: input.breakPolicySnapshot.regulation.name,
			maxUninterruptedMinutes:
				input.breakPolicySnapshot.regulation.maxUninterruptedMinutes,
			breakRules,
		},
	});
	if (calculation.deficit === 0 || !calculation.applicableRule) {
		return { kind: "not_required" };
	}

	const timezone = isValidIanaTimezone(source.clockOutTimezone)
		? source.clockOutTimezone
		: isValidIanaTimezone(source.employeeTimezone)
			? source.employeeTimezone
			: fail();
	const sourceStart = instantFromDate(source.startTime);
	const sourceEnd = instantFromDate(source.endTime);
	const localDayStart = sourceEnd.toZonedDateTimeISO(timezone).startOfDay();
	const localDayEnd = localDayStart.add({ days: 1 });
	const gapResult = await db.execute(sql`
		select start_time as "gapStart", end_time as "gapEnd"
		from work_period
		where organization_id = ${input.organizationId}
			and employee_id = ${input.employeeId}::uuid
			and approval_status = 'approved'
			and is_active = false
			and deleted_at is null
			and end_time is not null
			and start_time >= ${dateFromInstant(localDayStart.toInstant())}
			and start_time < ${dateFromInstant(localDayEnd.toInstant())}
			and start_time <= ${source.endTime}
		order by start_time, id
		for update
	`);
	let alreadyTakenBreakMinutes = 0;
	let previousEnd: Instant | null = null;
	for (const value of rows(gapResult)) {
		const period = object(value);
		if (
			!(period.gapStart instanceof Date) ||
			!(period.gapEnd instanceof Date)
		) {
			return fail();
		}
		const gapStart = instantFromDate(period.gapStart);
		const gapEnd = instantFromDate(period.gapEnd);
		if (compareInstants(gapEnd, gapStart) < 0) return fail();
		if (compareInstants(gapStart, sourceEnd) > 0) break;
		const boundedGapEnd =
			compareInstants(gapEnd, sourceEnd) > 0 ? sourceEnd : gapEnd;
		if (previousEnd && compareInstants(gapStart, previousEnd) > 0) {
			const gapMinutes = Math.floor(
				gapStart.since(previousEnd).total({ unit: "minutes" }),
			);
			if (gapMinutes > 1) alreadyTakenBreakMinutes += gapMinutes;
		}
		if (!previousEnd || compareInstants(boundedGapEnd, previousEnd) > 0) {
			previousEnd = boundedGapEnd;
		}
	}

	const finalCalculation = calculateBreakDeficit({
		sessionDurationMinutes: source.durationMinutes,
		alreadyTakenBreakMinutes,
		regulation: {
			id: calculation.regulationId ?? fail(),
			name: calculation.regulationName ?? fail(),
			maxUninterruptedMinutes: calculation.maxUninterruptedMinutes,
			breakRules,
		},
	});
	if (finalCalculation.deficit === 0 || !finalCalculation.applicableRule) {
		return { kind: "not_required" };
	}

	const insertAfterMinutes = finalCalculation.maxUninterruptedMinutes
		? Math.min(
				finalCalculation.maxUninterruptedMinutes,
				finalCalculation.applicableRule.workingMinutesThreshold,
			)
		: finalCalculation.applicableRule.workingMinutesThreshold;
	if (!Number.isSafeInteger(insertAfterMinutes) || insertAfterMinutes <= 0) {
		return fail();
	}
	const breakStart = sourceStart.add({ minutes: insertAfterMinutes });
	const breakEnd = breakStart.add({ minutes: finalCalculation.deficit });
	if (
		compareInstants(breakStart, sourceStart) <= 0 ||
		compareInstants(breakStart, sourceEnd) >= 0 ||
		compareInstants(breakEnd, sourceStart) <= 0 ||
		compareInstants(breakEnd, sourceEnd) >= 0
	) {
		return fail();
	}
	const adjustedTotal = source.durationMinutes - finalCalculation.deficit;
	const firstDurationMinutes = insertAfterMinutes;
	const secondDurationMinutes = adjustedTotal - firstDurationMinutes;
	if (
		!Number.isSafeInteger(adjustedTotal) ||
		!Number.isSafeInteger(firstDurationMinutes) ||
		!Number.isSafeInteger(secondDurationMinutes) ||
		adjustedTotal <= 0 ||
		firstDurationMinutes <= 0 ||
		secondDurationMinutes <= 0
	) {
		return fail();
	}

	const chainResult = await db.execute(sql`
		select id as "latestId", hash as "latestHash"
		from time_entry
		where organization_id = ${input.organizationId}
			and employee_id = ${input.employeeId}::uuid
		order by created_at desc, id desc
		limit 2
		for update
	`);
	const chainRows = rows(chainResult);
	if (chainRows.length < 1 || chainRows.length > 2) return fail();
	const latest = object(chainRows[0]);
	if (
		typeof latest.latestId !== "string" ||
		typeof latest.latestHash !== "string"
	) {
		return fail();
	}

	const breakStartDate = dateFromInstant(breakStart);
	const breakEndDate = dateFromInstant(breakEnd);
	const breakStartCapture = resolveFallbackTimezoneCapture({
		timestamp: breakStartDate,
		timezone,
		timezoneSource: "historical_inference",
	});
	const breakEndCapture = resolveFallbackTimezoneCapture({
		timestamp: breakEndDate,
		timezone,
		timezoneSource: "historical_inference",
	});
	const syntheticClockOutId = randomUUID();
	const syntheticClockInId = randomUUID();
	const secondRecordId = randomUUID();
	const secondPeriodId = randomUUID();
	const syntheticClockOutHash = calculateHash({
		employeeId: input.employeeId,
		type: "clock_out",
		timestamp: breakStartDate.toISOString(),
		previousHash: latest.latestHash,
	});
	const syntheticClockInHash = calculateHash({
		employeeId: input.employeeId,
		type: "clock_in",
		timestamp: breakEndDate.toISOString(),
		previousHash: syntheticClockOutHash,
	});
	const adjustedAt = dateFromInstant(input.adjustedAt);
	const secondEntryCreatedAt = dateFromInstant(
		input.adjustedAt.add({ milliseconds: 1 }),
	);
	const note = "Auto-adjusted: break enforcement";
	const adjustmentReason = JSON.stringify({
		type: "break_enforcement",
		regulationId: finalCalculation.regulationId,
		regulationName: finalCalculation.regulationName,
		breakInsertedMinutes: finalCalculation.deficit,
		breakInsertedAt: breakStart.toString(),
		originalDurationMinutes: source.durationMinutes,
		adjustedDurationMinutes: adjustedTotal,
		ruleApplied: finalCalculation.applicableRule,
	});

	const insertedClockOut = await db.execute(sql`
		insert into time_entry (
			id, organization_id, employee_id, type, timestamp,
			utc_offset_minutes, timezone, timezone_source,
			previous_entry_id, hash, previous_hash, notes,
			ip_address, device_info, created_at, created_by
		) values (
			${syntheticClockOutId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			${"clock_out"}, ${breakStartDate}, ${breakStartCapture.utcOffsetMinutes},
			${breakStartCapture.timezone}, ${breakStartCapture.timezoneSource},
			${latest.latestId}::uuid, ${syntheticClockOutHash}, ${latest.latestHash}, ${note},
			${"system"}, ${"break-enforcement"}, ${adjustedAt}, ${input.actorUserId}
		)
		returning id
	`);
	exactWrite(rows(insertedClockOut), syntheticClockOutId);
	const insertedClockIn = await db.execute(sql`
		insert into time_entry (
			id, organization_id, employee_id, type, timestamp,
			utc_offset_minutes, timezone, timezone_source,
			previous_entry_id, hash, previous_hash, notes,
			ip_address, device_info, created_at, created_by
		) values (
			${syntheticClockInId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			${"clock_in"}, ${breakEndDate}, ${breakEndCapture.utcOffsetMinutes},
			${breakEndCapture.timezone}, ${breakEndCapture.timezoneSource},
			${syntheticClockOutId}::uuid, ${syntheticClockInHash}, ${syntheticClockOutHash}, ${note},
			${"system"}, ${"break-enforcement"}, ${secondEntryCreatedAt}, ${input.actorUserId}
		)
		returning id
	`);
	exactWrite(rows(insertedClockIn), syntheticClockInId);

	const workflowPredicate = source.approvalWorkflowId
		? sql`approval_workflow_id = ${source.approvalWorkflowId}::uuid`
		: sql`approval_workflow_id is null`;
	const updatedPeriod = await db.execute(sql`
		update work_period set
			clock_out_id = ${syntheticClockOutId}::uuid,
			end_time = ${breakStartDate},
			duration_minutes = ${firstDurationMinutes},
			was_auto_adjusted = true,
			auto_adjustment_reason = ${adjustmentReason},
			auto_adjusted_at = ${adjustedAt},
			original_end_time = ${source.endTime},
			original_duration_minutes = ${source.durationMinutes},
			updated_at = ${adjustedAt}
		where id = ${source.id}::uuid
			and organization_id = ${input.organizationId}
			and employee_id = ${input.employeeId}::uuid
			and clock_in_id = ${source.clockInId}::uuid
			and clock_out_id = ${source.clockOutId}::uuid
			and canonical_record_id = ${source.canonicalRecordId}::uuid
			and ${workflowPredicate}
			and start_time = ${source.startTime}
			and end_time = ${source.endTime}
			and duration_minutes = ${source.durationMinutes}
			and approval_status = 'approved'
			and pending_changes is null
			and is_active = false
			and deleted_at is null
			and was_auto_adjusted = false
			and original_end_time is null
			and original_duration_minutes is null
		returning id
	`);
	exactWrite(rows(updatedPeriod), source.id);

	const updatedRecord = await db.execute(sql`
		update time_record set
			end_at = ${breakStartDate},
			duration_minutes = ${firstDurationMinutes},
			updated_at = ${adjustedAt},
			updated_by = ${input.actorUserId}
		where id = ${source.canonicalRecordId}::uuid
			and organization_id = ${input.organizationId}
			and employee_id = ${input.employeeId}::uuid
			and record_kind = 'work'
			and origin = 'clock'
			and start_at = ${source.startTime}
			and end_at = ${source.endTime}
			and duration_minutes = ${source.durationMinutes}
			and approval_state = 'approved'
		returning id
	`);
	exactWrite(rows(updatedRecord), source.canonicalRecordId);

	const insertedRecord = await db.execute(sql`
		insert into time_record (
			id, organization_id, employee_id, record_kind, start_at, end_at,
			duration_minutes, approval_state, origin, created_at, created_by,
			updated_at, updated_by
		) values (
			${secondRecordId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			'work', ${breakEndDate}, ${source.endTime}, ${secondDurationMinutes},
			'approved', 'clock', ${adjustedAt}, ${input.actorUserId},
			${adjustedAt}, ${input.actorUserId}
		)
		returning id
	`);
	exactWrite(rows(insertedRecord), secondRecordId);
	const insertedWork = await db.execute(sql`
		insert into time_record_work (
			record_id, organization_id, record_kind, work_category_id,
			work_location_type, computation_metadata
		) values (
			${secondRecordId}::uuid, ${input.organizationId}, 'work',
			${source.canonicalWorkCategoryId}::uuid, ${source.canonicalWorkLocationType},
			${source.computationMetadata}
		)
		returning record_id as id
	`);
	exactWrite(rows(insertedWork), secondRecordId);

	for (const allocationValue of source.allocations) {
		const allocation = validateAllocation(allocationValue);
		const allocationId = randomUUID();
		const insertedAllocation = await db.execute(sql`
			insert into time_record_allocation (
				id, organization_id, record_id, allocation_kind,
				project_id, cost_center_id, weight_percent, created_at
			) values (
				${allocationId}::uuid, ${input.organizationId}, ${secondRecordId}::uuid,
				${allocation.allocationKind}, ${allocation.projectId}::uuid,
				${allocation.costCenterId}::uuid, ${allocation.weightPercent}, ${adjustedAt}
			)
			returning id
		`);
		exactWrite(rows(insertedAllocation), allocationId);
	}

	const insertedPeriod = await db.execute(sql`
		insert into work_period (
			id, organization_id, employee_id, clock_in_id, clock_out_id,
			project_id, work_category_id, work_location_type,
			start_time, end_time, duration_minutes, is_active,
			approval_status, pending_changes, was_auto_adjusted,
			auto_adjustment_reason, auto_adjusted_at,
			original_end_time, original_duration_minutes,
			canonical_record_id, approval_workflow_id, created_at, updated_at
		) values (
			${secondPeriodId}::uuid, ${input.organizationId}, ${input.employeeId}::uuid,
			${syntheticClockInId}::uuid, ${source.clockOutId}::uuid,
			${source.projectId}::uuid, ${source.workCategoryId}::uuid,
			${source.workLocationType}, ${breakEndDate}, ${source.endTime},
			${secondDurationMinutes}, false, 'approved', ${null}, true,
			${adjustmentReason}, ${adjustedAt}, ${null}, ${null},
			${secondRecordId}::uuid, ${null}, ${adjustedAt}, ${adjustedAt}
		)
		returning id
	`);
	exactWrite(rows(insertedPeriod), secondPeriodId);

	return { kind: "adjusted", breakMinutes: finalCalculation.deficit };
}

export const enforcePolicyClockOutTerminalBreakInTransaction =
	applyPolicyClockOutTerminalBreakInTransaction;
