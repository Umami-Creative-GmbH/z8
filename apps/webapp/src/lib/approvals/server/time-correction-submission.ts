import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Effect } from "effect";
import {
	getCurrentEmployee,
	getCurrentSession,
	getRequestMetadata,
	getUserTimezone,
} from "@/app/[locale]/(app)/time-tracking/actions/auth";
import { getEditCapabilityForPeriod } from "@/app/[locale]/(app)/time-tracking/actions/policy-helpers";
import { logger } from "@/app/[locale]/(app)/time-tracking/actions/shared";
import { createCorrectionDateTime } from "@/app/[locale]/(app)/time-tracking/actions/time-utils";
import type {
	CorrectionRequest,
	SameDayEditRequest,
	TimeEntryDeletionRequest,
} from "@/app/[locale]/(app)/time-tracking/actions/types";
import { canonicalTimeEntryClient } from "@/app/[locale]/(app)/time-tracking/actions.canonical";
import { db } from "@/db";
import { member } from "@/db/auth-schema";
import {
	approvalRequest,
	approvalWorkflow,
	employee,
	timeEntry,
	timeRecord,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import {
	deriveLegacyTimeCorrectionSubmissionKey,
	deriveTimeCorrectionSubmissionKey,
	type TimeCorrectionEndpointEvidence,
} from "@/lib/approvals/domain-adapters/time-correction-contract";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { mapSequentially } from "@/lib/approvals/sequential";
import {
	deleteCancelledTimeCorrectionsInTransaction,
	executeTimeCorrectionSubmissionInTransaction,
	finalizeTimeCorrectionTerminalInTransaction,
	insertTimeCorrectionSourceEntry,
	runAutoCompletedTimeCorrectionMaintenance,
	type TimeCorrectionPostCommitEffects,
} from "@/lib/approvals/server/time-correction-approvals";
import {
	authorizeTimeCorrectionCategoryChange,
	lockTrustedTimeCorrectionEmployeeTeamId,
} from "@/lib/approvals/server/time-correction-category-authorization";
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "@/lib/approvals/server/work-period-approvals";
import {
	deriveApprovalWorkflowId,
	deriveTimeCorrectionRowId,
} from "@/lib/approvals/workflow/identity";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import {
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import { compareInstants, systemClock } from "@/lib/datetime/temporal-core";
import { getInstantLocalMinuteFields } from "@/lib/datetime/temporal-format";
import {
	ConflictError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import {
	DatabaseService,
	DatabaseServiceLive,
} from "@/lib/effect/services/database.service";
import { EmailService } from "@/lib/effect/services/email.service";
import { renderTimeCorrectionPendingApproval } from "@/lib/email/render";
import { calculateHash } from "@/lib/time-tracking/blockchain";
import {
	dirtyFromDateForTimeCorrection,
	instantFromTimeCorrectionBoundary,
	validateTimeCorrectionRange,
	validateTimeCorrectionTimezoneEvidence,
} from "@/lib/time-tracking/time-correction-temporal";
import {
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
	type TimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import {
	isWorkLocationType,
	normalizeWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";

type CorrectionTimesResult =
	| {
			correctedClockInDate: Date;
			correctedClockOutDate?: Date;
	  }
	| {
			error: string;
	  };

type WorkBalanceDirtyInput = Parameters<typeof markEmployeeWorkBalanceDirty>[0];

async function markWorkBalanceDirtyAfterSameDayEditBestEffort(
	input: WorkBalanceDirtyInput,
	context: Record<string, unknown>,
) {
	try {
		await markEmployeeWorkBalanceDirty(input);
	} catch (error) {
		logger.error(
			{ error, ...context },
			"Failed to mark work balance dirty after same-day edit",
		);
	}
}

type ManagerResolverDb = Parameters<
	typeof getPrimaryEligibleManagerIdForRequester
>[0]["db"];

export async function resolveCorrectionApprovalManager(input: {
	db: ManagerResolverDb;
	requesterEmployeeId: string;
	organizationId: string;
}): Promise<
	| { ok: true; managerId: string }
	| {
			ok: false;
			message: "No manager assigned to approve corrections";
			field: "managerId";
	  }
> {
	const managerId = await getPrimaryEligibleManagerIdForRequester(input);

	return managerId
		? { ok: true, managerId }
		: {
				ok: false,
				message: "No manager assigned to approve corrections",
				field: "managerId",
			};
}

function buildCorrectionTimes(params: {
	newClockInDate: string;
	newClockInTime: string;
	newClockOutDate?: string;
	newClockOutTime?: string;
	timezone: string;
}): CorrectionTimesResult {
	const correctedClockInDate = createCorrectionDateTime({
		date: params.newClockInDate,
		time: params.newClockInTime,
		timezone: params.timezone,
	});

	if (!correctedClockInDate) {
		return { error: "Invalid clock in date or time" } as const;
	}

	if (params.newClockOutDate || params.newClockOutTime) {
		if (!params.newClockOutDate || !params.newClockOutTime) {
			return { error: "Invalid clock out date or time" } as const;
		}
	}

	const correctedClockOutDate =
		params.newClockOutDate && params.newClockOutTime
			? (createCorrectionDateTime({
					date: params.newClockOutDate,
					time: params.newClockOutTime,
					timezone: params.timezone,
				}) ?? undefined)
			: undefined;

	if (
		params.newClockOutDate &&
		params.newClockOutTime &&
		!correctedClockOutDate
	) {
		return { error: "Invalid clock out date or time" } as const;
	}

	return { correctedClockInDate, correctedClockOutDate } as const;
}

function hasSubmittedEndpointMinuteChanged(params: {
	original: Date;
	date: string;
	time: string;
	timezone: string;
}): boolean {
	const original = getInstantLocalMinuteFields(
		instantFromTimeCorrectionBoundary(params.original),
		params.timezone,
	);
	return original.date !== params.date || original.time !== params.time;
}

export async function editSameDayTimeEntry(
	data: SameDayEditRequest,
): Promise<
	ServerActionResult<{ workPeriodId: string; requiresApproval?: boolean }>
> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const [timezone, [selectedWorkPeriod]] = await Promise.all([
		getUserTimezone(session.user.id),
		db
			.select()
			.from(workPeriod)
			.where(
				and(
					eq(workPeriod.id, data.workPeriodId),
					eq(workPeriod.employeeId, currentEmployee.id),
					eq(workPeriod.organizationId, currentEmployee.organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.limit(1),
	]);

	if (!selectedWorkPeriod) {
		return { success: false, error: "Work period not found" };
	}

	if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
		return { success: false, error: "You can only edit your own time entries" };
	}

	if (!selectedWorkPeriod.endTime) {
		return {
			success: false,
			error: "Cannot edit an active work period. Please clock out first.",
		};
	}

	const pendingTimeCorrectionApproval =
		await db.query.approvalRequest.findFirst({
			where: and(
				eq(approvalRequest.organizationId, currentEmployee.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, selectedWorkPeriod.id),
				eq(approvalRequest.status, "pending"),
			),
		});

	if (pendingTimeCorrectionApproval) {
		return {
			success: false,
			error:
				"A time correction approval is already pending for this work period",
			code: "pending_time_correction_approval",
		};
	}

	let editCapability: Awaited<ReturnType<typeof getEditCapabilityForPeriod>>;
	try {
		editCapability = await getEditCapabilityForPeriod({
			employeeId: currentEmployee.id,
			workPeriodEndTime: selectedWorkPeriod.endTime,
			timezone,
		});
	} catch (error) {
		logger.error({ error }, "Failed to check edit capability");
		return {
			success: false,
			error: "Failed to verify edit policy. Please try again.",
		};
	}

	if (editCapability.type === "forbidden") {
		return {
			success: false,
			error: `Entries older than ${editCapability.daysBack} days can only be edited by admins or team leads.`,
		};
	}

	if (editCapability.type === "approval_required") {
		return {
			success: false,
			error:
				"This edit requires manager approval. Please use the correction request.",
			requiresApproval: true,
		} as ServerActionResult<{
			workPeriodId: string;
			requiresApproval?: boolean;
		}>;
	}

	const originalClockIn = getInstantLocalMinuteFields(
		instantFromTimeCorrectionBoundary(selectedWorkPeriod.startTime),
		timezone,
	);
	const originalClockOut = getInstantLocalMinuteFields(
		instantFromTimeCorrectionBoundary(selectedWorkPeriod.endTime),
		timezone,
	);
	if (
		data.newClockInDate !== originalClockIn.date ||
		(data.newClockOutDate && data.newClockOutDate !== originalClockOut.date)
	) {
		return { success: false, error: "Date changes require manager approval" };
	}

	const correctionTimes = buildCorrectionTimes({
		newClockInDate: data.newClockInDate,
		newClockInTime: data.newClockInTime,
		newClockOutDate: data.newClockOutDate,
		newClockOutTime: data.newClockOutTime,
		timezone,
	});

	if ("error" in correctionTimes) {
		return { success: false, error: correctionTimes.error };
	}

	const { correctedClockInDate, correctedClockOutDate } = correctionTimes;
	const clockInChanged = hasSubmittedEndpointMinuteChanged({
		original: selectedWorkPeriod.startTime,
		date: data.newClockInDate,
		time: data.newClockInTime,
		timezone,
	});
	const clockOutChanged = Boolean(
		correctedClockOutDate &&
			selectedWorkPeriod.endTime &&
			data.newClockOutDate &&
			data.newClockOutTime &&
			hasSubmittedEndpointMinuteChanged({
				original: selectedWorkPeriod.endTime,
				date: data.newClockOutDate,
				time: data.newClockOutTime,
				timezone,
			}),
	);
	const metadataChanged =
		data.workLocationType !==
			normalizeWorkLocationType(selectedWorkPeriod.workLocationType) ||
		data.workCategoryId !== selectedWorkPeriod.workCategoryId;
	if (!clockInChanged && !clockOutChanged && !metadataChanged) {
		return {
			success: false,
			error: "At least one correction value must change",
		};
	}
	const now = new Date();

	if (clockInChanged && correctedClockInDate > now) {
		return { success: false, error: "Clock in time cannot be in the future" };
	}

	if (clockOutChanged && correctedClockOutDate && correctedClockOutDate > now) {
		return { success: false, error: "Clock out time cannot be in the future" };
	}

	const effectiveClockIn = clockInChanged
		? correctedClockInDate
		: selectedWorkPeriod.startTime;
	const effectiveClockOut = clockOutChanged
		? correctedClockOutDate
		: selectedWorkPeriod.endTime;
	if (effectiveClockOut && effectiveClockOut <= effectiveClockIn) {
		return {
			success: false,
			error: "Clock out time must be after clock in time",
		};
	}

	const validation = await validateTimeEntryRange(
		currentEmployee.organizationId,
		effectiveClockIn,
		effectiveClockOut || effectiveClockIn,
		timezone,
	);

	if (!validation.isValid) {
		return {
			success: false,
			error: validation.error || "Cannot update time entry for this period",
			holidayName: validation.holidayName,
		};
	}
	const billingAccess = await requireBillingForMutation(
		currentEmployee.organizationId,
	);
	if (!isBillingMutationAllowed(billingAccess)) {
		return {
			success: false,
			error: "billing_required",
			code: billingAccess.reason ?? "subscription_required",
		};
	}

	try {
		const notes = data.reason || "Same-day edit";
		const clockInTimezoneCapture = clockInChanged
			? resolveFallbackTimezoneCapture({
					timestamp: correctedClockInDate,
					timezone,
					timezoneSource: "user_setting",
				})
			: null;
		const correctsClockOut = Boolean(
			clockOutChanged && selectedWorkPeriod.clockOutId && correctedClockOutDate,
		);
		const clockOutTimezoneCapture = correctsClockOut
			? resolveFallbackTimezoneCapture({
					timestamp: correctedClockOutDate as Date,
					timezone,
					timezoneSource: "user_setting",
				})
			: null;
		const affectedOriginalIds = [
			...(clockInChanged ? [selectedWorkPeriod.clockInId] : []),
			...(correctsClockOut && selectedWorkPeriod.clockOutId
				? [selectedWorkPeriod.clockOutId]
				: []),
		];
		const originalEntries = affectedOriginalIds.length
			? await db.query.timeEntry.findMany({
					where: and(
						eq(timeEntry.employeeId, currentEmployee.id),
						eq(timeEntry.organizationId, currentEmployee.organizationId),
						inArray(timeEntry.id, affectedOriginalIds),
					),
				})
			: [];
		if (
			originalEntries.length !== affectedOriginalIds.length ||
			new Set(originalEntries.map(({ id }) => id)).size !==
				affectedOriginalIds.length
		) {
			throw new Error("Affected original time entries were not found");
		}
		const originalEndpointEvidence = originalEntries.map((entry) => {
			const capture =
				entry.timezone && Number.isInteger(entry.utcOffsetMinutes)
					? {
							timezone: entry.timezone,
							utcOffsetMinutes: entry.utcOffsetMinutes as number,
						}
					: resolveFallbackTimezoneCapture({
							timestamp: entry.timestamp,
							timezone: entry.timezone ?? timezone,
							timezoneSource: "user_setting",
						});
			return {
				instant: instantFromTimeCorrectionBoundary(entry.timestamp),
				...capture,
			};
		});
		const { clockInCorrectionId, clockOutCorrectionId } = await db.transaction(
			async (tx) => {
				const lockedEmployees = await tx
					.select()
					.from(employee)
					.where(
						and(
							eq(employee.id, currentEmployee.id),
							eq(employee.userId, session.user.id),
							eq(employee.organizationId, currentEmployee.organizationId),
							eq(employee.isActive, true),
						),
					)
					.orderBy(asc(employee.id))
					.limit(2)
					.for("update");
				const lockedEmployee = lockedEmployees[0];
				if (lockedEmployees.length !== 1 || !lockedEmployee) {
					throw new ConflictError({
						message: "Employee changed while editing",
						conflictType: "time_correction_employee_stale",
					});
				}
				const lockedTeamId = await lockTrustedTimeCorrectionEmployeeTeamId({
					tx,
					employeeId: lockedEmployee.id,
					employeeTeamId: lockedEmployee.teamId,
					organizationId: currentEmployee.organizationId,
				});
				const lockedPeriods = await tx
					.select()
					.from(workPeriod)
					.where(
						and(
							eq(workPeriod.id, selectedWorkPeriod.id),
							eq(workPeriod.employeeId, currentEmployee.id),
							eq(workPeriod.organizationId, currentEmployee.organizationId),
							isNull(workPeriod.deletedAt),
						),
					)
					.limit(2)
					.for("update");
				const lockedPeriod = lockedPeriods[0];
				if (
					lockedPeriods.length !== 1 ||
					!lockedPeriod ||
					lockedPeriod.clockInId !== selectedWorkPeriod.clockInId ||
					lockedPeriod.clockOutId !== selectedWorkPeriod.clockOutId ||
					lockedPeriod.startTime.getTime() !==
						selectedWorkPeriod.startTime.getTime() ||
					lockedPeriod.endTime?.getTime() !==
						selectedWorkPeriod.endTime?.getTime() ||
					lockedPeriod.workLocationType !==
						selectedWorkPeriod.workLocationType ||
					lockedPeriod.workCategoryId !== selectedWorkPeriod.workCategoryId
				) {
					throw new ConflictError({
						message: "Work period changed while editing",
						conflictType: "time_correction_work_period_stale",
					});
				}
				const proposedMetadata = await validateCorrectionWorkMetadata({
					tx,
					employeeId: lockedEmployee.id,
					teamId: lockedTeamId,
					organizationId: currentEmployee.organizationId,
					workLocationType: data.workLocationType,
					workCategoryId: data.workCategoryId,
					currentWorkCategoryId: lockedPeriod.workCategoryId,
				});
				const lockedMetadataChanged =
					proposedMetadata.workLocationType !==
						normalizeWorkLocationType(lockedPeriod.workLocationType) ||
					proposedMetadata.workCategoryId !== lockedPeriod.workCategoryId;
				if (!clockInChanged && !clockOutChanged && !lockedMetadataChanged) {
					throw new ValidationError({
						message: "At least one correction value must change",
						field: "correction",
					});
				}
				if (lockedMetadataChanged) {
					if (!lockedPeriod.canonicalRecordId) {
						throw new Error("Canonical work record is missing");
					}
					const canonicalRecords = await tx
						.select()
						.from(timeRecord)
						.where(
							and(
								eq(timeRecord.id, lockedPeriod.canonicalRecordId),
								eq(timeRecord.organizationId, currentEmployee.organizationId),
								eq(timeRecord.employeeId, currentEmployee.id),
								eq(timeRecord.recordKind, "work"),
							),
						)
						.limit(2)
						.for("update");
					const canonicalWorkRows = await tx
						.select()
						.from(timeRecordWork)
						.where(
							and(
								eq(timeRecordWork.recordId, lockedPeriod.canonicalRecordId),
								eq(
									timeRecordWork.organizationId,
									currentEmployee.organizationId,
								),
								eq(timeRecordWork.recordKind, "work"),
							),
						)
						.limit(2)
						.for("update");
					if (canonicalRecords.length !== 1 || canonicalWorkRows.length !== 1) {
						throw new Error("Canonical work record invariant failed");
					}
					const canonicalWorkRow = canonicalWorkRows[0];
					if (
						!canonicalWorkRow ||
						canonicalWorkRow.workLocationType !==
							lockedPeriod.workLocationType ||
						canonicalWorkRow.workCategoryId !== lockedPeriod.workCategoryId
					) {
						throw new ConflictError({
							message: "Canonical work metadata diverges from work period",
							conflictType: "time_correction_work_metadata_diverged",
						});
					}
				}

				let clockInCorrectionId: string | undefined;
				if (clockInChanged) {
					if (!clockInTimezoneCapture) {
						throw new Error("Clock-in timezone evidence is required");
					}
					const clockInCorrection =
						await canonicalTimeEntryClient.createCorrectionEntry(
							{
								employeeId: currentEmployee.id,
								organizationId: currentEmployee.organizationId,
								workPeriodId: selectedWorkPeriod.id,
								timestamp: correctedClockInDate,
								createdBy: session.user.id,
								...clockInTimezoneCapture,
								replacesEntryId: selectedWorkPeriod.clockInId,
								notes,
							},
							tx,
						);
					if (!clockInCorrection) {
						throw new Error("Clock-in correction entry was not created");
					}
					clockInCorrectionId = clockInCorrection.id;
				}

				let clockOutCorrectionId: string | undefined;
				if (
					correctsClockOut &&
					selectedWorkPeriod.clockOutId &&
					correctedClockOutDate
				) {
					if (!clockOutTimezoneCapture) {
						throw new Error("Clock-out timezone evidence is required");
					}
					const clockOutCorrection =
						await canonicalTimeEntryClient.createCorrectionEntry(
							{
								employeeId: currentEmployee.id,
								organizationId: currentEmployee.organizationId,
								workPeriodId: selectedWorkPeriod.id,
								timestamp: correctedClockOutDate,
								createdBy: session.user.id,
								...clockOutTimezoneCapture,
								replacesEntryId: selectedWorkPeriod.clockOutId,
								notes,
							},
							tx,
						);
					if (!clockOutCorrection) {
						throw new Error("Clock-out correction entry was not created");
					}
					clockOutCorrectionId = clockOutCorrection.id;
				}

				if (lockedMetadataChanged) {
					const canonicalRecordId = lockedPeriod.canonicalRecordId;
					if (!canonicalRecordId) {
						throw new Error("Canonical work record is missing");
					}
					const metadata = {
						workLocationType: proposedMetadata.workLocationType,
						workCategoryId: proposedMetadata.workCategoryId,
					};
					const updatedPeriods = await tx
						.update(workPeriod)
						.set(metadata)
						.where(
							and(
								eq(workPeriod.id, lockedPeriod.id),
								eq(workPeriod.employeeId, currentEmployee.id),
								eq(workPeriod.organizationId, currentEmployee.organizationId),
								isNull(workPeriod.deletedAt),
							),
						)
						.returning({ id: workPeriod.id });
					if (updatedPeriods.length !== 1) {
						throw new Error("Work period metadata update failed");
					}
					const updatedCanonicalRows = await tx
						.update(timeRecordWork)
						.set(metadata)
						.where(
							and(
								eq(timeRecordWork.recordId, canonicalRecordId),
								eq(
									timeRecordWork.organizationId,
									currentEmployee.organizationId,
								),
								eq(timeRecordWork.recordKind, "work"),
							),
						)
						.returning({ recordId: timeRecordWork.recordId });
					if (updatedCanonicalRows.length !== 1) {
						throw new Error("Canonical work metadata update failed");
					}
				}

				return {
					clockInCorrectionId,
					clockOutCorrectionId,
				};
			},
		);

		const dirtyFromDate = affectedOriginalIds.length
			? dirtyFromDateForTimeCorrection([
					...originalEndpointEvidence,
					...(clockInChanged && clockInTimezoneCapture
						? [
								{
									instant:
										instantFromTimeCorrectionBoundary(correctedClockInDate),
									...clockInTimezoneCapture,
								},
							]
						: []),
					...(correctedClockOutDate && clockOutTimezoneCapture
						? [
								{
									instant: instantFromTimeCorrectionBoundary(
										correctedClockOutDate,
									),
									...clockOutTimezoneCapture,
								},
							]
						: []),
				])
			: null;
		if (affectedOriginalIds.length) {
			await markWorkBalanceDirtyAfterSameDayEditBestEffort(
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					dirtyFromDate: dirtyFromDate ?? undefined,
				},
				{
					employeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
					workPeriodId: selectedWorkPeriod.id,
				},
			);
		}

		logger.info(
			{
				workPeriodId: data.workPeriodId,
				employeeId: currentEmployee.id,
				clockInCorrectionId,
				clockOutCorrectionId,
			},
			"Same-day time entry edited successfully",
		);

		return { success: true, data: { workPeriodId: selectedWorkPeriod.id } };
	} catch (error) {
		if (error instanceof ValidationError) {
			return { success: false, error: error.message };
		}
		logger.error({ error }, "Failed to edit same-day time entry");
		return {
			success: false,
			error: "Failed to update time entry. Please try again.",
		};
	}
}

export type ApprovalResult = {
	approvalRequestId: string;
	kind: "auto_completed" | "chain_created" | "default_created";
	disposition: "executed" | "replayed";
	postCommit: TimeCorrectionPostCommitEffects;
	correctionEntryIds: string[];
	correctionEntries?: (typeof timeEntry.$inferSelect)[];
	autoCompletion?: Parameters<
		typeof runAutoCompletedTimeCorrectionMaintenance
	>[0];
};

type SubmissionEndpoint = {
	endpointType: "clock_in" | "clock_out";
	originalEntryId: string;
	timestamp: Date;
	timezoneCapture: TimeEntryTimezoneCapture;
};

const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeCorrectionWorkMetadataInput(input: {
	workLocationType: unknown;
	workCategoryId: unknown;
}): {
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
} {
	if (
		typeof input.workLocationType !== "string" ||
		!isWorkLocationType(input.workLocationType)
	) {
		throw new ValidationError({
			message: "Invalid work location type",
			field: "workLocationType",
		});
	}
	if (input.workCategoryId === null) {
		return { workLocationType: input.workLocationType, workCategoryId: null };
	}
	if (
		typeof input.workCategoryId !== "string" ||
		!UUID.test(input.workCategoryId)
	) {
		throw new ValidationError({
			message: "Work category must be a valid UUID",
			field: "workCategoryId",
		});
	}
	return {
		workLocationType: input.workLocationType,
		workCategoryId: input.workCategoryId.toLowerCase(),
	};
}

async function validateCorrectionWorkMetadata(input: {
	tx: Pick<typeof db, "select">;
	employeeId: string;
	teamId: string | null;
	organizationId: string;
	workLocationType: unknown;
	workCategoryId: unknown;
	currentWorkCategoryId: string | null;
}): Promise<{
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
}> {
	const proposed = normalizeCorrectionWorkMetadataInput(input);
	if (
		proposed.workCategoryId === null ||
		proposed.workCategoryId === input.currentWorkCategoryId
	) {
		return proposed;
	}
	await authorizeTimeCorrectionCategoryChange({
		tx: input.tx,
		employeeId: input.employeeId,
		teamId: input.teamId,
		organizationId: input.organizationId,
		proposedWorkCategoryId: proposed.workCategoryId,
		currentWorkCategoryId: input.currentWorkCategoryId,
	});
	return proposed;
}

function validateSubmissionId(value: unknown): string {
	if (typeof value !== "string" || !UUID.test(value)) {
		throw new ValidationError({
			message: "Submission ID must be a valid UUID",
			field: "submissionId",
		});
	}
	return value.toLowerCase();
}

function transactionDbService(
	dbService: ApprovalDbService,
	transactionDb: ApprovalDbService["db"],
): ApprovalDbService {
	return { db: transactionDb, query: dbService.query };
}

function createCorrectionRuntime(dbService: ApprovalDbService) {
	return createProductionApprovalWorkflowRuntime({
		db: dbService.db,
		adapters: {
			absence: {
				clock: systemClock,
				finalizeAbsenceTerminal: async () => {
					throw new Error("Absence finalization is outside this boundary");
				},
				deleteCancelledAbsence: async () => {
					throw new Error("Absence cancellation is outside this boundary");
				},
			},
			timeCorrection: {
				clock: systemClock,
				finalizeTimeCorrectionTerminal:
					finalizeTimeCorrectionTerminalInTransaction,
				deleteCancelledCorrections: deleteCancelledTimeCorrectionsInTransaction,
			},
			ordinaryWorkPeriod: {
				finalizeTerminal:
					finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction,
			},
		},
		canManageApproval: async () => false,
		clock: systemClock,
	});
}

function endpointEvidence(
	endpoint: SubmissionEndpoint,
	correctionEntryId: string,
): TimeCorrectionEndpointEvidence {
	const instant = instantFromTimeCorrectionBoundary(endpoint.timestamp);
	validateTimeCorrectionTimezoneEvidence({
		instant,
		timezone: endpoint.timezoneCapture.timezone,
		utcOffsetMinutes: endpoint.timezoneCapture.utcOffsetMinutes,
	});
	return {
		endpointType: endpoint.endpointType,
		originalEntryId: endpoint.originalEntryId,
		correctionEntryId,
		instant,
		...endpoint.timezoneCapture,
	};
}

async function findPersistedCorrectionSubmissionKey(input: {
	tx: typeof db;
	organizationId: string;
	workPeriodId: string;
	candidates: string[];
}): Promise<string | null> {
	for (const candidate of input.candidates) {
		const workflowId = deriveApprovalWorkflowId({
			organizationId: input.organizationId,
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: input.workPeriodId,
			allocationKey: candidate,
		});
		const workflow = await input.tx.query.approvalWorkflow.findFirst({
			where: and(
				eq(approvalWorkflow.id, workflowId),
				eq(approvalWorkflow.organizationId, input.organizationId),
				eq(approvalWorkflow.workflowType, "time_correction"),
				eq(approvalWorkflow.sourceType, "time_entry"),
				eq(approvalWorkflow.sourceId, input.workPeriodId),
			),
			columns: { id: true },
		});
		const requests = await input.tx.query.approvalRequest.findMany({
			where: and(
				eq(approvalRequest.organizationId, input.organizationId),
				eq(approvalRequest.entityType, "time_entry"),
				eq(approvalRequest.entityId, input.workPeriodId),
				sql`${approvalRequest.metadata} -> 'submission' ->> 'key' = ${candidate}`,
			),
			columns: { id: true },
			limit: 2,
		});
		if (workflow || requests.length === 1) return candidate;
		if (requests.length > 1) {
			throw new ConflictError({
				message: "Time correction request conflicts with existing data",
				conflictType: "time_correction_identity",
			});
		}
	}
	return null;
}

async function insertOrVerifyCorrection(input: {
	tx: typeof db;
	id: string;
	employeeId: string;
	organizationId: string;
	createdBy: string;
	notes: string;
	endpoint: SubmissionEndpoint;
	previousEntry: Pick<
		typeof timeEntry.$inferSelect,
		"id" | "hash" | "employeeId" | "organizationId"
	> | null;
	requestMetadata: { ipAddress: string; userAgent: string };
}) {
	const existing = await input.tx.query.timeEntry.findFirst({
		where: and(
			eq(timeEntry.id, input.id),
			eq(timeEntry.organizationId, input.organizationId),
			eq(timeEntry.employeeId, input.employeeId),
		),
	});
	if (existing) {
		if (
			existing.type !== "correction" ||
			existing.replacesEntryId !== input.endpoint.originalEntryId ||
			compareInstants(
				instantFromTimeCorrectionBoundary(existing.timestamp),
				instantFromTimeCorrectionBoundary(input.endpoint.timestamp),
			) !== 0 ||
			existing.utcOffsetMinutes !==
				input.endpoint.timezoneCapture.utcOffsetMinutes ||
			existing.timezone !== input.endpoint.timezoneCapture.timezone ||
			existing.timezoneSource !== input.endpoint.timezoneCapture.timezoneSource
		) {
			throw new ConflictError({
				message: "Time correction request conflicts with existing data",
				conflictType: "time_correction_identity",
			});
		}
		return { entry: existing, inserted: false as const };
	}

	const previousHash = input.previousEntry?.hash ?? null;
	const created = await insertTimeCorrectionSourceEntry({
		dbService: { db: input.tx } as ApprovalDbService,
		id: input.id,
		employeeId: input.employeeId,
		organizationId: input.organizationId,
		timestamp: input.endpoint.timestamp,
		timezoneCapture: input.endpoint.timezoneCapture,
		previousEntryId: input.previousEntry?.id ?? null,
		previousHash,
		hash: calculateHash({
			employeeId: input.employeeId,
			type: "correction",
			timestamp: input.endpoint.timestamp.toISOString(),
			previousHash,
		}),
		replacesEntryId: input.endpoint.originalEntryId,
		notes: input.notes,
		createdBy: input.createdBy,
		ipAddress: input.requestMetadata.ipAddress,
		deviceInfo: input.requestMetadata.userAgent,
	});
	if (!created) throw new Error("Time correction row was not created");
	return { entry: created, inserted: true as const };
}

export async function lockTimeCorrectionSubmissionActorAndPeriodInTransaction(input: {
	tx: typeof db;
	organizationId: string;
	employeeId: string;
	userId: string;
	workPeriodId: string;
	expectedClockInId: string;
	expectedClockOutId: string | null;
	expectedStartTime: Date;
	expectedEndTime: Date | null;
}) {
	// Global employee lock order is ascending employee ID before work-period locks.
	const lockedEmployees = await input.tx
		.select()
		.from(employee)
		.where(
			and(
				eq(employee.id, input.employeeId),
				eq(employee.userId, input.userId),
				eq(employee.organizationId, input.organizationId),
				eq(employee.isActive, true),
			),
		)
		.orderBy(asc(employee.id))
		.for("update");
	const lockedEmployee = lockedEmployees[0];
	if (lockedEmployees.length !== 1 || !lockedEmployee) {
		throw new ConflictError({
			message: "Employee changed while requesting the correction",
			conflictType: "time_correction_employee_stale",
		});
	}
	const lockedMembers = await input.tx
		.select()
		.from(member)
		.where(
			and(
				eq(member.userId, input.userId),
				eq(member.organizationId, input.organizationId),
			),
		)
		.orderBy(asc(member.id))
		.limit(2)
		.for("update");
	const lockedMember = lockedMembers[0];
	if (
		lockedMembers.length !== 1 ||
		!lockedMember ||
		lockedMember.userId !== input.userId ||
		lockedMember.organizationId !== input.organizationId ||
		lockedMember.status !== "approved"
	) {
		throw new ConflictError({
			message: "Time correction actor changed before submission",
			conflictType: "time_correction_actor_stale",
		});
	}
	const lockedTeamId = await lockTrustedTimeCorrectionEmployeeTeamId({
		tx: input.tx,
		employeeId: lockedEmployee.id,
		employeeTeamId: lockedEmployee.teamId,
		organizationId: input.organizationId,
	});
	const [lockedPeriod] = await input.tx
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, input.workPeriodId),
				eq(workPeriod.employeeId, input.employeeId),
				eq(workPeriod.organizationId, input.organizationId),
				isNull(workPeriod.deletedAt),
			),
		)
		.for("update");
	if (
		!lockedPeriod ||
		lockedPeriod.clockInId !== input.expectedClockInId ||
		lockedPeriod.clockOutId !== input.expectedClockOutId ||
		compareInstants(
			instantFromTimeCorrectionBoundary(lockedPeriod.startTime),
			instantFromTimeCorrectionBoundary(input.expectedStartTime),
		) !== 0 ||
		(lockedPeriod.endTime === null) !== (input.expectedEndTime === null) ||
		(lockedPeriod.endTime !== null &&
			input.expectedEndTime !== null &&
			compareInstants(
				instantFromTimeCorrectionBoundary(lockedPeriod.endTime),
				instantFromTimeCorrectionBoundary(input.expectedEndTime),
			) !== 0)
	) {
		throw new ConflictError({
			message: "Work period changed while requesting the correction",
			conflictType: "time_correction_work_period_stale",
		});
	}
	return { lockedEmployee, lockedTeamId, lockedPeriod };
}

export async function submitCorrection(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	employeeId: string;
	userId: string;
	submissionId: string;
	workPeriodId: string;
	expectedClockInId: string;
	expectedClockOutId: string | null;
	expectedStartTime: Date;
	expectedEndTime: Date | null;
	action: "edit" | "delete";
	reason: string;
	endpoints: SubmissionEndpoint[];
	workLocationType: WorkLocationType;
	workCategoryId: string | null;
	validateTimeRange?: () => Promise<{
		isValid: boolean;
		error?: string;
		holidayName?: string;
	}>;
}) {
	const session = await getCurrentSession();
	if (
		!session?.user ||
		session.user.id !== input.userId ||
		session.session.activeOrganizationId !== input.organizationId
	) {
		throw new ConflictError({
			message: "Time correction actor changed before submission",
			conflictType: "time_correction_actor_stale",
		});
	}
	const runtime = createCorrectionRuntime(input.dbService);
	const requestMetadata = await getRequestMetadata();
	return await runtime.repository.withTransaction(async (context) => {
		const tx = context.dbService.db as unknown as typeof db;
		const { lockedEmployee, lockedTeamId, lockedPeriod } =
			await lockTimeCorrectionSubmissionActorAndPeriodInTransaction({
				tx,
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				userId: input.userId,
				workPeriodId: input.workPeriodId,
				expectedClockInId: input.expectedClockInId,
				expectedClockOutId: input.expectedClockOutId,
				expectedStartTime: input.expectedStartTime,
				expectedEndTime: input.expectedEndTime,
			});
		const proposedMetadata = normalizeCorrectionWorkMetadataInput({
			workLocationType: input.workLocationType,
			workCategoryId: input.workCategoryId,
		});
		const metadataChanged =
			proposedMetadata.workLocationType !==
				normalizeWorkLocationType(lockedPeriod.workLocationType) ||
			proposedMetadata.workCategoryId !== lockedPeriod.workCategoryId;
		if (
			input.action === "edit" &&
			input.endpoints.length === 0 &&
			!metadataChanged
		) {
			throw new ValidationError({
				message: "At least one correction value must change",
				field: "correction",
			});
		}
		if (
			input.action === "delete" &&
			(!lockedPeriod.endTime || !lockedPeriod.clockOutId)
		) {
			throw new ValidationError({
				message: "Cannot delete an active work period. Please clock out first.",
				field: "workPeriodId",
			});
		}

		const originalIds = input.endpoints.map(
			(endpoint) => endpoint.originalEntryId,
		);
		const originals = originalIds.length
			? await tx
					.select()
					.from(timeEntry)
					.where(
						and(
							eq(timeEntry.organizationId, input.organizationId),
							eq(timeEntry.employeeId, input.employeeId),
							inArray(timeEntry.id, originalIds),
						),
					)
					.for("update")
			: [];
		if (
			originals.length !== originalIds.length ||
			originals.some((entry) => entry.isSuperseded) ||
			originals.some((entry) => {
				const expectedTimestamp =
					entry.id === lockedPeriod.clockInId
						? lockedPeriod.startTime
						: entry.id === lockedPeriod.clockOutId
							? lockedPeriod.endTime
							: null;
				return (
					expectedTimestamp === null ||
					compareInstants(
						instantFromTimeCorrectionBoundary(entry.timestamp),
						instantFromTimeCorrectionBoundary(expectedTimestamp),
					) !== 0
				);
			})
		) {
			throw new ConflictError({
				message:
					"Work period endpoints changed while requesting the correction",
				conflictType: "time_correction_endpoint_stale",
			});
		}

		const managerDecision = await resolveCorrectionApprovalManager({
			db: tx,
			requesterEmployeeId: input.employeeId,
			organizationId: input.organizationId,
		});
		const identity = Object.fromEntries(
			input.endpoints.map((endpoint) => [
				endpoint.endpointType === "clock_in" ? "clockIn" : "clockOut",
				{
					originalEntryId: endpoint.originalEntryId,
					instant: instantFromTimeCorrectionBoundary(endpoint.timestamp),
				},
			]),
		);
		const businessSubmissionKey = deriveTimeCorrectionSubmissionKey({
			organizationId: input.organizationId,
			workPeriodId: input.workPeriodId,
			action: input.action,
			workLocationType: proposedMetadata.workLocationType,
			workCategoryId: proposedMetadata.workCategoryId,
			...identity,
		});
		const v2SubmissionKey = `time-correction-cycle:v2:${input.submissionId}:${businessSubmissionKey}`;
		const sourceMetadataUnchanged =
			proposedMetadata.workLocationType ===
				normalizeWorkLocationType(lockedPeriod.workLocationType) &&
			proposedMetadata.workCategoryId === lockedPeriod.workCategoryId;
		const v1SubmissionKey =
			input.endpoints.length > 0 && sourceMetadataUnchanged
				? `time-correction-cycle:v1:${input.submissionId}:${deriveLegacyTimeCorrectionSubmissionKey(
						{
							organizationId: input.organizationId,
							workPeriodId: input.workPeriodId,
							action: input.action,
							...identity,
						},
					)}`
				: null;
		const persistedSubmissionKey = await findPersistedCorrectionSubmissionKey({
			tx,
			organizationId: input.organizationId,
			workPeriodId: input.workPeriodId,
			candidates: [
				v2SubmissionKey,
				...(v1SubmissionKey ? [v1SubmissionKey] : []),
			],
		});
		const submissionKey = persistedSubmissionKey ?? v2SubmissionKey;
		const legacyReplay = submissionKey === v1SubmissionKey;
		let previousEntry =
			(await tx.query.timeEntry.findFirst({
				where: and(
					eq(timeEntry.employeeId, input.employeeId),
					eq(timeEntry.organizationId, input.organizationId),
				),
				orderBy: [desc(timeEntry.createdAt)],
			})) ?? null;
		const evidence: TimeCorrectionEndpointEvidence[] = [];
		const correctionEntries: (typeof timeEntry.$inferSelect)[] = [];
		const newlyInserted: Array<{
			entry: typeof timeEntry.$inferSelect;
			endpoint: SubmissionEndpoint;
		}> = [];
		for (const endpoint of input.endpoints) {
			const id = deriveTimeCorrectionRowId({
				submissionKey,
				endpointType: endpoint.endpointType,
			});
			const correction = await insertOrVerifyCorrection({
				tx,
				id,
				employeeId: input.employeeId,
				organizationId: input.organizationId,
				createdBy: input.userId,
				notes: input.reason,
				endpoint,
				previousEntry,
				requestMetadata,
			});
			previousEntry = correction.entry;
			correctionEntries.push(correction.entry);
			if (correction.inserted) {
				newlyInserted.push({ entry: correction.entry, endpoint });
			}
			evidence.push(endpointEvidence(endpoint, id));
		}

		const dbService = transactionDbService(
			input.dbService,
			context.dbService.db as ApprovalDbService["db"],
		);
		const correction = {
			action: input.action,
			...(!legacyReplay
				? {
						workLocationType: proposedMetadata.workLocationType,
						workCategoryId: proposedMetadata.workCategoryId,
					}
				: {}),
			...(evidence.find((item) => item.endpointType === "clock_in")
				? {
						clockInCorrectionId: evidence.find(
							(item) => item.endpointType === "clock_in",
						)?.correctionEntryId,
					}
				: {}),
			...(evidence.find((item) => item.endpointType === "clock_out")
				? {
						clockOutCorrectionId: evidence.find(
							(item) => item.endpointType === "clock_out",
						)?.correctionEntryId,
					}
				: {}),
		};
		const result = (await executeTimeCorrectionSubmissionInTransaction({
			dbService,
			context,
			organizationId: input.organizationId,
			requesterEmployeeId: input.employeeId,
			teamId: lockedTeamId,
			workPeriodId: input.workPeriodId,
			defaultApproverId: managerDecision.ok ? managerDecision.managerId : null,
			reason: input.reason,
			overtimeRisk: null,
			submissionKey,
			submissionId: input.submissionId,
			correction,
		})) as Omit<ApprovalResult, "correctionEntryIds">;
		if (result.disposition !== "replayed") {
			await validateCorrectionWorkMetadata({
				tx,
				employeeId: lockedEmployee.id,
				teamId: lockedTeamId,
				organizationId: input.organizationId,
				workLocationType: proposedMetadata.workLocationType,
				workCategoryId: proposedMetadata.workCategoryId,
				currentWorkCategoryId: lockedPeriod.workCategoryId,
			});
		}
		if (result.disposition !== "replayed" && input.validateTimeRange) {
			const validation = await input.validateTimeRange();
			if (!validation.isValid) {
				throw new ValidationError({
					message:
						validation.error ?? "Cannot create time correction for this period",
					field: "timestamp",
					value: validation.holidayName,
				});
			}
		}
		if (result.disposition === "replayed") {
			await mapSequentially([...newlyInserted].reverse(), async (inserted) => {
				const deleted = await tx
					.delete(timeEntry)
					.where(
						and(
							eq(timeEntry.id, inserted.entry.id),
							eq(timeEntry.organizationId, input.organizationId),
							eq(timeEntry.employeeId, input.employeeId),
							eq(timeEntry.type, "correction"),
							eq(timeEntry.replacesEntryId, inserted.endpoint.originalEntryId),
							eq(timeEntry.isSuperseded, true),
							isNull(timeEntry.supersededById),
						),
					)
					.returning({ id: timeEntry.id });
				if (deleted.length !== 1 || deleted[0]?.id !== inserted.entry.id) {
					throw new ConflictError({
						message: "Time correction replay cleanup failed",
						conflictType: "time_correction_identity",
					});
				}
			});
		}
		return {
			...result,
			correctionEntries,
			correctionEntryIds: evidence.map(
				(endpoint) => endpoint.correctionEntryId,
			),
		};
	});
}

async function dispatchSubmissionPostCommit(input: {
	dbService: typeof DatabaseService.Service;
	emailService: typeof EmailService.Service;
	organizationId: string;
	employeeId: string;
	workPeriodId: string;
	reason: string;
	period: typeof workPeriod.$inferSelect;
	correctedClockIn: Date;
	correctedClockOut?: Date;
	result: ApprovalResult;
}) {
	const effects = input.result.postCommit;
	if (effects.authority !== "legacy") return;
	try {
		if (effects.terminal?.kind === "approved" && input.result.autoCompletion) {
			await runAutoCompletedTimeCorrectionMaintenance(
				input.result.autoCompletion,
			);
			return;
		}
		if (!effects.submittedToEmployeeId) return;
		const [managerRecord, requester] = await Promise.all([
			input.dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, effects.submittedToEmployeeId),
					eq(employee.organizationId, input.organizationId),
					eq(employee.isActive, true),
				),
				with: { user: true },
			}),
			input.dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, input.employeeId),
					eq(employee.organizationId, input.organizationId),
					eq(employee.isActive, true),
				),
				with: { user: true },
			}),
		]);
		if (!managerRecord || !requester) return;
		const appUrl = await getOrganizationBaseUrl(input.organizationId);
		const formatDate = (value: Date) =>
			value.toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
				year: "numeric",
			});
		const formatTime = (value: Date) =>
			value.toLocaleTimeString("en-US", {
				hour: "numeric",
				minute: "2-digit",
				hour12: true,
			});
		const html = await renderTimeCorrectionPendingApproval({
			managerName: managerRecord.user.name,
			employeeName: requester.user.name,
			date: formatDate(input.period.startTime),
			originalClockIn: formatTime(input.period.startTime),
			originalClockOut: input.period.endTime
				? formatTime(input.period.endTime)
				: "-",
			correctedClockIn: formatTime(input.correctedClockIn),
			correctedClockOut: input.correctedClockOut
				? formatTime(input.correctedClockOut)
				: "-",
			reason: input.reason,
			approvalUrl: `${appUrl}/approvals/inbox`,
		});
		await Effect.runPromise(
			input.emailService.send({
				to: managerRecord.user.email,
				subject: `Time Correction Request from ${requester.user.name}`,
				html,
			}),
		);
	} catch (error) {
		logger.error(
			{ error, workPeriodId: input.workPeriodId },
			"Failed to dispatch committed time correction side effects",
		);
	}
}

export async function dispatchCommittedTimeCorrectionSubmission(
	input: Omit<
		Parameters<typeof dispatchSubmissionPostCommit>[0],
		"dbService" | "emailService"
	>,
) {
	const effects = input.result.postCommit;
	if (
		effects.authority !== "legacy" ||
		(effects.terminal === null && !effects.submittedToEmployeeId)
	) {
		return;
	}
	const effect = Effect.gen(function* (_) {
		const dbService = yield* _(DatabaseService);
		const emailService = yield* _(EmailService);
		yield* _(
			Effect.promise(() =>
				dispatchSubmissionPostCommit({ ...input, dbService, emailService }),
			),
		);
	});
	await Effect.runPromise(effect.pipe(Effect.provide(AppLayer)));
}

async function loadSubmissionActor(
	dbService: typeof DatabaseService.Service,
	userId: string,
	organizationId: string,
) {
	const employeeRecord = await dbService.db.query.employee.findFirst({
		where: and(
			eq(employee.userId, userId),
			eq(employee.organizationId, organizationId),
			eq(employee.isActive, true),
		),
	});
	if (!employeeRecord) {
		throw new NotFoundError({
			message: "Employee profile not found",
			entityType: "employee",
		});
	}
	return employeeRecord;
}

async function loadSubmissionPeriod(
	dbService: typeof DatabaseService.Service,
	workPeriodId: string,
	employeeId: string,
	organizationId: string,
) {
	const [period] = await dbService.db
		.select()
		.from(workPeriod)
		.where(
			and(
				eq(workPeriod.id, workPeriodId),
				eq(workPeriod.employeeId, employeeId),
				eq(workPeriod.organizationId, organizationId),
				isNull(workPeriod.deletedAt),
			),
		)
		.limit(1);
	if (!period) {
		throw new NotFoundError({
			message: "Work period not found",
			entityType: "workPeriod",
			entityId: workPeriodId,
		});
	}
	return period;
}

function submissionFailure(error: unknown) {
	if (
		error instanceof ConflictError ||
		error instanceof NotFoundError ||
		error instanceof ValidationError
	) {
		return error;
	}
	logger.error({ err: error }, "Time correction submission transaction failed");
	return new DatabaseError({
		message: "Failed to submit time correction. Please try again.",
		operation: "submit_time_correction",
		cause: error,
	});
}

function submissionEffect(
	data: CorrectionRequest | TimeEntryDeletionRequest,
	action: "edit" | "delete",
) {
	return Effect.gen(function* (_) {
		let submissionId: string;
		try {
			submissionId = validateSubmissionId(data.submissionId);
		} catch (error) {
			return yield* _(Effect.fail(error as ValidationError));
		}
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);
		const emailService = yield* _(EmailService);
		const organizationId = session.session.activeOrganizationId;
		if (!organizationId) {
			return yield* _(
				Effect.fail(
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
				),
			);
		}
		const currentEmployee = yield* _(
			Effect.tryPromise({
				try: () =>
					loadSubmissionActor(dbService, session.user.id, organizationId),
				catch: () =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			}),
		);
		const billingAccess = yield* _(
			Effect.promise(() => requireBillingForMutation(organizationId)),
		);
		if (!isBillingMutationAllowed(billingAccess)) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "billing_required",
						field: "billing",
						value: billingAccess.reason ?? "subscription_required",
					}),
				),
			);
		}
		const period = yield* _(
			Effect.tryPromise({
				try: () =>
					loadSubmissionPeriod(
						dbService,
						data.workPeriodId,
						currentEmployee.id,
						organizationId,
					),
				catch: () =>
					new NotFoundError({
						message: "Work period not found",
						entityType: "workPeriod",
						entityId: data.workPeriodId,
					}),
			}),
		);
		const timezone = yield* _(
			Effect.promise(() => getUserTimezone(session.user.id)),
		);

		let correctedClockIn = period.startTime;
		let correctedClockOut = period.endTime ?? undefined;
		const endpoints: SubmissionEndpoint[] = [];
		if (action === "edit") {
			const edit = data as CorrectionRequest;
			const times = buildCorrectionTimes({ ...edit, timezone });
			if ("error" in times) {
				return yield* _(
					Effect.fail(
						new ValidationError({ message: times.error, field: "timestamp" }),
					),
				);
			}
			const clockInChanged = hasSubmittedEndpointMinuteChanged({
				original: period.startTime,
				date: edit.newClockInDate,
				time: edit.newClockInTime,
				timezone,
			});
			const clockOutChanged = Boolean(
				times.correctedClockOutDate &&
					period.endTime &&
					edit.newClockOutDate &&
					edit.newClockOutTime &&
					hasSubmittedEndpointMinuteChanged({
						original: period.endTime,
						date: edit.newClockOutDate,
						time: edit.newClockOutTime,
						timezone,
					}),
			);
			correctedClockIn = clockInChanged
				? times.correctedClockInDate
				: period.startTime;
			correctedClockOut = clockOutChanged
				? times.correctedClockOutDate
				: (period.endTime ?? undefined);
			const now = systemClock.nowInstant();
			if (
				compareInstants(
					instantFromTimeCorrectionBoundary(correctedClockIn),
					now,
				) > 0 ||
				(correctedClockOut &&
					compareInstants(
						instantFromTimeCorrectionBoundary(correctedClockOut),
						now,
					) > 0)
			) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: "Correction time cannot be in the future",
							field: "timestamp",
						}),
					),
				);
			}
			if (
				correctedClockOut &&
				compareInstants(
					instantFromTimeCorrectionBoundary(correctedClockOut),
					instantFromTimeCorrectionBoundary(correctedClockIn),
				) <= 0
			) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: "Clock out time must be after clock in time",
							field: "newClockOutTime",
						}),
					),
				);
			}
			try {
				validateTimeCorrectionRange(
					instantFromTimeCorrectionBoundary(correctedClockIn),
					correctedClockOut
						? instantFromTimeCorrectionBoundary(correctedClockOut)
						: null,
				);
			} catch (error) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message:
								error instanceof Error
									? error.message
									: "Invalid work period range",
							field: "timestamp",
						}),
					),
				);
			}
			if (clockInChanged) {
				endpoints.push({
					endpointType: "clock_in",
					originalEntryId: period.clockInId,
					timestamp: correctedClockIn,
					timezoneCapture: resolveFallbackTimezoneCapture({
						timestamp: correctedClockIn,
						timezone,
						timezoneSource: "user_setting",
					}),
				});
			}
			if (
				times.correctedClockOutDate &&
				period.clockOutId &&
				period.endTime &&
				clockOutChanged
			) {
				endpoints.push({
					endpointType: "clock_out",
					originalEntryId: period.clockOutId,
					timestamp: times.correctedClockOutDate,
					timezoneCapture: resolveFallbackTimezoneCapture({
						timestamp: times.correctedClockOutDate,
						timezone,
						timezoneSource: "user_setting",
					}),
				});
			}
		} else {
			if (!period.endTime || !period.clockOutId) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message:
								"Cannot delete an active work period. Please clock out first.",
							field: "workPeriodId",
						}),
					),
				);
			}
			const clockOutId = period.clockOutId;
			const originals = yield* _(
				Effect.promise(() =>
					dbService.db.query.timeEntry.findMany({
						where: and(
							eq(timeEntry.organizationId, organizationId),
							eq(timeEntry.employeeId, currentEmployee.id),
							inArray(timeEntry.id, [period.clockInId, clockOutId]),
						),
					}),
				),
			);
			const deletionTimestamp = period.startTime;
			const originalsById = new Map<string, (typeof originals)[number]>();
			for (const original of originals) {
				if (!originalsById.has(original.id)) {
					originalsById.set(original.id, original);
				}
			}
			for (const endpoint of [
				{ endpointType: "clock_in" as const, id: period.clockInId },
				{ endpointType: "clock_out" as const, id: clockOutId },
			]) {
				const original = originalsById.get(endpoint.id);
				const endpointTimezone = original?.timezone ?? timezone;
				const timezoneCapture =
					original?.timezoneSource === "browser"
						? resolveTimeEntryTimezoneCapture({
								timestamp: deletionTimestamp,
								browserTimezone: endpointTimezone,
								fallbackTimezone: timezone,
								browserSource: "browser",
								fallbackSource: "user_setting",
							})
						: resolveFallbackTimezoneCapture({
								timestamp: deletionTimestamp,
								timezone: endpointTimezone,
								timezoneSource: original?.timezone
									? (original.timezoneSource as Exclude<
											TimeEntryTimezoneCapture["timezoneSource"],
											"browser"
										>)
									: "user_setting",
							});
				endpoints.push({
					endpointType: endpoint.endpointType,
					originalEntryId: endpoint.id,
					timestamp: deletionTimestamp,
					timezoneCapture,
				});
			}
			correctedClockOut = deletionTimestamp;
		}

		const result = yield* _(
			Effect.tryPromise({
				try: () =>
					submitCorrection({
						dbService,
						organizationId,
						employeeId: currentEmployee.id,
						userId: session.user.id,
						submissionId,
						workPeriodId: period.id,
						expectedClockInId: period.clockInId,
						expectedClockOutId: period.clockOutId,
						expectedStartTime: period.startTime,
						expectedEndTime: period.endTime,
						action,
						reason: data.reason,
						endpoints,
						workLocationType:
							action === "edit"
								? (data as CorrectionRequest).workLocationType
								: normalizeWorkLocationType(period.workLocationType),
						workCategoryId:
							action === "edit"
								? (data as CorrectionRequest).workCategoryId
								: period.workCategoryId,
						validateTimeRange: () =>
							validateTimeEntryRange(
								organizationId,
								correctedClockIn,
								correctedClockOut ?? correctedClockIn,
								timezone,
							),
					}),
				catch: submissionFailure,
			}),
		);
		yield* _(
			Effect.promise(() =>
				dispatchSubmissionPostCommit({
					dbService,
					emailService,
					organizationId,
					employeeId: currentEmployee.id,
					workPeriodId: period.id,
					reason: data.reason,
					period,
					correctedClockIn,
					correctedClockOut,
					result,
				}),
			),
		);
		return {
			approvalId: result.approvalRequestId,
			status:
				result.kind === "auto_completed"
					? ("approved" as const)
					: ("pending" as const),
		};
	});
}

export async function requestTimeCorrectionEffect(
	data: CorrectionRequest,
): Promise<
	ServerActionResult<{ approvalId: string; status: "approved" | "pending" }>
> {
	const effect = submissionEffect(data, "edit").pipe(
		Effect.tapError((error) =>
			Effect.sync(() =>
				logger.error({ error }, "Failed to process time correction request"),
			),
		),
		Effect.provide(AppLayer),
		Effect.provide(DatabaseServiceLive),
	);
	const result = await runServerActionSafe(effect);
	if (
		!result.success &&
		result.error ===
			"A time correction approval is already pending for this work period"
	) {
		return { ...result, code: "pending_time_correction_approval" };
	}
	if (!result.success && result.error === "billing_required") {
		return {
			success: false,
			error: "billing_required",
			code: result.holidayName ?? "subscription_required",
		};
	}
	return result;
}

export async function requestTimeEntryDeletion(
	data: TimeEntryDeletionRequest,
): Promise<
	ServerActionResult<{ approvalId: string; status: "approved" | "pending" }>
> {
	if (!data.reason.trim()) {
		return { success: false, error: "Reason is required" };
	}
	const result = await runServerActionSafe(
		submissionEffect({ ...data, reason: data.reason.trim() }, "delete").pipe(
			Effect.tapError((error) =>
				Effect.sync(() =>
					logger.error(
						{ error },
						"Failed to process time entry deletion request",
					),
				),
			),
			Effect.provide(AppLayer),
			Effect.provide(DatabaseServiceLive),
		),
	);
	if (
		!result.success &&
		result.error ===
			"A time correction approval is already pending for this work period"
	) {
		return { ...result, code: "pending_time_correction_approval" };
	}
	if (!result.success && result.error === "billing_required") {
		return {
			success: false,
			error: "billing_required",
			code: result.holidayName ?? "subscription_required",
		};
	}
	return result;
}

export const requestTimeCorrection = requestTimeCorrectionEffect;
