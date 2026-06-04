"use server";

import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { approvalRequest, employee, timeEntry, workPeriod } from "@/db/schema";
import { getOrganizationBaseUrl } from "@/lib/app-url";
import { getPrimaryEligibleManagerIdForRequester } from "@/lib/approvals/policies/manager-eligibility-db";
import { createTimeCorrectionApprovalWorkflow } from "@/lib/approvals/server/time-correction-approvals";
import { isBillingMutationAllowed, requireBillingForMutation } from "@/lib/billing/guard";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { AppLayer } from "@/lib/effect/runtime";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService, DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { EmailService } from "@/lib/effect/services/email.service";
import { renderTimeCorrectionPendingApproval } from "@/lib/email/render";
import {
	resolveFallbackTimezoneCapture,
	type TimeEntryTimezoneCapture,
} from "@/lib/time-tracking/timezone-capture";
import { validateTimeEntryRange } from "@/lib/time-tracking/validation";
import { markEmployeeWorkBalanceDirty } from "@/lib/work-balance/service";
import { getCurrentEmployee, getCurrentSession, getUserTimezone } from "./auth";
import { createTimeEntry, markTimeEntrySuperseded } from "./entry-helpers";
import { getEditCapabilityForPeriod } from "./policy-helpers";
import { logger } from "./shared";
import { calculateDurationMinutes, createCorrectionDateTime } from "./time-utils";
import type { CorrectionRequest, SameDayEditRequest, TimeEntryDeletionRequest } from "./types";

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
		logger.error({ error, ...context }, "Failed to mark work balance dirty after same-day edit");
	}
}

type ManagerResolverDb = Parameters<typeof getPrimaryEligibleManagerIdForRequester>[0]["db"];

export async function resolveCorrectionApprovalManager(input: {
	db: ManagerResolverDb;
	requesterEmployeeId: string;
	organizationId: string;
}): Promise<
	| { ok: true; managerId: string }
	| { ok: false; message: "No manager assigned to approve corrections"; field: "managerId" }
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

	if (params.newClockOutDate && params.newClockOutTime && !correctedClockOutDate) {
		return { error: "Invalid clock out date or time" } as const;
	}

	return { correctedClockInDate, correctedClockOutDate } as const;
}

export async function editSameDayTimeEntry(
	data: SameDayEditRequest,
): Promise<ServerActionResult<{ workPeriodId: string; requiresApproval?: boolean }>> {
	const session = await getCurrentSession();
	if (!session?.user) {
		return { success: false, error: "Not authenticated" };
	}

	const currentEmployee = await getCurrentEmployee();
	if (!currentEmployee) {
		return { success: false, error: "Employee profile not found" };
	}

	const timezone = await getUserTimezone(session.user.id);
	const [selectedWorkPeriod] = await db
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
		.limit(1);

	if (!selectedWorkPeriod) {
		return { success: false, error: "Work period not found" };
	}

	if (selectedWorkPeriod.employeeId !== currentEmployee.id) {
		return { success: false, error: "You can only edit your own time entries" };
	}

	if (!selectedWorkPeriod.endTime) {
		return { success: false, error: "Cannot edit an active work period. Please clock out first." };
	}

	const pendingTimeCorrectionApproval = await db.query.approvalRequest.findFirst({
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
			error: "A time correction approval is already pending for this work period",
			code: "pending_time_correction_approval",
		};
	}

	let editCapability;
	try {
		editCapability = await getEditCapabilityForPeriod({
			employeeId: currentEmployee.id,
			workPeriodEndTime: selectedWorkPeriod.endTime,
			timezone,
		});
	} catch (error) {
		logger.error({ error }, "Failed to check edit capability");
		return { success: false, error: "Failed to verify edit policy. Please try again." };
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
			error: "This edit requires manager approval. Please use the correction request.",
			requiresApproval: true,
		} as ServerActionResult<{ workPeriodId: string; requiresApproval?: boolean }>;
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
		return { success: false, error: "Clock out time must be after clock in time" };
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

	try {
		const notes = data.reason || "Same-day edit";
		const clockInTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: correctedClockInDate,
			timezone,
			timezoneSource: "user_setting",
		});
		const clockInCorrection = await createTimeEntry({
			employeeId: currentEmployee.id,
			organizationId: currentEmployee.organizationId,
			type: "correction",
			timestamp: correctedClockInDate,
			createdBy: session.user.id,
			...clockInTimezoneCapture,
			replacesEntryId: selectedWorkPeriod.clockInId,
			notes,
		});

		await markTimeEntrySuperseded(selectedWorkPeriod.clockInId, clockInCorrection.id);

		let clockOutCorrectionId: string | undefined;
		if (data.newClockOutTime && selectedWorkPeriod.clockOutId && correctedClockOutDate) {
			const clockOutTimezoneCapture = resolveFallbackTimezoneCapture({
				timestamp: correctedClockOutDate,
				timezone,
				timezoneSource: "user_setting",
			});
			const clockOutCorrection = await createTimeEntry({
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				type: "correction",
				timestamp: correctedClockOutDate,
				createdBy: session.user.id,
				...clockOutTimezoneCapture,
				replacesEntryId: selectedWorkPeriod.clockOutId,
				notes,
			});

			clockOutCorrectionId = clockOutCorrection.id;
			await markTimeEntrySuperseded(selectedWorkPeriod.clockOutId, clockOutCorrection.id);
		} else if (data.reason && selectedWorkPeriod.clockOutId) {
			await db
				.update(timeEntry)
				.set({ notes: data.reason })
				.where(eq(timeEntry.id, selectedWorkPeriod.clockOutId));
		}

		const finalClockOut = correctedClockOutDate || selectedWorkPeriod.endTime;
		const updatedPeriods = await db
			.update(workPeriod)
			.set({
				clockInId: clockInCorrection.id,
				clockOutId: clockOutCorrectionId || selectedWorkPeriod.clockOutId,
				startTime: correctedClockInDate,
				endTime: finalClockOut,
				durationMinutes: calculateDurationMinutes(correctedClockInDate, finalClockOut),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(workPeriod.id, selectedWorkPeriod.id),
					eq(workPeriod.organizationId, currentEmployee.organizationId),
					isNull(workPeriod.deletedAt),
				),
			)
			.returning({ id: workPeriod.id });

		if (updatedPeriods.length === 0) {
			throw new Error("Work period was no longer available for update");
		}

		const earliestAffectedDate =
			selectedWorkPeriod.startTime <= correctedClockInDate
				? selectedWorkPeriod.startTime
				: correctedClockInDate;
		await markWorkBalanceDirtyAfterSameDayEditBestEffort(
			{
				employeeId: currentEmployee.id,
				organizationId: currentEmployee.organizationId,
				dirtyFromDate:
					DateTime.fromJSDate(earliestAffectedDate, { zone: "utc" }).toISODate() ?? undefined,
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
				clockInCorrectionId: clockInCorrection.id,
				clockOutCorrectionId,
			},
			"Same-day time entry edited successfully",
		);

		return { success: true, data: { workPeriodId: selectedWorkPeriod.id } };
	} catch (error) {
		logger.error({ error }, "Failed to edit same-day time entry");
		return { success: false, error: "Failed to update time entry. Please try again." };
	}
}

export async function requestTimeCorrectionEffect(
	data: CorrectionRequest,
): Promise<ServerActionResult<{ approvalId: string }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		yield* _(Effect.annotateCurrentSpan("user.id", session.user.id));

		const currentEmployee = yield* _(
			dbService.query("getEmployeeByUserId", async () => {
				const employeeRecord = await dbService.db.query.employee.findFirst({
					where: eq(employee.userId, session.user.id),
				});

				if (!employeeRecord) {
					throw new Error("Employee not found");
				}

				return employeeRecord;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		yield* _(Effect.annotateCurrentSpan("employee.id", currentEmployee.id));
		yield* _(Effect.annotateCurrentSpan("organization.id", currentEmployee.organizationId));

		const managerDecision = yield* _(
			Effect.promise(() =>
				resolveCorrectionApprovalManager({
					db: dbService.db,
					requesterEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				}),
			),
		);

		const managerId = managerDecision.ok ? managerDecision.managerId : null;
		if (!managerId) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "No manager assigned to approve corrections",
						field: "managerId",
					}),
				),
			);
		}
		const resolvedManagerId = managerId;

		yield* _(Effect.annotateCurrentSpan("manager.id", resolvedManagerId));

		const timezone = yield* _(Effect.promise(() => getUserTimezone(session.user.id)));

		logger.info(
			{
				employeeId: currentEmployee.id,
				workPeriodId: data.workPeriodId,
				managerId: resolvedManagerId,
				timezone,
			},
			"Processing time correction request",
		);

		const selectedWorkPeriod = yield* _(
			dbService.query("getWorkPeriod", async () => {
				const [period] = await dbService.db
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
					.limit(1);

				if (!period) {
					throw new Error("Work period not found");
				}

				return period;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Work period not found",
						entityType: "workPeriod",
						entityId: data.workPeriodId,
					}),
			),
		);

		yield* _(
			Effect.annotateCurrentSpan(
				"correction.original_clock_in",
				selectedWorkPeriod.startTime.toISOString(),
			),
		);
		if (selectedWorkPeriod.endTime) {
			yield* _(
				Effect.annotateCurrentSpan(
					"correction.original_clock_out",
					selectedWorkPeriod.endTime.toISOString(),
				),
			);
		}

		const correctionTimes = buildCorrectionTimes({
			newClockInDate: data.newClockInDate,
			newClockInTime: data.newClockInTime,
			newClockOutDate: data.newClockOutDate,
			newClockOutTime: data.newClockOutTime,
			timezone,
		});

		if ("error" in correctionTimes) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: correctionTimes.error,
						field: "startTime",
					}),
				),
			);
		}

		const { correctedClockInDate, correctedClockOutDate } = correctionTimes as Extract<
			CorrectionTimesResult,
			{ correctedClockInDate: Date }
		>;
		const now = new Date();

		if (correctedClockInDate > now) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Clock in time cannot be in the future",
						field: "newClockInTime",
					}),
				),
			);
		}

		if (correctedClockOutDate && correctedClockOutDate > now) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Clock out time cannot be in the future",
						field: "newClockOutTime",
					}),
				),
			);
		}

		const effectiveClockOut = correctedClockOutDate ?? selectedWorkPeriod.endTime;
		if (effectiveClockOut && effectiveClockOut <= correctedClockInDate) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Clock out time must be after clock in time",
						field: "newClockOutTime",
					}),
				),
			);
		}

		yield* _(
			Effect.annotateCurrentSpan(
				"correction.corrected_clock_in",
				correctedClockInDate.toISOString(),
			),
		);
		if (correctedClockOutDate) {
			yield* _(
				Effect.annotateCurrentSpan(
					"correction.corrected_clock_out",
					correctedClockOutDate.toISOString(),
				),
			);
		}

		const validation = yield* _(
			Effect.promise(() =>
				validateTimeEntryRange(
					currentEmployee.organizationId,
					correctedClockInDate,
					effectiveClockOut || correctedClockInDate,
				),
			),
		);

		if (!validation.isValid) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: validation.error || "Cannot create time correction for this period",
						field: "timestamp",
						value: validation.holidayName,
					}),
				),
			);
		}

		const { approval, clockInCorrection, clockOutCorrectionId } = yield* _(
			dbService.query("createTimeCorrectionRequest", async () => {
				return await dbService.db.transaction(async (tx) => {
					const transactionalDbService = { db: tx, query: dbService.query };
					const clockInTimezoneCapture = resolveFallbackTimezoneCapture({
						timestamp: correctedClockInDate,
						timezone,
						timezoneSource: "user_setting",
					});
					const clockInCorrection = await createTimeEntry(
						{
							employeeId: currentEmployee.id,
							organizationId: currentEmployee.organizationId,
							type: "correction",
							timestamp: correctedClockInDate,
							createdBy: session.user.id,
							...clockInTimezoneCapture,
							replacesEntryId: selectedWorkPeriod.clockInId,
							notes: data.reason,
							isSuperseded: true,
						},
						tx,
					);

					let clockOutCorrectionId: string | undefined;
					if (data.newClockOutTime && selectedWorkPeriod.clockOutId && correctedClockOutDate) {
						const clockOutTimezoneCapture = resolveFallbackTimezoneCapture({
							timestamp: correctedClockOutDate,
							timezone,
							timezoneSource: "user_setting",
						});
						const clockOutCorrection = await createTimeEntry(
							{
								employeeId: currentEmployee.id,
								organizationId: currentEmployee.organizationId,
								type: "correction",
								timestamp: correctedClockOutDate,
								createdBy: session.user.id,
								...clockOutTimezoneCapture,
								replacesEntryId: selectedWorkPeriod.clockOutId ?? undefined,
								notes: data.reason,
								isSuperseded: true,
							},
							tx,
						);

						clockOutCorrectionId = clockOutCorrection.id;
					}

					const approval = await Effect.runPromise(
						createTimeCorrectionApprovalWorkflow(transactionalDbService, {
							organizationId: currentEmployee.organizationId,
							requesterEmployeeId: currentEmployee.id,
							teamId: currentEmployee.teamId ?? null,
							workPeriodId: selectedWorkPeriod.id,
							defaultApproverId: resolvedManagerId,
							reason: data.reason,
							overtimeRisk: "warning",
							correctionEntryIds: {
								clockInCorrectionId: clockInCorrection.id,
								clockOutCorrectionId,
							},
						}),
					);

					return { approval, clockInCorrection, clockOutCorrectionId };
				});
			}),
		);

		yield* _(Effect.annotateCurrentSpan("correction.clock_in_correction_id", clockInCorrection.id));
		if (clockOutCorrectionId) {
			yield* _(
				Effect.annotateCurrentSpan("correction.clock_out_correction_id", clockOutCorrectionId),
			);
		}

		logger.info(
			{
				workPeriodId: data.workPeriodId,
				clockInCorrectionId: clockInCorrection.id,
				clockOutCorrectionId,
			},
			"Time correction entries created",
		);
		yield* _(Effect.annotateCurrentSpan("correction.approval_id", approval.approvalRequestId));

		const [manager, employeeWithUser] = yield* _(
			Effect.all([
				dbService.query("getManagerWithUser", async () => {
					const managerRecord = await dbService.db.query.employee.findFirst({
						where: eq(employee.id, resolvedManagerId),
						with: { user: true },
					});

					if (!managerRecord) {
						throw new Error("Manager not found");
					}

					return managerRecord;
				}),
				dbService.query("getEmployeeWithUser", async () => {
					const employeeRecord = await dbService.db.query.employee.findFirst({
						where: eq(employee.id, currentEmployee.id),
						with: { user: true },
					});

					if (!employeeRecord) {
						throw new Error("Employee not found");
					}

					return employeeRecord;
				}),
			]),
		);

		const appUrl = yield* _(
			Effect.promise(() => getOrganizationBaseUrl(currentEmployee.organizationId)),
		);
		const html = yield* _(
			Effect.promise(() =>
				renderTimeCorrectionPendingApproval({
					managerName: manager.user.name,
					employeeName: employeeWithUser.user.name,
					date: selectedWorkPeriod.startTime.toLocaleDateString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
					}),
					originalClockIn: selectedWorkPeriod.startTime.toLocaleTimeString("en-US", {
						hour: "numeric",
						minute: "2-digit",
						hour12: true,
					}),
					originalClockOut: selectedWorkPeriod.endTime
						? selectedWorkPeriod.endTime.toLocaleTimeString("en-US", {
								hour: "numeric",
								minute: "2-digit",
								hour12: true,
							})
						: "—",
					correctedClockIn: correctedClockInDate.toLocaleTimeString("en-US", {
						hour: "numeric",
						minute: "2-digit",
						hour12: true,
					}),
					correctedClockOut: correctedClockOutDate
						? correctedClockOutDate.toLocaleTimeString("en-US", {
								hour: "numeric",
								minute: "2-digit",
								hour12: true,
							})
						: "—",
					reason: data.reason,
					approvalUrl: `${appUrl}/approvals/inbox`,
				}),
			),
		);

		const emailService = yield* _(EmailService);
		yield* _(
			emailService.send({
				to: manager.user.email,
				subject: `Time Correction Request from ${employeeWithUser.user.name}`,
				html,
			}),
		);

		logger.info(
			{
				approvalId: approval.approvalRequestId,
				workPeriodId: data.workPeriodId,
				managerEmail: manager.user.email,
			},
			"Time correction request submitted and notification sent",
		);

		return { approvalId: approval.approvalRequestId };
	}).pipe(
		Effect.tapError((error) =>
			Effect.sync(() => {
				logger.error({ error }, "Failed to process time correction request");
			}),
		),
		Effect.withSpan("requestTimeCorrection", {
			attributes: {
				"correction.work_period_id": data.workPeriodId,
				"correction.clock_in_date": data.newClockInDate,
				"correction.clock_in_time": data.newClockInTime,
				"correction.clock_out_date": data.newClockOutDate || "none",
				"correction.clock_out_time": data.newClockOutTime || "none",
			},
		}),
		Effect.provide(AppLayer),
		Effect.provide(DatabaseServiceLive),
	);

	return runServerActionSafe(effect);
}

export async function requestTimeEntryDeletion(
	data: TimeEntryDeletionRequest,
): Promise<ServerActionResult<{ approvalId: string }>> {
	if (!data.reason.trim()) {
		return { success: false, error: "Reason is required" };
	}

	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const dbService = yield* _(DatabaseService);

		const currentEmployee = yield* _(
			Effect.promise(async () => {
				const employeeRecord = await getCurrentEmployee();
				if (!employeeRecord) {
					throw new Error("Employee not found");
				}

				return employeeRecord;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Employee profile not found",
						entityType: "employee",
					}),
			),
		);

		const selectedWorkPeriod = yield* _(
			dbService.query("getWorkPeriodForDeletion", async () => {
				const [period] = await dbService.db
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
					.limit(1);

				if (!period) {
					throw new Error("Work period not found");
				}

				return period;
			}),
			Effect.mapError(
				() =>
					new NotFoundError({
						message: "Work period not found",
						entityType: "workPeriod",
						entityId: data.workPeriodId,
					}),
			),
		);

		const billingAccess = yield* _(
			Effect.promise(() => requireBillingForMutation(currentEmployee.organizationId)),
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

		if (!selectedWorkPeriod.endTime || !selectedWorkPeriod.clockOutId) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "Cannot delete an active work period. Please clock out first.",
						field: "workPeriodId",
					}),
				),
			);
		}

		const pendingTimeCorrectionApproval = yield* _(
			dbService.query("getPendingDeletionCorrectionApproval", async () => {
				return await dbService.db.query.approvalRequest.findFirst({
					where: and(
						eq(approvalRequest.organizationId, currentEmployee.organizationId),
						eq(approvalRequest.entityType, "time_entry"),
						eq(approvalRequest.entityId, selectedWorkPeriod.id),
						eq(approvalRequest.status, "pending"),
					),
				});
			}),
		);

		if (pendingTimeCorrectionApproval) {
			yield* _(
				Effect.fail(
					new ValidationError({
						message: "A time correction approval is already pending for this work period",
						field: "pending_time_correction_approval",
					}),
				),
			);
		}

		const managerDecision = yield* _(
			Effect.promise(() =>
				resolveCorrectionApprovalManager({
					db: dbService.db,
					requesterEmployeeId: currentEmployee.id,
					organizationId: currentEmployee.organizationId,
				}),
			),
		);

		const managerId = managerDecision.ok ? managerDecision.managerId : null;
		if (!managerId) {
			return yield* _(
				Effect.fail(
					new ValidationError({
						message: "No manager assigned to approve corrections",
						field: "managerId",
					}),
				),
			);
		}

		const originalClockInEntry = yield* _(
			dbService.query("getDeletionOriginalTimeEntries", async () => {
				return await dbService.db.query.timeEntry.findFirst({
					where: and(
						eq(timeEntry.id, selectedWorkPeriod.clockInId),
						eq(timeEntry.employeeId, currentEmployee.id),
						eq(timeEntry.organizationId, currentEmployee.organizationId),
					),
				});
			}),
		);

		const timezone = yield* _(Effect.promise(() => getUserTimezone(session.user.id)));
		const fallbackDeletionTimezoneCapture = resolveFallbackTimezoneCapture({
			timestamp: selectedWorkPeriod.startTime,
			timezone,
			timezoneSource: "user_setting",
		});
		const captureFromOriginalTimeEntry = (
			originalEntry:
				| Pick<
						typeof timeEntry.$inferSelect,
						"utcOffsetMinutes" | "timezone" | "timezoneSource"
					  >
				| null,
				fallbackCapture: TimeEntryTimezoneCapture,
		): TimeEntryTimezoneCapture => {
			if (!originalEntry?.timezone) {
				return fallbackCapture;
			}

			return {
				utcOffsetMinutes: originalEntry.utcOffsetMinutes,
				timezone: originalEntry.timezone,
				timezoneSource: originalEntry.timezoneSource as TimeEntryTimezoneCapture["timezoneSource"],
			};
		};
		const clockInDeletionTimezoneCapture = captureFromOriginalTimeEntry(
			originalClockInEntry ?? null,
			fallbackDeletionTimezoneCapture,
		);
		const clockOutDeletionTimezoneCapture = clockInDeletionTimezoneCapture;
		const deletionMetadata = { action: "delete" as const };

		const result = yield* _(
			dbService.query("createTimeEntryDeletionRequest", async () => {
				return await dbService.db.transaction(async (tx) => {
					const transactionalDbService = { db: tx, query: dbService.query };
					const clockInCorrection = await createTimeEntry(
						{
							employeeId: currentEmployee.id,
							organizationId: currentEmployee.organizationId,
							type: "correction",
							timestamp: selectedWorkPeriod.startTime,
							createdBy: session.user.id,
							...clockInDeletionTimezoneCapture,
							replacesEntryId: selectedWorkPeriod.clockInId,
							notes: data.reason,
							isSuperseded: true,
						},
						tx,
					);
					const clockOutCorrection = await createTimeEntry(
						{
							employeeId: currentEmployee.id,
							organizationId: currentEmployee.organizationId,
							type: "correction",
							timestamp: selectedWorkPeriod.startTime,
							createdBy: session.user.id,
							...clockOutDeletionTimezoneCapture,
							replacesEntryId: selectedWorkPeriod.clockOutId!,
							notes: data.reason,
							isSuperseded: true,
						},
						tx,
					);

					return await Effect.runPromise(
						createTimeCorrectionApprovalWorkflow(transactionalDbService, {
							organizationId: currentEmployee.organizationId,
							requesterEmployeeId: currentEmployee.id,
							teamId: currentEmployee.teamId ?? null,
							workPeriodId: selectedWorkPeriod.id,
							defaultApproverId: managerId,
							reason: data.reason,
							overtimeRisk: "warning",
							correctionAction: deletionMetadata.action,
							correctionEntryIds: {
								clockInCorrectionId: clockInCorrection.id,
								clockOutCorrectionId: clockOutCorrection.id,
							},
						}),
					);
				});
			}),
		);

		return { approvalId: result.approvalRequestId };
	}).pipe(
		Effect.tapError((error) =>
			Effect.sync(() => {
				logger.error({ error }, "Failed to process time entry deletion request");
			}),
		),
		Effect.withSpan("requestTimeEntryDeletion", {
			attributes: {
				"correction.work_period_id": data.workPeriodId,
				"correction.action": "delete",
			},
		}),
		Effect.provide(AppLayer),
		Effect.provide(DatabaseServiceLive),
	);

	const result = await runServerActionSafe(effect);
	if (
		!result.success &&
		result.error === "A time correction approval is already pending for this work period"
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
