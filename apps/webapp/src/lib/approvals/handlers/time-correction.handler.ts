/**
 * Time Correction Approval Handler
 *
 * Implements ApprovalTypeHandler for time entry correction requests.
 * Integrates with existing time correction approval logic.
 */

import { IconClockEdit } from "@tabler/icons-react";
import { and, eq, exists, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { DateTime } from "luxon";
import { member } from "@/db/auth-schema";
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
import {
	classifyTimeRequest,
	classifyTimeRequestMetadata,
	type TimeRequestMetadataClassification,
} from "../time-request-metadata";
import { buildSLAInfo, fetchApprovals } from "./base-handler";

function loadCurrentApproverById(
	dbService: ApprovalDbService,
	approverId: string,
	organizationId: string,
) {
	return dbService
		.query("getApprovalActor", async () => {
			return await dbService.db.query.employee.findFirst({
				where: and(
					eq(employee.id, approverId),
					eq(employee.organizationId, organizationId),
					eq(employee.isActive, true),
					exists(
						dbService.db
							.select({ id: member.id })
							.from(member)
							.where(
								and(
									eq(member.userId, employee.userId),
									eq(member.organizationId, organizationId),
									eq(member.status, "approved"),
								),
							),
					),
				),
				columns: {
					id: true,
					userId: true,
					organizationId: true,
					role: true,
				},
				with: {
					user: {
						columns: { id: true, name: true, email: true, image: true },
					},
				},
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
	pendingChanges?: unknown;
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

type WorkPeriodRow = Omit<WorkPeriodWithRelations, "clockIn" | "clockOut"> & {
	clockInId: string;
	clockOutId: string | null;
};

type OriginalEntryForReview = WorkPeriodWithRelations["clockIn"] & {
	employeeId: string;
};

type TimeCorrectionAction = "edit" | "delete";

interface PendingTimeCorrectionReview {
	action: TimeCorrectionAction;
	clockIn: { original: Date; requested: Date | null };
	clockOut: { original: Date | null; requested: Date | null } | null;
	isOrphaned: boolean;
}

export function buildWorkPeriodDetailEntity(period: WorkPeriodWithRelations) {
	return {
		id: period.id,
		startTime: period.startTime,
		endTime: period.endTime,
		durationMinutes: period.durationMinutes,
		employee: {
			id: period.employee.id,
			userId: period.employee.userId,
			teamId: period.employee.teamId,
			organizationId: period.employee.organizationId,
			user: {
				id: period.employee.user.id,
				name: period.employee.user.name,
				email: period.employee.user.email,
				image: period.employee.user.image,
			},
		},
		clockIn: {
			id: period.clockIn.id,
			timestamp: period.clockIn.timestamp,
		},
		clockOut: period.clockOut
			? { id: period.clockOut.id, timestamp: period.clockOut.timestamp }
			: null,
		...(period.pendingCorrection
			? { pendingCorrection: period.pendingCorrection }
			: {}),
	};
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

export function buildTimeRequestDisplayMetadata(
	entity: Pick<
		WorkPeriodWithRelations,
		"startTime" | "endTime" | "durationMinutes"
	>,
	classification: TimeRequestMetadataClassification = { kind: "legacy" },
) {
	const date = DateTime.fromJSDate(entity.startTime).toFormat("LLL dd, yyyy");
	const startTime = formatTime(entity.startTime);
	const endTime = entity.endTime ? formatTime(entity.endTime) : "ongoing";
	const duration = formatDuration(entity.durationMinutes);
	const ordinaryTitle =
		classification.kind === "ordinary"
			? classification.requestKind === "manual_time_submission"
				? "Manual Time Entry"
				: "Clock-out Approval"
			: null;

	return {
		title: ordinaryTitle ?? "Time Correction",
		subtitle: `${date} - ${startTime} to ${endTime}`,
		summary: `${duration} on ${date}`,
		badge: {
			label: ordinaryTitle ? "Time Request" : "Correction",
			color: null,
		},
		icon: "clock-edit",
	};
}

function correctionMetadataFromRequest(request: {
	metadata?: unknown;
}): TimeRequestMetadataClassification {
	return classifyTimeRequestMetadata(request.metadata);
}

export { classifyTimeRequest, classifyTimeRequestMetadata };

export function buildPendingCorrectionReview(
	period: WorkPeriodWithRelations,
	request: { metadata?: unknown; reason?: string | null },
	correctionEntries: CorrectionEntryForReview[],
): PendingTimeCorrectionReview {
	const metadata = classifyTimeRequest({
		metadata: request.metadata,
		reason: request.reason,
		pendingChanges: period.pendingChanges,
		clockInId: period.clockIn.id,
		clockOutId: period.clockOut?.id ?? null,
		correctionEntries,
	});
	const explicitMetadata = metadata.kind === "correction" ? metadata : null;
	const correctionById = new Map(
		correctionEntries.map((entry) => [entry.id, entry]),
	);
	const legacyCorrectionEntries = correctionEntries.filter(
		(entry) => !entry.isSuperseded,
	);
	const clockInCandidates = legacyCorrectionEntries.filter(
		(entry) => entry.replacesEntryId === period.clockIn.id,
	);
	const clockOutCandidates = period.clockOut
		? legacyCorrectionEntries.filter(
				(entry) => entry.replacesEntryId === period.clockOut?.id,
			)
		: [];
	const clockInCorrection = explicitMetadata?.clockInCorrectionId
		? correctionById.get(explicitMetadata.clockInCorrectionId)
		: metadata.kind === "legacy" && clockInCandidates.length === 1
			? clockInCandidates[0]
			: undefined;
	const clockOutCorrection = explicitMetadata?.clockOutCorrectionId
		? correctionById.get(explicitMetadata.clockOutCorrectionId)
		: metadata.kind === "legacy" && clockOutCandidates.length === 1
			? clockOutCandidates[0]
			: undefined;
	const matchingClockInCorrection =
		clockInCorrection?.replacesEntryId === period.clockIn.id
			? clockInCorrection
			: null;
	const matchingClockOutCorrection =
		clockOutCorrection?.replacesEntryId === period.clockOut?.id
			? clockOutCorrection
			: null;
	const hasMetadataCorrectionIds =
		metadata.kind !== "legacy" && metadata.kind !== "unclassified";
	const isMetadataOrphaned =
		metadata.kind === "invalid" ||
		metadata.kind === "unclassified" ||
		Boolean(
			explicitMetadata?.clockInCorrectionId && !matchingClockInCorrection,
		) ||
		Boolean(
			explicitMetadata?.clockOutCorrectionId && !matchingClockOutCorrection,
		);
	const isLegacyOrphaned =
		!hasMetadataCorrectionIds &&
		(!matchingClockInCorrection ||
			clockInCandidates.length > 1 ||
			clockOutCandidates.length > 1);

	return {
		action: explicitMetadata?.action ?? "edit",
		clockIn: {
			original: period.clockIn.timestamp,
			requested: matchingClockInCorrection?.timestamp ?? null,
		},
		clockOut:
			period.clockOut || explicitMetadata?.clockOutCorrectionId
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
export const TimeCorrectionHandler: ApprovalTypeHandler<WorkPeriodWithRelations> =
	{
		type: "time_entry",
		displayName: "Time Correction",
		icon: IconClockEdit,
		supportsBulkApprove: true,

		getApprovals: (params: ApprovalQueryParams) =>
			fetchApprovals({
				entityType: "time_entry",
				params,
				fetchEntitiesByIds: (entityIds, requests) =>
					Effect.gen(function* (_) {
						const dbService = yield* _(DatabaseService);

						const periods = yield* _(
							dbService.query("batchGetWorkPeriods", async () => {
								return await dbService.db.query.workPeriod.findMany({
									where: and(
										inArray(workPeriod.id, entityIds),
										eq(workPeriod.organizationId, params.organizationId),
									),
									columns: {
										id: true,
										startTime: true,
										endTime: true,
										durationMinutes: true,
										pendingChanges: true,
										clockInId: true,
										clockOutId: true,
									},
									with: {
										employee: {
											columns: {
												id: true,
												userId: true,
												teamId: true,
												organizationId: true,
											},
											with: {
												user: {
													columns: {
														id: true,
														name: true,
														email: true,
														image: true,
													},
												},
											},
										},
									},
								});
							}),
						);

						const periodRows = periods as WorkPeriodRow[];
						const periodRowsById = new Map(
							periodRows.map((period) => [period.id, period] as const),
						);
						const correctionPeriodIds = new Set(
							requests.flatMap((request) => {
								const period = periodRowsById.get(request.entityId);
								if (!period) return [];
								const classification = classifyTimeRequest({
									metadata: request.metadata,
									reason: request.reason,
									pendingChanges: period.pendingChanges,
									clockInId: period.clockInId,
									clockOutId: period.clockOutId,
									correctionEntries: [],
								});
								return classification.kind !== "ordinary" &&
									classification.kind !== "invalid"
									? [request.entityId]
									: [];
							}),
						);
						const correctionPeriodRows = periodRows.filter((period) =>
							correctionPeriodIds.has(period.id),
						);
						const originalEntryIds = periodRows.flatMap((period) =>
							[period.clockInId, period.clockOutId].filter((id): id is string =>
								Boolean(id),
							),
						);
						const employeeIds = [
							...new Set(periodRows.map((period) => period.employee.id)),
						];
						const originalEntries =
							originalEntryIds.length > 0
								? yield* _(
										dbService.query("batchGetOriginalTimeEntries", async () => {
											return await dbService.db.query.timeEntry.findMany({
												where: and(
													inArray(timeEntry.id, originalEntryIds),
													inArray(timeEntry.employeeId, employeeIds),
													eq(timeEntry.organizationId, params.organizationId),
												),
												columns: {
													id: true,
													timestamp: true,
													employeeId: true,
												},
											});
										}),
									)
								: [];
						const originalEntriesById = new Map(
							(originalEntries as OriginalEntryForReview[]).map((entry) => [
								entry.id,
								entry,
							]),
						);
						const correctionOriginalEntryIds = correctionPeriodRows.flatMap(
							(period) =>
								[period.clockInId, period.clockOutId].filter(
									(id): id is string => Boolean(id),
								),
						);
						const correctionEntries =
							correctionOriginalEntryIds.length > 0
								? yield* _(
										dbService.query(
											"batchGetTimeCorrectionReviewEntries",
											async () => {
												return await dbService.db.query.timeEntry.findMany({
													where: and(
														eq(timeEntry.type, "correction"),
														inArray(timeEntry.employeeId, employeeIds),
														eq(timeEntry.organizationId, params.organizationId),
														inArray(
															timeEntry.replacesEntryId,
															correctionOriginalEntryIds,
														),
													),
													columns: {
														id: true,
														timestamp: true,
														replacesEntryId: true,
														isSuperseded: true,
													},
												});
											},
										),
									)
								: [];

						const correctionEntriesByReplacedId = new Map<
							string,
							CorrectionEntryForReview[]
						>();
						for (const entry of correctionEntries as CorrectionEntryForReview[]) {
							if (!entry.replacesEntryId) continue;
							const entries =
								correctionEntriesByReplacedId.get(entry.replacesEntryId) ?? [];
							entries.push(entry);
							correctionEntriesByReplacedId.set(entry.replacesEntryId, entries);
						}

						const map = new Map<string, WorkPeriodWithRelations>();
						for (const periodRow of periodRows) {
							const clockIn = originalEntriesById.get(periodRow.clockInId);
							const clockOut = periodRow.clockOutId
								? originalEntriesById.get(periodRow.clockOutId)
								: null;
							if (!clockIn || clockIn.employeeId !== periodRow.employee.id)
								continue;
							if (
								periodRow.clockOutId &&
								(!clockOut || clockOut.employeeId !== periodRow.employee.id)
							) {
								continue;
							}
							const period: WorkPeriodWithRelations = {
								...periodRow,
								clockIn,
								clockOut: clockOut ?? null,
							};
							period.correctionReviewEntries = [
								...(correctionEntriesByReplacedId.get(period.clockIn.id) ?? []),
								...(period.clockOut?.id
									? (correctionEntriesByReplacedId.get(period.clockOut.id) ??
										[])
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
						const nameMatch = entity.employee.user.name
							.toLowerCase()
							.includes(searchLower);
						const emailMatch = entity.employee.user.email
							.toLowerCase()
							.includes(searchLower);
						if (!nameMatch && !emailMatch) return false;
					}

					return true;
				},
				transformToItem: (request, entity) => {
					const classification = classifyTimeRequest({
						metadata: request.metadata,
						reason: request.reason,
						pendingChanges: entity.pendingChanges,
						clockInId: entity.clockIn.id,
						clockOutId: entity.clockOut?.id ?? null,
						correctionEntries: entity.correctionReviewEntries ?? [],
					});
					if (
						classification.kind === "invalid" ||
						classification.kind === "unclassified"
					) {
						return null;
					}
					if (classification.kind !== "ordinary") {
						const pendingCorrection = buildPendingCorrectionReview(
							entity,
							request,
							entity.correctionReviewEntries ?? [],
						);
						if (pendingCorrection.isOrphaned) return null;
					}

					const priority = TimeCorrectionHandler.calculatePriority(
						entity,
						request.createdAt,
					);
					const slaDeadline = TimeCorrectionHandler.calculateSLADeadline(
						entity,
						request.createdAt,
					);

					return {
						id: request.id,
						approvalType: "time_entry",
						entityId: request.entityId,
						typeName: buildTimeRequestDisplayMetadata(entity, classification)
							.title,
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
						display: buildTimeRequestDisplayMetadata(entity, classification),
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
				if (!organizationId) {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Work period not found",
								entityType: "work_period",
								entityId,
							}),
						),
					);
				}

				// Fetch work period with full details
				const periodRow = yield* _(
					dbService.query("getWorkPeriodDetail", async () => {
						return await dbService.db.query.workPeriod.findFirst({
							where: and(
								eq(workPeriod.id, entityId),
								eq(workPeriod.organizationId, organizationId),
							),
							columns: {
								id: true,
								startTime: true,
								endTime: true,
								durationMinutes: true,
								pendingChanges: true,
								clockInId: true,
								clockOutId: true,
							},
							with: {
								employee: {
									columns: {
										id: true,
										userId: true,
										teamId: true,
										organizationId: true,
									},
									with: {
										user: {
											columns: {
												id: true,
												name: true,
												email: true,
												image: true,
											},
										},
									},
								},
							},
						});
					}),
					Effect.flatMap((p) =>
						p
							? Effect.succeed(p as WorkPeriodRow)
							: Effect.fail(
									new NotFoundError({
										message: "Work period not found",
										entityType: "work_period",
										entityId,
									}),
								),
					),
				);
				const originalEntryIds = [
					periodRow.clockInId,
					periodRow.clockOutId,
				].filter((id): id is string => Boolean(id));
				const originalEntries = yield* _(
					dbService.query("getOriginalTimeEntriesForDetail", async () => {
						return await dbService.db.query.timeEntry.findMany({
							where: and(
								inArray(timeEntry.id, originalEntryIds),
								eq(timeEntry.employeeId, periodRow.employee.id),
								eq(timeEntry.organizationId, organizationId),
							),
							columns: { id: true, timestamp: true, employeeId: true },
						});
					}),
				);
				const originalEntriesById = new Map(
					(originalEntries as OriginalEntryForReview[]).map((entry) => [
						entry.id,
						entry,
					]),
				);
				const clockIn = originalEntriesById.get(periodRow.clockInId);
				const clockOut = periodRow.clockOutId
					? originalEntriesById.get(periodRow.clockOutId)
					: null;
				if (!clockIn || (periodRow.clockOutId && !clockOut)) {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Work period not found",
								entityType: "work_period",
								entityId,
							}),
						),
					);
				}
				const period: WorkPeriodWithRelations = {
					...periodRow,
					clockIn,
					clockOut: clockOut ?? null,
				};

				// Fetch approval request
				const request = yield* _(
					dbService.query("getApprovalRequest", async () => {
						return await dbService.db.query.approvalRequest.findFirst({
							where: and(
								...(context?.approvalId
									? [eq(approvalRequest.id, context.approvalId)]
									: []),
								eq(approvalRequest.organizationId, organizationId),
								eq(approvalRequest.entityType, "time_entry"),
								eq(approvalRequest.entityId, entityId),
							),
							columns: {
								id: true,
								approverId: true,
								organizationId: true,
								status: true,
								createdAt: true,
								approvedAt: true,
								rejectionReason: true,
								reason: true,
								metadata: true,
							},
							with: {
								approver: {
									columns: { id: true },
									with: {
										user: { columns: { name: true, image: true } },
									},
								},
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

				const priority = TimeCorrectionHandler.calculatePriority(
					period,
					request.createdAt,
				);
				const slaDeadline = TimeCorrectionHandler.calculateSLADeadline(
					period,
					request.createdAt,
				);
				const correctionMetadata = correctionMetadataFromRequest(request);
				const correctionIds = [
					correctionMetadata.kind === "correction"
						? correctionMetadata.clockInCorrectionId
						: undefined,
					correctionMetadata.kind === "correction"
						? correctionMetadata.clockOutCorrectionId
						: undefined,
				].filter((id): id is string => Boolean(id));
				const replacesEntryIds = [
					period.clockIn.id,
					period.clockOut?.id,
				].filter((id): id is string => Boolean(id));
				const correctionEntries =
					correctionMetadata.kind === "ordinary" ||
					correctionMetadata.kind === "invalid"
						? []
						: yield* _(
								dbService.query(
									"getPendingCorrectionEntriesForReview",
									async () => {
										if (
											correctionIds.length === 0 &&
											replacesEntryIds.length === 0
										) {
											return [];
										}

										return await dbService.db.query.timeEntry.findMany({
											where: and(
												eq(timeEntry.type, "correction"),
												eq(timeEntry.employeeId, period.employee.id),
												eq(
													timeEntry.organizationId,
													period.employee.organizationId,
												),
												correctionIds.length > 0
													? inArray(timeEntry.id, correctionIds)
													: and(
															inArray(
																timeEntry.replacesEntryId,
																replacesEntryIds,
															),
															eq(timeEntry.isSuperseded, false),
														),
											),
											columns: {
												id: true,
												timestamp: true,
												replacesEntryId: true,
												isSuperseded: true,
											},
										});
									},
								),
							);
				const resolvedClassification = classifyTimeRequest({
					metadata: request.metadata,
					reason: request.reason,
					pendingChanges: period.pendingChanges,
					clockInId: period.clockIn.id,
					clockOutId: period.clockOut?.id ?? null,
					correctionEntries: correctionEntries as CorrectionEntryForReview[],
				});
				const periodWithCorrection = buildWorkPeriodDetailEntity(
					resolvedClassification.kind === "ordinary"
						? period
						: {
								...period,
								pendingCorrection: buildPendingCorrectionReview(
									period,
									request,
									correctionEntries as CorrectionEntryForReview[],
								),
							},
				);

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
						typeName: buildTimeRequestDisplayMetadata(
							period,
							resolvedClassification,
						).title,
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
						display: buildTimeRequestDisplayMetadata(
							period,
							resolvedClassification,
						),
					},
					entity: periodWithCorrection,
					timeline,
				} as ApprovalDetail<ReturnType<typeof buildWorkPeriodDetailEntity>>;
			}),

		approve: (entityId, approverId, options) =>
			Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);
				const organizationId = (
					options as { organizationId?: string } | undefined
				)?.organizationId;
				if (!organizationId) {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
								entityId: approverId,
							}),
						),
					);
				}
				const currentEmployee = yield* _(
					loadCurrentApproverById(dbService, approverId, organizationId),
				);
				const { processTimeRequestWithCurrentApproverEffect } = yield* _(
					Effect.promise(
						async () => import("@/lib/approvals/server/time-request-approvals"),
					),
				);

				yield* _(
					processTimeRequestWithCurrentApproverEffect(
						dbService,
						currentEmployee,
						entityId,
						"approve",
						undefined,
						options,
					),
				);
			}),

		reject: (entityId, approverId, reason, options) =>
			Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);
				const organizationId = (
					options as { organizationId?: string } | undefined
				)?.organizationId;
				if (!organizationId) {
					return yield* _(
						Effect.fail(
							new NotFoundError({
								message: "Employee profile not found",
								entityType: "employee",
								entityId: approverId,
							}),
						),
					);
				}
				const currentEmployee = yield* _(
					loadCurrentApproverById(dbService, approverId, organizationId),
				);
				const { processTimeRequestWithCurrentApproverEffect } = yield* _(
					Effect.promise(
						async () => import("@/lib/approvals/server/time-request-approvals"),
					),
				);

				yield* _(
					processTimeRequestWithCurrentApproverEffect(
						dbService,
						currentEmployee,
						entityId,
						"reject",
						reason,
						options,
					),
				);
			}),

		calculatePriority: (_entity, createdAt) => {
			// Priority based on age of request
			const now = DateTime.now();
			const requestAge = now.diff(
				DateTime.fromJSDate(createdAt),
				"hours",
			).hours;

			// Time corrections for payroll periods need faster turnaround
			if (requestAge > 72) return "urgent";
			if (requestAge > 48) return "high";
			if (requestAge > 24) return "normal";
			return "low";
		},

		calculateSLADeadline: (entity, createdAt) => {
			const priority = TimeCorrectionHandler.calculatePriority(
				entity,
				createdAt,
			);
			return calculateSLADeadline("time_entry", priority, createdAt);
		},

		getDisplayMetadata: (entity) => {
			return buildTimeRequestDisplayMetadata(entity);
		},
	};
