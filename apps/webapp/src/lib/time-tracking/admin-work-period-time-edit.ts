import "server-only";

import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalWorkflow,
	employee,
	timeEntry,
	timeRecord,
	workPeriod,
} from "@/db/schema";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import { compareInstants } from "@/lib/datetime/temporal-core";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import {
	dirtyFromDateForTimeCorrection,
	instantFromTimeCorrectionBoundary,
	validateTimeCorrectionRange,
} from "@/lib/time-tracking/time-correction-temporal";
import {
	resolveFallbackTimezoneCapture,
	type TimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AdminWorkPeriodTimeEditInput {
	organizationId: string;
	actorUserId: string;
	workPeriodId: string;
	/** Snapshot the caller validated against; the edit fails if the period changed since. */
	expected: {
		employeeId: string;
		clockInId: string;
		clockOutId: string;
		startTime: Date;
		endTime: Date;
	};
	clockIn: Date;
	clockOut: Date;
	/** Timezone the wall-clock values were entered in (the entry owner's timezone). */
	timezone: string;
	timezoneSource: "user_setting" | "manager_target_user_setting";
	notes: string;
	ipAddress: string;
	deviceInfo: string;
}

export interface AdminWorkPeriodTimeEditResult {
	workPeriodId: string;
	employeeId: string;
	dirtyFromDate: string | null;
}

async function lockActorAndTarget(
	tx: Transaction,
	input: AdminWorkPeriodTimeEditInput,
) {
	// Global lock order: employees by ascending ID, then membership, then the work period.
	const lockedEmployees = await tx
		.select({
			id: employee.id,
			userId: employee.userId,
			isActive: employee.isActive,
		})
		.from(employee)
		.where(
			and(
				eq(employee.organizationId, input.organizationId),
				or(
					eq(employee.id, input.expected.employeeId),
					eq(employee.userId, input.actorUserId),
				),
			),
		)
		.orderBy(asc(employee.id))
		.for("update");
	const target = lockedEmployees.find(
		({ id }) => id === input.expected.employeeId,
	);
	if (!target?.isActive) {
		throw new NotFoundError({
			message: "Employee not found in organization",
			entityType: "employee",
			entityId: input.expected.employeeId,
		});
	}

	const [actorMembership] = await tx
		.select({ role: member.role })
		.from(member)
		.where(
			and(
				eq(member.userId, input.actorUserId),
				eq(member.organizationId, input.organizationId),
				eq(member.status, "approved"),
			),
		)
		.for("update");
	if (
		!actorMembership ||
		!(
			hasOrganizationRole(actorMembership.role, "owner") ||
			hasOrganizationRole(actorMembership.role, "admin")
		)
	) {
		throw new AuthorizationError({
			message: "Only organization owners and admins can edit this time entry",
			userId: input.actorUserId,
			resource: "time_entry",
			action: "correct",
		});
	}
}

async function lockExpectedWorkPeriod(
	tx: Transaction,
	input: AdminWorkPeriodTimeEditInput,
) {
	const [period] = await tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.organizationId, input.organizationId),
				eq(workPeriod.employeeId, input.expected.employeeId),
				isNull(workPeriod.deletedAt),
			),
		)
		.for("update");
	if (!period) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: input.workPeriodId,
		});
	}
	if (
		period.clockInId !== input.expected.clockInId ||
		period.clockOutId !== input.expected.clockOutId ||
		!period.endTime ||
		compareInstants(
			instantFromTimeCorrectionBoundary(period.startTime),
			instantFromTimeCorrectionBoundary(input.expected.startTime),
		) !== 0 ||
		compareInstants(
			instantFromTimeCorrectionBoundary(period.endTime),
			instantFromTimeCorrectionBoundary(input.expected.endTime),
		) !== 0
	) {
		throw new ConflictError({
			message: "Work period changed while editing",
			conflictType: "time_correction_work_period_stale",
		});
	}
	if (period.approvalStatus === "pending") {
		throw new ConflictError({
			message: "This work period is awaiting approval and cannot be edited",
			conflictType: "work_period_pending_approval",
		});
	}

	const [legacyPending, canonicalPending] = await Promise.all([
		tx.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, period.id),
				eq(approvalRequest.status, "pending"),
			),
			columns: { id: true },
		}),
		tx.query.approvalWorkflow.findFirst({
			where: and(
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.workflowType, "time_correction"),
				eq(approvalWorkflow.sourceType, "time_entry"),
				eq(approvalWorkflow.sourceId, period.id),
				eq(approvalWorkflow.status, "pending"),
			),
			columns: { id: true },
		}),
	]);
	if (legacyPending || canonicalPending) {
		throw new ConflictError({
			message:
				"A time correction approval is already pending for this work period",
			conflictType: "pending_time_correction_approval",
		});
	}

	return period;
}

/**
 * Directly corrects both endpoints of a completed work period on behalf of an
 * organization owner/admin. Both endpoints are replaced in one transaction so an
 * entry can be moved across days without passing through an invalid intermediate
 * range. Original entries are superseded, never mutated, preserving the audit chain.
 */
export async function applyAdminWorkPeriodTimeEdit(
	input: AdminWorkPeriodTimeEditInput,
): Promise<AdminWorkPeriodTimeEditResult> {
	const newStart = instantFromTimeCorrectionBoundary(input.clockIn);
	const newEnd = instantFromTimeCorrectionBoundary(input.clockOut);
	try {
		validateTimeCorrectionRange(newStart, newEnd);
	} catch (error) {
		throw new ValidationError({
			message:
				error instanceof Error ? error.message : "Invalid work period range",
			field: "timestamp",
		});
	}
	const clockInChanged =
		compareInstants(
			newStart,
			instantFromTimeCorrectionBoundary(input.expected.startTime),
		) !== 0;
	const clockOutChanged =
		compareInstants(
			newEnd,
			instantFromTimeCorrectionBoundary(input.expected.endTime),
		) !== 0;
	if (!clockInChanged && !clockOutChanged) {
		throw new ValidationError({
			message: "At least one correction value must change",
			field: "correction",
		});
	}

	const captureFor = (timestamp: Date): TimeEntryTimezoneCapture =>
		resolveFallbackTimezoneCapture({
			timestamp,
			timezone: input.timezone,
			timezoneSource: input.timezoneSource,
		});
	const endpoints = [
		...(clockInChanged
			? [
					{
						originalEntryId: input.expected.clockInId,
						timestamp: input.clockIn,
						capture: captureFor(input.clockIn),
					},
				]
			: []),
		...(clockOutChanged
			? [
					{
						originalEntryId: input.expected.clockOutId,
						timestamp: input.clockOut,
						capture: captureFor(input.clockOut),
					},
				]
			: []),
	];

	const originalEntries = await db.transaction(async (tx) => {
		await lockActorAndTarget(tx, input);
		const period = await lockExpectedWorkPeriod(tx, input);

		const originals = await tx
			.select()
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, input.organizationId),
					eq(timeEntry.employeeId, period.employeeId),
					inArray(
						timeEntry.id,
						endpoints.map(({ originalEntryId }) => originalEntryId),
					),
				),
			)
			.for("update");
		if (
			originals.length !== endpoints.length ||
			originals.some((entry) => entry.isSuperseded)
		) {
			throw new ConflictError({
				message: "Time entry was already corrected by another process",
				conflictType: "time_entry_already_corrected",
			});
		}

		const [latestEntry] = await tx
			.select()
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.employeeId, period.employeeId),
					eq(timeEntry.organizationId, input.organizationId),
				),
			)
			.orderBy(desc(timeEntry.createdAt))
			.limit(1);
		let previousEntry = latestEntry ?? null;
		const replacementIds = new Map<string, string>();
		for (const endpoint of endpoints) {
			const previousHash = previousEntry?.hash ?? null;
			const [correction] = await tx
				.insert(timeEntry)
				.values({
					employeeId: period.employeeId,
					organizationId: input.organizationId,
					type: "correction",
					timestamp: endpoint.timestamp,
					hash: calculateHash({
						employeeId: period.employeeId,
						type: "correction",
						timestamp: endpoint.timestamp.toISOString(),
						previousHash,
					}),
					previousHash,
					previousEntryId: previousEntry?.id ?? null,
					replacesEntryId: endpoint.originalEntryId,
					notes: input.notes,
					ipAddress: input.ipAddress,
					deviceInfo: input.deviceInfo,
					createdBy: input.actorUserId,
					utcOffsetMinutes: endpoint.capture.utcOffsetMinutes,
					timezone: endpoint.capture.timezone,
					timezoneSource: endpoint.capture.timezoneSource,
				})
				.returning();
			if (!correction) {
				throw new Error("Correction entry insert failed");
			}
			const superseded = await tx
				.update(timeEntry)
				.set({ isSuperseded: true, supersededById: correction.id })
				.where(
					and(
						eq(timeEntry.id, endpoint.originalEntryId),
						eq(timeEntry.organizationId, input.organizationId),
						eq(timeEntry.employeeId, period.employeeId),
						eq(timeEntry.isSuperseded, false),
					),
				)
				.returning({ id: timeEntry.id });
			if (superseded.length !== 1) {
				throw new ConflictError({
					message: "Time entry was already corrected by another process",
					conflictType: "time_entry_already_corrected",
				});
			}
			replacementIds.set(endpoint.originalEntryId, correction.id);
			previousEntry = correction;
		}

		const durationMinutes = Math.floor(newStart.until(newEnd).total("minutes"));
		const updatedAt = new Date();
		const updatedPeriods = await tx
			.update(workPeriod)
			.set({
				clockInId:
					replacementIds.get(input.expected.clockInId) ??
					input.expected.clockInId,
				clockOutId:
					replacementIds.get(input.expected.clockOutId) ??
					input.expected.clockOutId,
				startTime: input.clockIn,
				endTime: input.clockOut,
				durationMinutes,
				updatedAt,
			})
			.where(
				and(
					eq(workPeriod.id, period.id),
					eq(workPeriod.organizationId, input.organizationId),
					eq(workPeriod.employeeId, period.employeeId),
					eq(workPeriod.clockInId, input.expected.clockInId),
					eq(workPeriod.clockOutId, input.expected.clockOutId),
					isNull(workPeriod.deletedAt),
				),
			)
			.returning({ id: workPeriod.id });
		if (updatedPeriods.length !== 1) {
			throw new ConflictError({
				message: "Work period changed while editing",
				conflictType: "time_correction_work_period_stale",
			});
		}

		if (period.canonicalRecordId) {
			await tx
				.update(timeRecord)
				.set({
					startAt: input.clockIn,
					endAt: input.clockOut,
					durationMinutes,
					updatedAt,
					updatedBy: input.actorUserId,
				})
				.where(
					and(
						eq(timeRecord.id, period.canonicalRecordId),
						eq(timeRecord.organizationId, input.organizationId),
						eq(timeRecord.employeeId, period.employeeId),
						eq(timeRecord.recordKind, "work"),
					),
				);
		}

		return originals;
	});

	const dirtyFromDate = dirtyFromDateForTimeCorrection([
		...originalEntries.map((entry) => ({
			instant: instantFromTimeCorrectionBoundary(entry.timestamp),
			...(entry.timezone && Number.isInteger(entry.utcOffsetMinutes)
				? {
						timezone: entry.timezone,
						utcOffsetMinutes: entry.utcOffsetMinutes as number,
					}
				: captureFor(entry.timestamp)),
		})),
		...endpoints.map((endpoint) => ({
			instant: instantFromTimeCorrectionBoundary(endpoint.timestamp),
			...endpoint.capture,
		})),
	]);

	return {
		workPeriodId: input.workPeriodId,
		employeeId: input.expected.employeeId,
		dirtyFromDate,
	};
}
