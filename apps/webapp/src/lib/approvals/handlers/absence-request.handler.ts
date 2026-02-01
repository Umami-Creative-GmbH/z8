/**
 * Absence Request Approval Handler
 *
 * Implements ApprovalTypeHandler for absence (time-off) requests.
 * Integrates with existing absence approval logic.
 */

import { IconCalendarOff } from "@tabler/icons-react";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { Effect } from "effect";
import { absenceEntry, approvalRequest } from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { NotFoundError } from "@/lib/effect/errors";
import { calculateBusinessDaysWithHalfDays, formatDateRange } from "@/lib/absences/date-utils";
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

// Type for absence entity with relations
interface AbsenceWithRelations {
	id: string;
	startDate: string;
	startPeriod: "full_day" | "am" | "pm";
	endDate: string;
	endPeriod: "full_day" | "am" | "pm";
	notes: string | null;
	status: "pending" | "approved" | "rejected";
	createdAt: Date;
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
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
}

/**
 * Absence Request Approval Handler
 */
export const AbsenceRequestHandler: ApprovalTypeHandler<AbsenceWithRelations> = {
	type: "absence_entry",
	displayName: "Absence Request",
	icon: IconCalendarOff,
	supportsBulkApprove: true,

	getApprovals: (params: ApprovalQueryParams) =>
		fetchApprovals({
			entityType: "absence_entry",
			params,
			fetchEntitiesByIds: (entityIds) =>
				Effect.gen(function* (_) {
					const dbService = yield* _(DatabaseService);

					const absences = yield* _(
						dbService.query("batchGetAbsences", async () => {
							return await dbService.db.query.absenceEntry.findMany({
								where: inArray(absenceEntry.id, entityIds),
								with: {
									category: true,
									employee: { with: { user: true } },
								},
							});
						}),
					);

					const map = new Map<string, AbsenceWithRelations>();
					for (const absence of absences) {
						map.set(absence.id, absence as AbsenceWithRelations);
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
				const priority = AbsenceRequestHandler.calculatePriority(entity, request.createdAt);
				const slaDeadline = AbsenceRequestHandler.calculateSLADeadline(entity, request.createdAt);

				return {
					id: request.id,
					approvalType: "absence_entry",
					entityId: request.entityId,
					typeName: "Absence Request",
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
					display: AbsenceRequestHandler.getDisplayMetadata(entity),
				};
			},
		}),

	getCount: (approverId, organizationId) =>
		getApprovalCount("absence_entry", approverId, organizationId),

	getDetail: (entityId, organizationId) =>
		Effect.gen(function* (_) {
			const dbService = yield* _(DatabaseService);

			// Fetch absence with full details
			const absence = yield* _(
				dbService.query("getAbsenceDetail", async () => {
					return await dbService.db.query.absenceEntry.findFirst({
						where: eq(absenceEntry.id, entityId),
						with: {
							category: true,
							employee: { with: { user: true } },
						},
					});
				}),
				Effect.flatMap((a) =>
					a
						? Effect.succeed(a as AbsenceWithRelations)
						: Effect.fail(
								new NotFoundError({
									message: "Absence not found",
									entityType: "absence_entry",
									entityId,
								}),
							),
				),
			);

			// Validate organization access
			if (organizationId && absence.employee.organizationId !== organizationId) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: "Absence not found in this organization",
							entityType: "absence_entry",
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
							eq(approvalRequest.entityType, "absence_entry"),
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

			const priority = AbsenceRequestHandler.calculatePriority(absence, request.createdAt);
			const slaDeadline = AbsenceRequestHandler.calculateSLADeadline(absence, request.createdAt);

			// Build timeline
			const timeline: ApprovalTimelineEvent[] = [
				{
					id: `${request.id}-created`,
					type: "created",
					performedBy: {
						name: absence.employee.user.name,
						image: absence.employee.user.image,
					},
					timestamp: request.createdAt,
					message: `${absence.employee.user.name} requested ${absence.category.name}`,
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
					message: "Request approved",
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
						? `Request rejected: ${request.rejectionReason}`
						: "Request rejected",
				});
			}

			return {
				approval: {
					id: request.id,
					approvalType: "absence_entry",
					entityId: absence.id,
					typeName: "Absence Request",
					requester: {
						id: absence.employee.id,
						userId: absence.employee.userId,
						name: absence.employee.user.name,
						email: absence.employee.user.email,
						image: absence.employee.user.image,
						teamId: absence.employee.teamId,
					},
					approverId: request.approverId,
					organizationId: absence.employee.organizationId,
					status: request.status,
					createdAt: request.createdAt,
					resolvedAt: request.approvedAt,
					priority,
					sla: buildSLAInfo(slaDeadline),
					display: AbsenceRequestHandler.getDisplayMetadata(absence),
				},
				entity: absence,
				timeline,
			} as ApprovalDetail<AbsenceWithRelations>;
		}),

	approve: (entityId, _approverId) =>
		Effect.gen(function* (_) {
			// Delegate to existing approval logic
			const { approveAbsenceEffect } = yield* _(
				Effect.promise(async () => import("@/app/[locale]/(app)/approvals/actions")),
			);

			const result = yield* _(Effect.promise(() => approveAbsenceEffect(entityId)));

			if (!result.success) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: result.error || "Failed to approve absence",
							entityType: "absence_entry",
							entityId,
						}),
					),
				);
			}
		}),

	reject: (entityId, _approverId, reason) =>
		Effect.gen(function* (_) {
			// Delegate to existing rejection logic
			const { rejectAbsenceEffect } = yield* _(
				Effect.promise(async () => import("@/app/[locale]/(app)/approvals/actions")),
			);

			const result = yield* _(Effect.promise(() => rejectAbsenceEffect(entityId, reason)));

			if (!result.success) {
				return yield* _(
					Effect.fail(
						new NotFoundError({
							message: result.error || "Failed to reject absence",
							entityType: "absence_entry",
							entityId,
						}),
					),
				);
			}
		}),

	calculatePriority: (entity, createdAt) => {
		// Priority based on:
		// 1. How soon the absence starts (urgent if <24h, high if <3 days)
		// 2. Age of the request (older = higher priority)
		// 3. Category type (sick leave often needs faster response)

		const now = DateTime.now();
		const startDate = DateTime.fromISO(entity.startDate);
		const requestAge = now.diff(DateTime.fromJSDate(createdAt), "hours").hours;
		const hoursUntilStart = startDate.diff(now, "hours").hours;

		// Very soon = urgent
		if (hoursUntilStart < 24) return "urgent";

		// Starting within 3 days = high
		if (hoursUntilStart < 72) return "high";

		// Old requests get bumped up
		if (requestAge > 48) return "high";
		if (requestAge > 24) return "normal";

		// Starting within a week = normal
		if (hoursUntilStart < 168) return "normal";

		// Everything else = low
		return "low";
	},

	calculateSLADeadline: (entity, createdAt) => {
		const priority = AbsenceRequestHandler.calculatePriority(entity, createdAt);
		return calculateSLADeadline("absence_entry", priority, createdAt);
	},

	getDisplayMetadata: (entity) => {
		const days = calculateBusinessDaysWithHalfDays(
			entity.startDate,
			entity.startPeriod,
			entity.endDate,
			entity.endPeriod,
			[],
		);

		const daysText = days === 1 ? "1 day" : `${days} days`;
		const dateRange = formatDateRange(entity.startDate, entity.endDate);

		return {
			title: entity.category.name,
			subtitle: dateRange,
			summary: `${daysText} off - ${dateRange}`,
			badge: {
				label: entity.category.name,
				color: entity.category.color,
			},
			icon: "calendar-off",
		};
	},
};
