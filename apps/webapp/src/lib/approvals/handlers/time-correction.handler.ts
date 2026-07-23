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
import {
	approvalChainStageInstance,
	approvalRequest,
	employee,
	timeEntry,
	workPeriod,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatCapturedOffsetInstant } from "@/lib/datetime/temporal-format";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
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
	classifyTimeApprovalRequest,
	hasAttemptedOrdinaryTimeApprovalEvidence,
	type TimeApprovalKind,
} from "../time-request-kind";
import { buildSLAInfo, fetchApprovals } from "./base-handler";

function loadCurrentApproverById(
	dbService: ApprovalDbService,
	approverId: string,
) {
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
	pendingChanges: unknown;
	pendingCorrection?: PendingTimeCorrectionReview;
	timeApprovalKind?: TimeApprovalKind;
	timeRequestWarning?: string | null;
	timeRequestActionable?: boolean;
	timeRequestHasOrdinaryEvidence?: boolean;
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
		utcOffsetMinutes?: number;
		timezone?: string | null;
	};
	clockOut: {
		id: string;
		timestamp: Date;
		utcOffsetMinutes?: number;
		timezone?: string | null;
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

interface PublicApprovalStage {
	name: string;
	order: number;
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

function formatCapturedEndpoint(
	entry: { timestamp: Date; utcOffsetMinutes?: number },
	preset: "dateMedium" | "time",
) {
	return typeof entry.utcOffsetMinutes === "number"
		? formatCapturedOffsetInstant(instantFromDate(entry.timestamp), {
				locale: "en-US",
				timeFormat: "24h",
				offsetMinutes: entry.utcOffsetMinutes,
				preset,
			})
		: preset === "time"
			? formatTime(entry.timestamp)
			: DateTime.fromJSDate(entry.timestamp).toFormat("LLL dd, yyyy");
}

function correctionMetadataFromRequest(request: { metadata?: unknown }) {
	return (request.metadata as TimeCorrectionApprovalMetadata | null)
		?.timeCorrection;
}

const UNCLASSIFIED_TIME_APPROVAL_WARNING =
	"This legacy time approval could not be classified. Reconcile it before making a decision.";

function displayMetadataForKind(
	period: WorkPeriodWithRelations,
	kind: TimeApprovalKind,
	stage?: PublicApprovalStage,
) {
	const date = formatCapturedEndpoint(period.clockIn, "dateMedium");
	const startTime = formatCapturedEndpoint(period.clockIn, "time");
	const endTime = period.clockOut
		? formatCapturedEndpoint(period.clockOut, "time")
		: "ongoing";
	const duration = formatDuration(period.durationMinutes);
	const common = {
		subtitle: `${date} - ${startTime} to ${endTime}`,
		summary: `${duration} on ${date}`,
	};
	const ordinaryStage = stage ? { stage } : {};

	switch (kind) {
		case "manual_time_submission":
			return {
				...common,
				...ordinaryStage,
				title: "Manual Time Submission",
				badge: { label: "Manual", color: null },
				icon: "clock-plus",
			};
		case "policy_clock_out":
			return {
				...common,
				...ordinaryStage,
				title: "Clock-out Approval",
				badge: { label: "Clock-out", color: null },
				icon: "clock-check",
			};
		case "unclassified":
			return {
				...common,
				summary: UNCLASSIFIED_TIME_APPROVAL_WARNING,
				title: "Unclassified Time Approval",
				badge: { label: "Needs reconciliation", color: null },
				icon: "alert-triangle",
			};
		default:
			return {
				...common,
				title: "Time Correction",
				badge: { label: "Correction", color: null },
				icon: "clock-edit",
			};
	}
}

export function buildTimeApprovalTimelineMessage(
	kind: TimeApprovalKind,
	status: "approved" | "rejected",
	rejectionReason?: string,
) {
	const label =
		kind === "manual_time_submission"
			? "Manual time submission"
			: kind === "policy_clock_out"
				? "Clock-out"
				: kind === "time_correction"
					? "Correction"
					: "Time approval";
	return status === "rejected" && rejectionReason
		? `${label} rejected: ${rejectionReason}`
		: `${label} ${status}`;
}

function activeRelationalCorrectionCandidates(
	period: Pick<WorkPeriodWithRelations, "clockIn" | "clockOut">,
	correctionEntries: CorrectionEntryForReview[],
) {
	const endpointIds = new Set(
		[period.clockIn.id, period.clockOut?.id].filter((id): id is string =>
			Boolean(id),
		),
	);
	return correctionEntries.filter(
		(entry) =>
			entry.isSuperseded !== true &&
			Boolean(entry.replacesEntryId && endpointIds.has(entry.replacesEntryId)),
	);
}

export function buildTimeApprovalReview(
	period: WorkPeriodWithRelations,
	request: {
		metadata?: unknown;
		reason?: string | null;
		publicStage?: PublicApprovalStage;
	},
	correctionEntries: CorrectionEntryForReview[],
) {
	const verifiedCorrections = activeRelationalCorrectionCandidates(
		period,
		correctionEntries,
	);
	const kind = classifyTimeApprovalRequest({
		metadata: request.metadata,
		reason: request.reason,
		pendingChanges: period.pendingChanges,
		verifiedRelationalCorrectionIds: verifiedCorrections.map(
			(entry) => entry.id,
		),
		verifiedRelationalCorrectionIdsByEndpoint: {
			clockIn: verifiedCorrections
				.filter((entry) => entry.replacesEntryId === period.clockIn.id)
				.map((entry) => entry.id),
			clockOut: verifiedCorrections
				.filter((entry) => entry.replacesEntryId === period.clockOut?.id)
				.map((entry) => entry.id),
		},
	});
	const hasOrdinaryEvidence =
		kind !== "time_correction" &&
		hasAttemptedOrdinaryTimeApprovalEvidence({
			metadata: request.metadata,
			reason: request.reason,
			pendingChanges: period.pendingChanges,
		});

	return {
		kind,
		hasOrdinaryEvidence,
		isActionable: kind !== "unclassified",
		warning:
			kind === "unclassified" ? UNCLASSIFIED_TIME_APPROVAL_WARNING : null,
		display: displayMetadataForKind(period, kind, request.publicStage),
		...(kind === "time_correction"
			? {
					pendingCorrection: buildPendingCorrectionReview(
						period,
						request,
						correctionEntries,
					),
				}
			: {}),
	};
}

function stageOrderFromMetadata(metadata: unknown): number {
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
		return 1;
	const value = metadata as Record<string, unknown>;
	for (const [key, orderKey] of [
		["stage", "sequence"],
		["approvalChain", "stageOrder"],
	] as const) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) continue;
		const marker = descriptor.value;
		if (!marker || typeof marker !== "object" || Array.isArray(marker))
			continue;
		const orderDescriptor = Object.getOwnPropertyDescriptor(marker, orderKey);
		if (!orderDescriptor?.enumerable || !("value" in orderDescriptor)) continue;
		const order = orderDescriptor.value;
		if (Number.isSafeInteger(order) && (order as number) > 0)
			return order as number;
	}
	return 1;
}

function publicStage(
	request: { metadata?: unknown },
	stage?: { labelSnapshot: string; stepOrder: number },
): PublicApprovalStage {
	return stage &&
		stage.labelSnapshot.length > 0 &&
		Number.isSafeInteger(stage.stepOrder) &&
		stage.stepOrder > 0
		? { name: stage.labelSnapshot, order: stage.stepOrder }
		: { name: "Approval", order: stageOrderFromMetadata(request.metadata) };
}

export function buildPendingCorrectionReview(
	period: WorkPeriodWithRelations,
	request: { metadata?: unknown },
	correctionEntries: CorrectionEntryForReview[],
): PendingTimeCorrectionReview {
	const metadata = correctionMetadataFromRequest(request);
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
		clockInCorrection?.replacesEntryId === period.clockIn.id
			? clockInCorrection
			: null;
	const matchingClockOutCorrection =
		clockOutCorrection?.replacesEntryId === period.clockOut?.id
			? clockOutCorrection
			: null;
	const hasMetadataCorrectionIds = Boolean(
		metadata?.clockInCorrectionId || metadata?.clockOutCorrectionId,
	);
	const isMetadataOrphaned =
		Boolean(metadata?.clockInCorrectionId && !matchingClockInCorrection) ||
		Boolean(metadata?.clockOutCorrectionId && !matchingClockOutCorrection);
	const isLegacyOrphaned =
		!hasMetadataCorrectionIds &&
		(!matchingClockInCorrection ||
			clockInCandidates.length > 1 ||
			clockOutCandidates.length > 1);

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
									with: {
										employee: { with: { user: true } },
										clockIn: true,
										clockOut: true,
									},
								});
							}),
						);

						const requestsByEntityId = new Map<string, typeof requests>();
						for (const request of requests) {
							requestsByEntityId.set(request.entityId, [
								...(requestsByEntityId.get(request.entityId) ?? []),
								request,
							]);
						}
						const typedPeriods = (periods as WorkPeriodWithRelations[]).filter(
							(period) =>
								period.employee.organizationId === params.organizationId &&
								(requestsByEntityId.get(period.id) ?? []).some(
									(request) =>
										request.organizationId === params.organizationId &&
										request.requestedBy === period.employee.id,
								),
						);
						const originalEntryIds = typedPeriods.flatMap((period) =>
							[period.clockIn.id, period.clockOut?.id].filter(
								(id): id is string => Boolean(id),
							),
						);
						const employeeIds = [
							...new Set(typedPeriods.map((period) => period.employee.id)),
						];
						const organizationIds = [
							...new Set(
								typedPeriods.map((period) => period.employee.organizationId),
							),
						];
						const correctionEntries =
							originalEntryIds.length > 0
								? yield* _(
										dbService.query(
											"batchGetTimeCorrectionReviewEntries",
											async () => {
												return await dbService.db.query.timeEntry.findMany({
													where: and(
														eq(timeEntry.type, "correction"),
														inArray(timeEntry.employeeId, employeeIds),
														inArray(timeEntry.organizationId, organizationIds),
														inArray(
															timeEntry.replacesEntryId,
															originalEntryIds,
														),
													),
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
						for (const period of typedPeriods) {
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
				fetchRequestContexts: (requests) =>
					Effect.gen(function* (_) {
						if (requests.length === 0)
							return new Map<string, PublicApprovalStage>();
						const dbService = yield* _(DatabaseService);
						const stages = yield* _(
							dbService.query("batchGetTimeApprovalPublicStages", async () => {
								return await dbService.db.query.approvalChainStageInstance.findMany(
									{
										where: and(
											eq(
												approvalChainStageInstance.organizationId,
												params.organizationId,
											),
											inArray(
												approvalChainStageInstance.approvalRequestId,
												requests.map((request) => request.id),
											),
										),
										columns: {
											approvalRequestId: true,
											labelSnapshot: true,
											stepOrder: true,
										},
									},
								);
							}),
						);
						const stagesByRequest = new Map(
							stages.flatMap((stage) =>
								stage.approvalRequestId
									? [[stage.approvalRequestId, stage] as const]
									: [],
							),
						);
						return new Map(
							requests.map((request) => [
								request.id,
								publicStage(request, stagesByRequest.get(request.id)),
							]),
						);
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
				transformToItem: (request, entity, stage) => {
					if (
						entity.employee.organizationId !== request.organizationId ||
						request.requestedBy !== entity.employee.id
					) {
						return null;
					}
					const review = buildTimeApprovalReview(
						entity,
						{ ...request, publicStage: stage },
						entity.correctionReviewEntries ?? [],
					);
					if (review.pendingCorrection?.isOrphaned) {
						return null;
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
						typeName: review.display.title,
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
						display: review.display,
						isActionable: review.isActionable,
						warning: review.warning,
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
								...(organizationId
									? [eq(workPeriod.organizationId, organizationId)]
									: []),
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
				if (
					organizationId &&
					period.employee.organizationId !== organizationId
				) {
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
								...(context?.approvalId
									? [eq(approvalRequest.id, context.approvalId)]
									: []),
								...(organizationId
									? [eq(approvalRequest.organizationId, organizationId)]
									: []),
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
				if (
					request.organizationId !== period.employee.organizationId ||
					request.requestedBy !== period.employee.id
				) {
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
				const chainStage = yield* _(
					dbService.query("getTimeApprovalPublicStage", async () => {
						return await dbService.db.query.approvalChainStageInstance.findFirst(
							{
								where: and(
									eq(
										approvalChainStageInstance.organizationId,
										period.employee.organizationId,
									),
									eq(approvalChainStageInstance.approvalRequestId, request.id),
								),
								columns: { labelSnapshot: true, stepOrder: true },
							},
						);
					}),
				);

				const priority = TimeCorrectionHandler.calculatePriority(
					period,
					request.createdAt,
				);
				const slaDeadline = TimeCorrectionHandler.calculateSLADeadline(
					period,
					request.createdAt,
				);
				const initialKind = classifyTimeApprovalRequest({
					metadata: request.metadata,
					reason: request.reason,
					pendingChanges: period.pendingChanges,
				});
				const correctionMetadata = correctionMetadataFromRequest(request);
				const correctionIds = [
					correctionMetadata?.clockInCorrectionId,
					correctionMetadata?.clockOutCorrectionId,
				].filter((id): id is string => Boolean(id));
				const replacesEntryIds = [
					period.clockIn.id,
					period.clockOut?.id,
				].filter((id): id is string => Boolean(id));
				const correctionEntries =
					initialKind === "manual_time_submission" ||
					initialKind === "policy_clock_out"
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
										});
									},
								),
							);
				const review = buildTimeApprovalReview(
					period,
					{
						...request,
						publicStage: publicStage(request, chainStage ?? undefined),
					},
					correctionEntries as CorrectionEntryForReview[],
				);
				const periodWithReview = {
					...period,
					timeApprovalKind: review.kind,
					timeRequestHasOrdinaryEvidence: review.hasOrdinaryEvidence,
					timeRequestWarning: review.warning,
					timeRequestActionable: review.isActionable,
					...(review.pendingCorrection
						? { pendingCorrection: review.pendingCorrection }
						: {}),
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
						message: `${period.employee.user.name} requested ${review.display.title.toLowerCase()}`,
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
						message: buildTimeApprovalTimelineMessage(review.kind, "approved"),
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
						message: buildTimeApprovalTimelineMessage(
							review.kind,
							"rejected",
							request.rejectionReason ?? undefined,
						),
					});
				}

				return {
					approval: {
						id: request.id,
						approvalType: "time_entry",
						entityId: period.id,
						typeName: review.display.title,
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
						display: review.display,
						isActionable: review.isActionable,
						warning: review.warning,
					},
					entity: periodWithReview,
					timeline,
				} as ApprovalDetail<WorkPeriodWithRelations>;
			}),

		approve: (_entityId, approverId, options) =>
			Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);
				const currentEmployee = yield* _(
					loadCurrentApproverById(dbService, approverId),
				);
				if (!options?.approvalRequestId) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "A stable approval request target is required",
								field: "approvalRequestId",
							}),
						),
					);
				}
				const { decideTimeCorrectionWithStableTargetEffect } = yield* _(
					Effect.promise(
						async () =>
							import("@/lib/approvals/server/time-correction-approvals"),
					),
				);

				yield* _(
					decideTimeCorrectionWithStableTargetEffect(
						dbService,
						currentEmployee,
						options.approvalRequestId,
						"approve",
						undefined,
						options,
					),
				);
			}),

		reject: (_entityId, approverId, reason, options) =>
			Effect.gen(function* (_) {
				const dbService = yield* _(DatabaseService);
				const currentEmployee = yield* _(
					loadCurrentApproverById(dbService, approverId),
				);
				if (!options?.approvalRequestId) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "A stable approval request target is required",
								field: "approvalRequestId",
							}),
						),
					);
				}
				const { decideTimeCorrectionWithStableTargetEffect } = yield* _(
					Effect.promise(
						async () =>
							import("@/lib/approvals/server/time-correction-approvals"),
					),
				);

				yield* _(
					decideTimeCorrectionWithStableTargetEffect(
						dbService,
						currentEmployee,
						options.approvalRequestId,
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
			return displayMetadataForKind(entity, "time_correction");
		},
	};
