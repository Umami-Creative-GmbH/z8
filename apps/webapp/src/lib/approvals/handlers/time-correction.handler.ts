/**
 * Time Correction Approval Handler
 *
 * Implements ApprovalTypeHandler for time entry correction requests.
 * Integrates with existing time correction approval logic.
 */

import { IconClockEdit } from "@tabler/icons-react";
import { and, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { Effect } from "effect";
import { approvalRequest, workPeriod } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { NotFoundError } from "@/lib/effect/errors";
import type {
	ApprovalDetail,
	ApprovalPriority,
	ApprovalQueryParams,
	ApprovalTimelineEvent,
	ApprovalTypeHandler,
	UnifiedApprovalItem,
} from "../domain/types";
import { calculateSLADeadline } from "../domain/sla-calculator";
import {
	fetchApprovals,
	getApprovalCount,
	buildSLAInfo,
	type ApprovalRequestRow,
} from "./base-handler";

// Type for work period entity with relations
interface WorkPeriodWithRelations {
	id: string;
	startTime: Date;
	endTime: Date | null;
	durationMinutes: number | null;
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

					const map = new Map<string, WorkPeriodWithRelations>();
					for (const period of periods) {
						map.set(period.id, period as WorkPeriodWithRelations);
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

	getCount: (approverId, organizationId) =>
		getApprovalCount("time_entry", approverId, organizationId),

	getDetail: (entityId, organizationId) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);

			// Fetch work period with full details
			const period = yield* _(
				dbService.query("getWorkPeriodDetail", async () => {
					return await dbService.db.query.workPeriod.findFirst({
						where: eq(workPeriod.id, entityId),
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
				entity: period,
				timeline,
			} as ApprovalDetail<WorkPeriodWithRelations>;
		}),

	approve: (entityId, _approverId) =>
		Effect.gen(function* (_) {
			// Delegate to existing approval logic
			const { approveTimeCorrectionEffect } = yield* _(
				Effect.promise(async () => import("@/app/[locale]/(app)/approvals/actions")),
			);

			const result = yield* _(Effect.promise(() => approveTimeCorrectionEffect(entityId)));

			if (!result.success) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: result.error || "Failed to approve time correction",
							entityType: "work_period",
							entityId,
						}),
					),
				);
			}
		}),

	reject: (entityId, _approverId, reason) =>
		Effect.gen(function* (_) {
			// Delegate to existing rejection logic
			const { rejectTimeCorrectionEffect } = yield* _(
				Effect.promise(async () => import("@/app/[locale]/(app)/approvals/actions")),
			);

			const result = yield* _(Effect.promise(() => rejectTimeCorrectionEffect(entityId, reason)));

			if (!result.success) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: result.error || "Failed to reject time correction",
							entityType: "work_period",
							entityId,
						}),
					),
				);
			}
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
