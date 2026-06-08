/**
 * Time Correction Approval Handler
 *
 * Implements ApprovalTypeHandler for time entry correction requests.
 * Integrates with existing time correction approval logic.
 */

import { IconClockEdit } from "@tabler/icons-react";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { approvalRequest, employee, timeEntry, workPeriod } from "@/db/schema";
import { NotFoundError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { calculateSLADeadline } from "../domain/sla-calculator";
import type {
	ApprovalDetail,
	ApprovalQueryParams,
	ApprovalTimelineEvent,
	ApprovalTypeHandler,
} from "../domain/types";
import type { ApprovalDbService, CurrentApprover } from "../server/types";
import { buildSLAInfo, fetchApprovals } from "./base-handler";

function loadCurrentApproverById(dbService: ApprovalDbService, approverId: string) {
	return dbService
		.query("getApprovalActor", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(eq(employee.id, approverId), eq(employee.isActive, true)),
				with: { user: true },
			});
		})
		.pipe(
			Effect.flatMap((approver) =>
				approver
					? Effect.succeed(approver as CurrentApprover)
					: Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
								entityId: approverId,
							}),
						),
			),
		);
}

// Type for work period entity with relations
interface WorkPeriodWithRelations {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
	pendingCorrection?: PendingTimeCorrectionReview;
	correctionReviewEntries?: CorrectionEntryForReview[];
	employee: {
		id: string;
		userId: string;
		teamId: string | null;
		organizationId: string;
		user: {
			id: string;
			name: string;
			email: string;
			image: string | null;
		};
	};
	clockIn: {
		id: string;
		timestamp: Date;
	};
	clockOut: {
		id: string;
		timestamp: Date;
	} | null;
}

interface CorrectionEntryForReview {
	id: string;
	timestamp: Date;
	replacesEntryId: string | null;
	isSuperseded?: boolean;
}

type TimeCorrectionAction = "edit" | "delete";

interface PendingTimeCorrectionReview {
	action: TimeCorrectionAction;
	clockIn: { original: Date; requested: Date | null };
	clockOut: { original: Date | null; requested: Date | null } | null;
	isOrphaned: boolean;
}

type TimeCorrectionApprovalMetadata = {
	timeCorrection?: {
		action?: TimeCorrectionAction;
		clockInCorrectionId?: string;
		clockOutCorrectionId?: string;
	};
};

/**
 * Format duration in minutes to human-readable string.
 */
function formatDuration(minutes: number | null): string {
	if (minutes === null) return "In progress";
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	if (hours === 0) return `${mins}m`;
	if (mins === 0) return `${hours}h`;
	return `${hours}h ${mins}m`;
}

/**
 * Format time to HH:mm format.
 */
function formatTime(date: Date): string {
	return DateTime.fromJSDate(date).toFormat("HH:mm");
}

function correctionMetadataFromRequest(request: { metadata?: unknown }) {
	return (request.metadata as TimeCorrectionApprovalMetadata | null)?.timeCorrection;
}

export function buildPendingCorrectionReview(
	period: WorkPeriodWithRelations,
	request: { metadata?: unknown },
	correctionEntries: CorrectionEntryForReview[],
): PendingTimeCorrectionReview {
	const metadata = correctionMetadataFromRequest(request);
	const correctionById = new Map(correctionEntries.map((entry) => [entry.id, entry]));
	const legacyCorrectionEntries = correctionEntries.filter((entry) => !entry.isSuperseded);
	const clockInCandidates = legacyCorrectionEntries.filter(
		(entry) => entry.replacesEntryId === period.clockIn.id,
	);
	const clockOutCandidates = period.clockOut
		? legacyCorrectionEntries.filter((entry) => entry.replacesEntryId === period.clockOut?.id)
		: [];
	const clockInCorrection = metadata?.clockInCorrectionId
		? correctionById.get(metadata.clockInCorrectionId)
		: clockInCandidates.length === 1
			? clockInCandidates[0]
			: undefined;
	const clockOutCorrection = metadata?.clockOutCorrectionId
		? correctionById.get(metadata.clockOutCorrectionId)
		: clockOutCandidates.length === 1
			? clockOutCandidates[0]
			: undefined;
	const matchingClockInCorrection =
		clockInCorrection?.replacesEntryId === period.clockIn.id ? clockInCorrection : null;
	const matchingClockOutCorrection =
		clockOutCorrection?.replacesEntryId === period.clockOut?.id ? clockOutCorrection : null;
	const hasMetadataCorrectionIds = Boolean(
		metadata?.clockInCorrectionId || metadata?.clockOutCorrectionId,
	);
	const isMetadataOrphaned =
		Boolean(metadata?.clockInCorrectionId && !matchingClockInCorrection) ||
		Boolean(metadata?.clockOutCorrectionId && !matchingClockOutCorrection);
	const isLegacyOrphaned =
		!hasMetadataCorrectionIds &&
		(!matchingClockInCorrection || clockInCandidates.length > 1 || clockOutCandidates.length > 1);

	return {
		action: metadata?.action ?? "edit",
		clockIn: {
			original: period.clockIn.timestamp,
			requested: matchingClockInCorrection?.timestamp ?? null,
		},
		clockOut:
			period.clockOut || metadata?.clockOutCorrectionId
				? {
						original: period.clockOut?.timestamp ?? null,
						requested: matchingClockOutCorrection?.timestamp ?? null,
					}
				: null,
		isOrphaned: isMetadataOrphaned || isLegacyOrphaned,
	};
}

/**
 * Time Correction Approval Handler
 */
export const TimeCorrectionHandler: ApprovalTypeHandler<WorkPeriodWithRelations> = {
	type: "time_entry",
	displayName: "Time Correction",
	icon: IconClockEdit,
	supportsBulkApprove: true,

	getApprovals: (params: ApprovalQueryParams) =>
		fetchApprovals({
			entityType: "time_entry",
			params,
			fetchEntitiesByIds: (entityIds) =>
				Effect.gen(function* (_) {
					const dbService = yield* _(DatabaseService);

					const periods = yield* _(
						dbService.query("batchGetWorkPeriods", async () => {
							return await dbService.db.query.workPeriod.findMany({
								where: inArray(workPeriod.id, entityIds),
								with: {
									employee: { with: { user: true } },
									clockIn: true,
									clockOut: true,
								},
							});
						}),
					);

					const typedPeriods = periods as WorkPeriodWithRelations[];
					const originalEntryIds = typedPeriods.flatMap((period) =>
						[period.clockIn.id, period.clockOut?.id].filter((id): id is string => Boolean(id)),
					);
					const employeeIds = [...new Set(typedPeriods.map((period) => period.employee.id))];
					const organizationIds = [
						...new Set(typedPeriods.map((period) => period.employee.organizationId)),
					];
					const correctionEntries =
						originalEntryIds.length > 0
							? yield* _(
									dbService.query("batchGetTimeCorrectionReviewEntries", async () => {
										return await dbService.db.query.timeEntry.findMany({
											where: and(
												eq(timeEntry.type, "correction"),
												inArray(timeEntry.employeeId, employeeIds),
												inArray(timeEntry.organizationId, organizationIds),
												inArray(timeEntry.replacesEntryId, originalEntryIds),
											),
										});
									}),
								)
							: [];

					const correctionEntriesByReplacedId = new Map<string, CorrectionEntryForReview[]>();
					for (const entry of correctionEntries as CorrectionEntryForReview[]) {
						if (!entry.replacesEntryId) continue;
						const entries = correctionEntriesByReplacedId.get(entry.replacesEntryId) ?? [];
						entries.push(entry);
						correctionEntriesByReplacedId.set(entry.replacesEntryId, entries);
					}

					const map = new Map<string, WorkPeriodWithRelations>();
					for (const period of typedPeriods) {
						period.correctionReviewEntries = [
							...(correctionEntriesByReplacedId.get(period.clockIn.id) ?? []),
							...(period.clockOut?.id
								? (correctionEntriesByReplacedId.get(period.clockOut.id) ?? [])
								: []),
						];
						map.set(period.id, period);
					}
					return map;
				}),
			filterEntity: (entity, params) => {
				// Apply team filter
				if (params.teamId && entity.employee.teamId !== params.teamId) {
					return false;
				}

				// Apply search filter
				if (params.search) {
					const searchLower = params.search.toLowerCase();
					const nameMatch = entity.employee.user.name.toLowerCase().includes(searchLower);
					const emailMatch = entity.employee.user.email.toLowerCase().includes(searchLower);
					if (!nameMatch && !emailMatch) return false;
				}

				return true;
			},
			transformToItem: (request, entity) => {
				const pendingCorrection = buildPendingCorrectionReview(
					entity,
					request,
					entity.correctionReviewEntries ?? [],
				);
				if (pendingCorrection.isOrphaned) {
					return null;
				}

				const priority = TimeCorrectionHandler.calculatePriority(entity, request.createdAt);
				const slaDeadline = TimeCorrectionHandler.calculateSLADeadline(entity, request.createdAt);

				return {
					id: request.id,
					approvalType: "time_entry",
					entityId: request.entityId,
					typeName: "Time Correction",
					requester: {
						id: entity.employee.id,
						userId: entity.employee.userId,
						name: entity.employee.user.name,
						email: entity.employee.user.email,
						image: entity.employee.user.image,
						teamId: entity.employee.teamId,
					},
					approverId: request.approverId,
					organizationId: request.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: request.approvedAt,
					priority,
					sla: buildSLAInfo(slaDeadline),
					display: TimeCorrectionHandler.getDisplayMetadata(entity),
				};
			},
		}),

	getCount: (approverId, organizationId, visibility) =>
		TimeCorrectionHandler.getApprovals({
			approverId,
			organizationId,
			status: "pending",
			limit: 1,
			...visibility,
		}).pipe(Effect.map((approvals) => approvals.length)),

	getDetail: (entityId, organizationId, context) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);

			// Fetch work period with full details
			const period = yield* _(
				dbService.query("getWorkPeriodDetail", async () => {
					return await dbService.db.query.workPeriod.findFirst({
						where: and(
							eq(workPeriod.id, entityId),
							...(organizationId ? [eq(workPeriod.organizationId, organizationId)] : []),
						),
						with: {
							employee: { with: { user: true } },
							clockIn: true,
							clockOut: true,
						},
					});
				}),
				Effect.flatMap((p) =>
					p
						? Effect.succeed(p as WorkPeriodWithRelations)
						: Effect.fail(
								new NotFoundError({
									message: "Work period not found",
									entityType: "work_period",
									entityId,
								}),
							),
				),
			);

			// Validate organization access
			if (organizationId && period.employee.organizationId !== organizationId) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Work period not found in this organization",
							entityType: "work_period",
							entityId,
						}),
					),
				);
			}

			// Fetch approval request
			const request = yield* _(
				dbService.query("getApprovalRequest", async () => {
					return await dbService.db.query.approvalRequest.findFirst({
						where: and(
							...(context?.approvalId ? [eq(approvalRequest.id, context.approvalId)] : []),
							...(organizationId ? [eq(approvalRequest.organizationId, organizationId)] : []),
							eq(approvalRequest.entityType, "time_entry"),
							eq(approvalRequest.entityId, entityId),
						),
						with: {
							approver: { with: { user: true } },
						},
					});
				}),
				Effect.flatMap((r) =>
					r
						? Effect.succeed(r)
						: Effect.fail(
								new NotFoundError({
									message: "Approval request not found",
									entityType: "approval_request",
								}),
							),
				),
			);

			const priority = TimeCorrectionHandler.calculatePriority(period, request.createdAt);
			const slaDeadline = TimeCorrectionHandler.calculateSLADeadline(period, request.createdAt);
			const correctionMetadata = correctionMetadataFromRequest(request);
			const correctionIds = [
				correctionMetadata?.clockInCorrectionId,
				correctionMetadata?.clockOutCorrectionId,
			].filter((id): id is string => Boolean(id));
			const replacesEntryIds = [period.clockIn.id, period.clockOut?.id].filter((id): id is string =>
				Boolean(id),
			);
			const correctionEntries = yield* _(
				dbService.query("getPendingCorrectionEntriesForReview", async () => {
					if (correctionIds.length === 0 && replacesEntryIds.length === 0) {
						return [];
					}

					return await dbService.db.query.timeEntry.findMany({
						where: and(
							eq(timeEntry.type, "correction"),
							eq(timeEntry.employeeId, period.employee.id),
							eq(timeEntry.organizationId, period.employee.organizationId),
							correctionIds.length > 0
								? inArray(timeEntry.id, correctionIds)
								: and(
										inArray(timeEntry.replacesEntryId, replacesEntryIds),
										eq(timeEntry.isSuperseded, false),
									),
						),
					});
				}),
			);
			const periodWithCorrection = {
				...period,
				pendingCorrection: buildPendingCorrectionReview(
					period,
					request,
					correctionEntries as CorrectionEntryForReview[],
				),
			};

			// Build timeline
			const timeline: ApprovalTimelineEvent[] = [
				{
					id: `${request.id}-created`,
					type: "created",
					performedBy: {
						name: period.employee.user.name,
						image: period.employee.user.image,
					},
					timestamp: request.createdAt,
					message: `${period.employee.user.name} requested a time correction`,
				},
			];

			if (request.status === "approved" && request.approvedAt) {
				timeline.push({
					id: `${request.id}-approved`,
					type: "approved",
					performedBy: request.approver
						? {
								name: request.approver.user.name,
								image: request.approver.user.image,
							}
						: null,
					timestamp: request.approvedAt,
					message: "Correction approved",
				});
			}

			if (request.status === "rejected" && request.approvedAt) {
				timeline.push({
					id: `${request.id}-rejected`,
					type: "rejected",
					performedBy: request.approver
						? {
								name: request.approver.user.name,
								image: request.approver.user.image,
							}
						: null,
					timestamp: request.approvedAt,
					message: request.rejectionReason
						? `Correction rejected: ${request.rejectionReason}`
						: "Correction rejected",
				});
			}

			return {
				approval: {
					id: request.id,
					approvalType: "time_entry",
					entityId: period.id,
					typeName: "Time Correction",
					requester: {
						id: period.employee.id,
						userId: period.employee.userId,
						name: period.employee.user.name,
						email: period.employee.user.email,
						image: period.employee.user.image,
						teamId: period.employee.teamId,
					},
					approverId: request.approverId,
					organizationId: period.employee.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: request.approvedAt,
					priority,
					sla: buildSLAInfo(slaDeadline),
					display: TimeCorrectionHandler.getDisplayMetadata(period),
				},
				entity: periodWithCorrection,
				timeline,
			} as ApprovalDetail<WorkPeriodWithRelations>;
		}),

	approve: (entityId, approverId, options) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);
			const currentEmployee = yield* _(loadCurrentApproverById(dbService, approverId));
			const { approveTimeCorrectionWithCurrentApproverEffect } = yield* _(
				Effect.promise(async () => import("@/lib/approvals/server/time-correction-approvals")),
			);

			yield* _(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					currentEmployee,
					entityId,
					options,
				),
			);
		}),

	reject: (entityId, approverId, reason, options) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);
			const currentEmployee = yield* _(loadCurrentApproverById(dbService, approverId));
			const { rejectTimeCorrectionWithCurrentApproverEffect } = yield* _(
				Effect.promise(async () => import("@/lib/approvals/server/time-correction-approvals")),
			);

			yield* _(
				rejectTimeCorrectionWithCurrentApproverEffect(
					dbService,
					currentEmployee,
					entityId,
					reason,
					options,
				),
			);
		}),

	calculatePriority: (_entity, createdAt) => {
		// Priority based on age of request
		const now = DateTime.now();
		const requestAge = now.diff(DateTime.fromJSDate(createdAt), "hours").hours;

		// Time corrections for payroll periods need faster turnaround
		if (requestAge > 72) return "urgent";
		if (requestAge > 48) return "high";
		if (requestAge > 24) return "normal";
		return "low";
	},

	calculateSLADeadline: (entity, createdAt) => {
		const priority = TimeCorrectionHandler.calculatePriority(entity, createdAt);
		return calculateSLADeadline("time_entry", priority, createdAt);
	},

	getDisplayMetadata: (entity) => {
		const date = DateTime.fromJSDate(entity.startTime).toFormat("LLL dd, yyyy");
		const startTime = formatTime(entity.startTime);
		const endTime = entity.endTime ? formatTime(entity.endTime) : "ongoing";
		const duration = formatDuration(entity.durationMinutes);

		return {
			title: "Time Correction",
			subtitle: `${date} - ${startTime} to ${endTime}`,
			summary: `${duration} on ${date}`,
			badge: {
				label: "Correction",
				color: null,
			},
			icon: "clock-edit",
		};
	},
};
