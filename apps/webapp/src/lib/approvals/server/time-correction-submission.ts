import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
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
	employee,
	team,
	teamMembership,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import {
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
import type { ApprovalDbService } from "@/lib/approvals/server/types";
import { finalizeOrdinaryWorkPeriodTerminalFromWorkflowTransaction } from "@/lib/approvals/server/work-period-approvals";
import { deriveTimeCorrectionRowId } from "@/lib/approvals/workflow/identity";
import { createProductionApprovalWorkflowRuntime } from "@/lib/approvals/workflow/runtime";
import {
	isBillingMutationAllowed,
	requireBillingForMutation,
} from "@/lib/billing/guard";
import { compareInstants, systemClock } from "@/lib/datetime/temporal-core";
import {
	ConflictError,
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
	validateTimeCorrectionTimezoneEvidence,
} from "@/lib/time-tracking/time-correction-temporal";
import {
	resolveFallbackTimezoneCapture,
	resolveTimeEntryTimezoneCapture,
	type TimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
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

	const originalClockInDate =
		DateTime.fromJSDate(selectedWorkPeriod.startTime, { zone: "utc" })
			.setZone(timezone)
			.toISODate() ?? "";
	const originalClockOutDate =
		DateTime.fromJSDate(selectedWorkPeriod.endTime, { zone: "utc" })
			.setZone(timezone)
			.toISODate() ?? "";
	if (
		data.newClockInDate !== originalClockInDate ||
		(data.newClockOutDate && data.newClockOutDate !== originalClockOutDate)
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
	const now = new Date();

	if (correctedClockInDate > now) {
		return { success: false, error: "Clock in time cannot be in the future" };
	}

	if (correctedClockOutDate && correctedClockOutDate > now) {
		return { success: false, error: "Clock out time cannot be in the future" };
	}

	const effectiveClockOut = correctedClockOutDate ?? selectedWorkPeriod.endTime;
	if (effectiveClockOut && effectiveClockOut <= correctedClockInDate) {
		return {
			success: false,
			error: "Clock out time must be after clock in time",
		};
	}

	const validation = await validateTimeEntryRange(
		currentEmployee.organizationId,
		correctedClockInDate,
		effectiveClockOut || correctedClockInDate,
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
		const clockInTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: correctedClockInDate,
			timezone,
			timezoneSource: "user_setting",
		});
		const correctsClockOut = Boolean(
			data.newClockOutTime &&
				selectedWorkPeriod.clockOutId &&
				correctedClockOutDate,
		);
		const clockOutTimezoneCapture = correctsClockOut
			? resolveFallbackTimezoneCapture({
					timestamp: correctedClockOutDate as Date,
					timezone,
					timezoneSource: "user_setting",
				})
			: null;
		const affectedOriginalIds = [
			selectedWorkPeriod.clockInId,
			...(correctsClockOut && selectedWorkPeriod.clockOutId
				? [selectedWorkPeriod.clockOutId]
				: []),
		];
		const originalEntries = await db.query.timeEntry.findMany({
			where: and(
				eq(timeEntry.employeeId, currentEmployee.id),
				eq(timeEntry.organizationId, currentEmployee.organizationId),
				inArray(timeEntry.id, affectedOriginalIds),
			),
		});
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

				let clockOutCorrectionId: string | undefined;
				if (
					data.newClockOutTime &&
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
					clockOutCorrectionId = clockOutCorrection.id;
				} else if (data.reason && selectedWorkPeriod.clockOutId) {
					await tx
						.update(timeEntry)
						.set({ notes: data.reason })
						.where(
							and(
								eq(timeEntry.id, selectedWorkPeriod.clockOutId),
								eq(timeEntry.employeeId, currentEmployee.id),
								eq(timeEntry.organizationId, currentEmployee.organizationId),
							),
						);
				}

				return {
					clockInCorrectionId: clockInCorrection.id,
					clockOutCorrectionId,
				};
			},
		);

		const dirtyFromDate = dirtyFromDateForTimeCorrection([
			...originalEndpointEvidence,
			{
				instant: instantFromTimeCorrectionBoundary(correctedClockInDate),
				...clockInTimezoneCapture,
			},
			...(correctedClockOutDate && clockOutTimezoneCapture
				? [
						{
							instant: instantFromTimeCorrectionBoundary(correctedClockOutDate),
							...clockOutTimezoneCapture,
						},
					]
				: []),
		]);
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
		// Global employee lock order is ascending employee ID before work-period locks.
		const lockedEmployees = await tx
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
		if (lockedEmployees.length !== 1) {
			throw new ConflictError({
				message: "Employee changed while requesting the correction",
				conflictType: "time_correction_employee_stale",
			});
		}
		const lockedEmployee = lockedEmployees[0];
		if (!lockedEmployee) {
			throw new ConflictError({
				message: "Employee changed while requesting the correction",
				conflictType: "time_correction_employee_stale",
			});
		}
		const lockedMembers = await tx
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
		const lockedMemberships = await tx
			.select()
			.from(teamMembership)
			.where(
				and(
					eq(teamMembership.employeeId, input.employeeId),
					eq(teamMembership.organizationId, input.organizationId),
				),
			)
			.for("update");
		const membershipTeamIds = lockedMemberships.map(
			(membership) => membership.teamId,
		);
		const lockedTeams = membershipTeamIds.length
			? await tx
					.select()
					.from(team)
					.where(
						and(
							eq(team.organizationId, input.organizationId),
							inArray(team.id, membershipTeamIds),
						),
					)
					.for("update")
			: [];
		const lockedTeamId =
			lockedEmployee.teamId &&
			lockedMemberships.some(
				(membership) => membership.teamId === lockedEmployee.teamId,
			) &&
			lockedTeams.some(
				(currentTeam) => currentTeam.id === lockedEmployee.teamId,
			)
				? lockedEmployee.teamId
				: null;
		const [lockedPeriod] = await tx
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
		const originals = await tx
			.select()
			.from(timeEntry)
			.where(
				and(
					eq(timeEntry.organizationId, input.organizationId),
					eq(timeEntry.employeeId, input.employeeId),
					inArray(timeEntry.id, originalIds),
				),
			)
			.for("update");
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
			...identity,
		});
		const submissionKey = `time-correction-cycle:v1:${input.submissionId}:${businessSubmissionKey}`;
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
	return new ValidationError({
		message: "Failed to submit time correction. Please try again.",
		field: "submission",
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
			correctedClockIn = times.correctedClockInDate;
			correctedClockOut =
				times.correctedClockOutDate ?? period.endTime ?? undefined;
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
			if (
				compareInstants(
					instantFromTimeCorrectionBoundary(correctedClockIn),
					instantFromTimeCorrectionBoundary(period.startTime),
				) !== 0
			) {
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
				compareInstants(
					instantFromTimeCorrectionBoundary(times.correctedClockOutDate),
					instantFromTimeCorrectionBoundary(period.endTime),
				) !== 0
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
			if (endpoints.length === 0) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message: "At least one time must change",
							field: "timestamp",
						}),
					),
				);
			}
			const validation = yield* _(
				Effect.promise(() =>
					validateTimeEntryRange(
						organizationId,
						correctedClockIn,
						correctedClockOut ?? correctedClockIn,
					),
				),
			);
			if (!validation.isValid) {
				return yield* _(
					Effect.fail(
						new ValidationError({
							message:
								validation.error ??
								"Cannot create time correction for this period",
							field: "timestamp",
							value: validation.holidayName,
						}),
					),
				);
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
