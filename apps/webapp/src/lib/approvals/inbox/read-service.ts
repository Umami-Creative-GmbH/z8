import { and, eq } from "drizzle-orm";
import { Exit } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { approvalRequest } from "@/db/schema";
import type {
	ApprovalDetail,
	ApprovalQueryParams,
	ApprovalTypeHandler,
	UnifiedApprovalItem,
} from "@/lib/approvals/domain/types";
import type { AbsenceDeputyView } from "@/lib/absences/deputy";
import { runtime } from "@/lib/effect/runtime";
import { buildAbsenceDeputySection } from "../presentation/absence-deputy";
import {
	buildAbsenceReviewSections,
	prepareAbsenceReviewEvidence,
} from "../presentation/absence-review";
import {
	buildTimeReviewSections,
	prepareTimeReviewEvidence,
} from "../presentation/time-review";
import {
	buildTravelExpenseReviewSections,
	prepareTravelExpenseReviewEvidence,
} from "../presentation/travel-expense-review";
import {
	buildTravelExpenseReportReviewSections,
	prepareTravelExpenseReportReviewEvidence,
} from "../presentation/travel-expense-report-review";
import type { TimeCorrectionMetadataChanges } from "../server/time-correction-review-metadata";
import { isTimeApprovalWorkflowType } from "../time-approval-kinds";
import { ApprovalInboxBadRequestError } from "./current-actor";
import {
	countOrdinaryCanonicalApprovals,
	loadOrdinaryCanonicalApprovals,
	type OrdinaryCanonicalApproval,
	type OrdinaryCanonicalListFilters,
} from "./ordinary-canonical-read";
import { isDeputyDecisionEntityType } from "../deputy/deputy-decision";
import {
	type DeputyDecisionView,
	loadDeputyDecidedEarlierStages,
	loadDeputyDecisionsForEntities,
} from "../deputy/deputy-decision-store";
import { coversByApprover, markCoveringFor, markDecidedEarlierStage } from "./covering-marks";
import { markOwnRequest } from "./own-request";
import { getAgeDays, serializeDate } from "./serialization";
import {
	type ApprovalInboxSource,
	getSupportedInboxHandler,
	getSupportedInboxSources,
	isSupportedInboxType,
} from "./source-adapters";
import { buildInboxTriage } from "./triage";
import type {
	ApprovalInboxCover,
	ApprovalInboxDetailResult,
	ApprovalInboxDetailSection,
	ApprovalInboxItem,
	ApprovalInboxListResult,
	ApprovalInboxLocalizedText,
	ApprovalInboxRiskLevel,
	ApprovalInboxStatus,
	ApprovalInboxTimeComparison,
	ApprovalInboxType,
	ApprovalInboxWarning,
} from "./types";

export interface ApprovalInboxListParams extends ApprovalQueryParams {
	types?: ApprovalInboxType[];
	/** Absent approvers the viewer covers for right now, with their names (#1016). */
	covering?: ApprovalInboxCover[];
}

interface GetApprovalInboxListFromSourcesInput {
	sources: ApprovalInboxSource[];
	params: ApprovalInboxListParams;
	now?: Date;
	loadCanonicalOrdinaryApprovals?: (
		input: Parameters<typeof loadOrdinaryCanonicalApprovals>[0],
	) => Promise<OrdinaryCanonicalApproval[]>;
	countCanonicalOrdinaryApprovals?: (
		input: Parameters<typeof countOrdinaryCanonicalApprovals>[0],
	) => Promise<number>;
	/** Of the covered items' requests, those whose earlier stage the deputy decided (#1016). */
	loadDeputyDecidedEarlierStages?: (input: {
		organizationId: string;
		deputyEmployeeId: string;
		approvalRequestIds: string[];
	}) => Promise<Set<string>>;
}

interface ApprovalInboxCursor {
	riskLevel: ApprovalInboxRiskLevel;
	priority: UnifiedApprovalItem["priority"];
	createdAt: string;
	id: string;
}

interface GetApprovalInboxDetailFromRequestInput {
	request: {
		id: string;
		entityType: string;
		entityId: string;
		organizationId: string;
		status: string;
		approverId: string;
	};
	handler: ApprovalTypeHandler;
	loadAbsenceReviewEvidence?: typeof prepareAbsenceReviewEvidence;
	loadTravelExpenseReviewEvidence?: (input: {
		organizationId: string;
		claimId: string;
	}) => ReturnType<typeof prepareTravelExpenseReviewEvidence>;
	loadTravelExpenseReportReviewEvidence?: (input: {
		organizationId: string;
		reportId: string;
		approvalRequestId?: string;
	}) => ReturnType<typeof prepareTravelExpenseReportReviewEvidence>;
	loadTimeReviewEvidence?: (
		input: Parameters<typeof prepareTimeReviewEvidence>[0],
	) => ReturnType<typeof prepareTimeReviewEvidence>;
	/** A covering deputy's decision of this request (#1016), for the timeline. */
	loadDeputyDecision?: (input: {
		organizationId: string;
		approvalRequestId: string;
		entityId: string;
	}) => Promise<DeputyDecisionView | null>;
}

async function loadDeputyDecisionOfRequest(input: {
	organizationId: string;
	approvalRequestId: string;
	entityId: string;
}): Promise<DeputyDecisionView | null> {
	const decisions = await loadDeputyDecisionsForEntities(db, {
		organizationId: input.organizationId,
		entityIds: [input.entityId],
	});
	return decisions.find((decision) => decision.approvalRequestId === input.approvalRequestId) ?? null;
}

/** The decision event reads "by Y (deputy for X)" when a covering deputy decided it. */
function withDeputyDecider(
	detail: ApprovalDetail,
	decision: DeputyDecisionView | null,
): ApprovalDetail {
	if (!decision) return detail;
	const decidedType = decision.decision === "approved" ? "approved" : "rejected";
	return {
		...detail,
		timeline: detail.timeline.map((event) =>
			event.type === decidedType
				? {
						...event,
						performedBy: { name: decision.deputy.name, image: event.performedBy?.image ?? null },
						actingFor: { name: decision.actingFor.name },
					}
				: event,
		),
	};
}

const DEFAULT_LIMIT = 50;

const riskRank: Record<ApprovalInboxRiskLevel, number> = {
	high: 0,
	medium: 1,
	low: 2,
};

const priorityRank: Record<UnifiedApprovalItem["priority"], number> = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3,
};

export async function getApprovalInboxListFromSources({
	sources,
	params,
	now,
	loadCanonicalOrdinaryApprovals: loadCanonical = async () => [],
	countCanonicalOrdinaryApprovals: countCanonical,
	loadDeputyDecidedEarlierStages: loadDecidedEarlier = async () => new Set<string>(),
}: GetApprovalInboxListFromSourcesInput): Promise<ApprovalInboxListResult> {
	const covers = coversByApprover(params.covering, params.approverId);
	const coveredApproverIds = [...covers.keys()];
	if (coveredApproverIds.length > 0) {
		params = { ...params, coveredApproverIds };
	}
	const effectiveNow = now ?? new Date();
	const requestedTypeSet = params.types ? new Set(params.types) : null;
	const selectedSources = sources.filter(
		(source) => !requestedTypeSet || requestedTypeSet.has(source.type),
	);
	const warnings: ApprovalInboxWarning[] = [];
	const items: ApprovalInboxItem[] = [];
	const counts = Object.fromEntries(
		sources.map((source) => [source.type, 0]),
	) as ApprovalInboxListResult["counts"];

	const approvalResults = await Promise.all(
		selectedSources.map(async (source) => ({
			source,
			approvalsExit: await runtime.runPromiseExit(source.handler.getApprovals(params)),
		})),
	);
	for (const { source, approvalsExit } of approvalResults) {
		if (Exit.isFailure(approvalsExit)) {
			warnings.push({
				source: source.type,
				message: `${source.displayName} approvals could not be loaded.`,
			});
		} else {
			items.push(
				...approvalsExit.value.map((approval) =>
					markCoveringFor(toInboxItem(source, approval, effectiveNow), approval.approverId, covers),
				),
			);
		}
	}

	const countResults = await Promise.all(
		sources.map(async (source) => ({
			source,
			countExit: await runtime.runPromiseExit(
				source.handler.getCount(params.approverId, params.organizationId, {
					eligibleApprovalScopes: params.eligibleApprovalScopes,
					includeAllApprovers: params.includeAllApprovers,
					...(params.coveredApproverIds ? { coveredApproverIds: params.coveredApproverIds } : {}),
				}),
			),
		})),
	);
	for (const { source, countExit } of countResults) {
		counts[source.type] = Exit.isSuccess(countExit) ? countExit.value : 0;
	}

	const includesTimeEntries = selectedSources.some(
		(source) => source.type === "time_entry",
	);
	const cursor = parseCursor(params.cursor);
	const limit = getEffectiveLimit(params.limit);
	const canonicalFilters = normalizeCanonicalFilters(params);
	const canonicalOrdinary =
		(params.status ?? "pending") === "pending" && includesTimeEntries
			? await loadCanonical({
					approverId: params.approverId,
					organizationId: params.organizationId,
					eligibleApprovalScopes: params.eligibleApprovalScopes,
					includeAllApprovers: params.includeAllApprovers,
					coveredApproverIds: params.coveredApproverIds,
					filters: canonicalFilters,
					limit: limit + 1,
					cursor: cursor ?? undefined,
					now: effectiveNow,
				})
			: [];
	const canonicalTotal = countCanonical
		? await countCanonical({
				approverId: params.approverId,
				organizationId: params.organizationId,
				eligibleApprovalScopes: params.eligibleApprovalScopes,
				includeAllApprovers: params.includeAllApprovers,
				coveredApproverIds: params.coveredApproverIds,
				filters: canonicalFilters,
				now: effectiveNow,
			})
		: ((
				canonicalOrdinary as OrdinaryCanonicalApproval[] & {
					totalCount?: number;
				}
			).totalCount ?? canonicalOrdinary.length);
	counts.time_entry = (counts.time_entry ?? 0) + canonicalTotal;
	if ((params.status ?? "pending") === "pending" && includesTimeEntries) {
		items.push(
			...canonicalOrdinary.map((approval) =>
				markCoveringFor(approval.item, approval.decisionTarget?.approverId, covers),
			),
		);
	}

	// Four-eyes (#1016): a covered request whose earlier stage the viewer
	// decided stays in its section without decisions.
	const coveredRequestIds = items.flatMap((item) => (item.coveringFor ? [item.id] : []));
	const decidedEarlier =
		coveredRequestIds.length > 0
			? await loadDecidedEarlier({
					organizationId: params.organizationId,
					deputyEmployeeId: params.approverId,
					approvalRequestIds: coveredRequestIds,
				})
			: new Set<string>();

	const sortedItems = items
		.map((item) => markOwnRequest(item, params.approverId))
		.map((item) =>
			item.coveringFor && decidedEarlier.has(item.id) ? markDecidedEarlierStage(item) : item,
		)
		.sort(compareInboxItems);
	const cursorFilteredItems = cursor
		? sortedItems.filter((item) => compareInboxItemToCursor(item, cursor) > 0)
		: sortedItems;
	const pagedItems = cursorFilteredItems.slice(0, limit);
	const hasMore = cursorFilteredItems.length > limit;
	const lastItem = pagedItems.at(-1);
	const covering =
		(params.status ?? "pending") === "pending" && covers.size > 0
			? await countCoveringSections({
					covers: [...covers.values()],
					organizationId: params.organizationId,
					sources,
					countCanonical,
					now: effectiveNow,
				})
			: undefined;

	return {
		...(covering ? { covering } : {}),
		items: pagedItems,
		nextCursor:
			hasMore && lastItem
				? JSON.stringify({
						riskLevel: lastItem.triage.riskLevel,
						priority: lastItem.triage.priority,
						createdAt: lastItem.timing.createdAt,
						id: lastItem.id,
					})
				: null,
		hasMore,
		total: Object.values(counts).reduce((total, count) => total + count, 0),
		counts,
		supportedTypes: sources.map((source) => source.type),
		warnings,
	};
}

/**
 * Each covered approver's section count: every pending approval of the deputy
 * kinds assigned to them, exactly as their own inbox counts it.
 */
async function countCoveringSections(input: {
	covers: ApprovalInboxCover[];
	organizationId: string;
	sources: ApprovalInboxSource[];
	countCanonical: GetApprovalInboxListFromSourcesInput["countCanonicalOrdinaryApprovals"];
	now: Date;
}): Promise<Array<ApprovalInboxCover & { count: number }>> {
	const deputySources = input.sources.filter((source) => isDeputyDecisionEntityType(source.type));
	return await Promise.all(
		input.covers.map(async (cover) => {
			const counts = await Promise.all(
				deputySources.map(async (source) => {
					const exit = await runtime.runPromiseExit(
						source.handler.getCount(cover.approverId, input.organizationId, {}),
					);
					return Exit.isSuccess(exit) ? exit.value : 0;
				}),
			);
			const canonical =
				input.countCanonical && deputySources.some((source) => source.type === "time_entry")
					? await input.countCanonical({
							approverId: cover.approverId,
							organizationId: input.organizationId,
							now: input.now,
						})
					: 0;
			return {
				approverId: cover.approverId,
				approverName: cover.approverName,
				count: counts.reduce((sum, value) => sum + value, canonical),
			};
		}),
	);
}

/**
 * How many approvals wait for this absent approver in their covering deputy's
 * "Covering for" section: the same count the section shows (#1016), for the
 * cover start summary (#1018).
 */
export async function countCoveredApproverPending(input: {
	organizationId: string;
	approverId: string;
	now?: Date;
}): Promise<number> {
	const [section] = await countCoveringSections({
		covers: [{ approverId: input.approverId, approverName: "" }],
		organizationId: input.organizationId,
		sources: getSupportedInboxSources(),
		countCanonical: countOrdinaryCanonicalApprovals,
		now: input.now ?? new Date(),
	});
	return section?.count ?? 0;
}

export function getApprovalInboxList(
	params: ApprovalInboxListParams,
): Promise<ApprovalInboxListResult> {
	return getApprovalInboxListFromSources({
		sources: getSupportedInboxSources(),
		params,
		loadCanonicalOrdinaryApprovals: loadOrdinaryCanonicalApprovals,
		countCanonicalOrdinaryApprovals: countOrdinaryCanonicalApprovals,
		loadDeputyDecidedEarlierStages: (input) => loadDeputyDecidedEarlierStages(db, input),
	});
}

function normalizeCanonicalFilters(
	params: ApprovalInboxListParams,
): OrdinaryCanonicalListFilters | undefined {
	const search = params.search?.trim().toLocaleLowerCase("en-US") || undefined;
	const normalizedMinAgeDays =
		typeof params.minAgeDays === "number" &&
		Number.isFinite(params.minAgeDays) &&
		params.minAgeDays > 0
			? Math.floor(params.minAgeDays)
			: undefined;
	const minAgeDays =
		normalizedMinAgeDays && normalizedMinAgeDays > 0
			? normalizedMinAgeDays
			: undefined;
	const filters: OrdinaryCanonicalListFilters = {
		teamId: params.teamId || undefined,
		priority: params.priority,
		minAgeDays,
		dateRange: params.dateRange,
		search,
	};
	return Object.values(filters).some((value) => value !== undefined)
		? filters
		: undefined;
}

export async function getApprovalInboxCounts(
	params: ApprovalInboxListParams,
): Promise<ApprovalInboxListResult["counts"]> {
	const result = await getApprovalInboxList({ ...params, limit: 1 });
	return result.counts;
}

export async function getApprovalInboxDetailFromRequest({
	request,
	handler,
	loadAbsenceReviewEvidence = prepareAbsenceReviewEvidence,
	loadTravelExpenseReviewEvidence = prepareTravelExpenseReviewEvidence,
	loadTravelExpenseReportReviewEvidence = (input) =>
		prepareTravelExpenseReportReviewEvidence(input),
	loadTimeReviewEvidence = prepareTimeReviewEvidence,
	loadDeputyDecision = loadDeputyDecisionOfRequest,
}: GetApprovalInboxDetailFromRequestInput): Promise<ApprovalInboxDetailResult> {
	if (!isSupportedInboxType(request.entityType)) {
		throw new ApprovalInboxBadRequestError("Unsupported approval type");
	}
	if (handler.type !== request.entityType) {
		throw new ApprovalInboxBadRequestError("Approval detail mismatch");
	}

	const handlerDetail = await runtime.runPromise(
		handler.getDetail(request.entityId, request.organizationId, {
			approvalId: request.id,
		}),
	);
	validateDetailMatchesRequest(handlerDetail, request);
	const detail =
		(request.status === "approved" || request.status === "rejected") &&
		isDeputyDecisionEntityType(request.entityType)
			? withDeputyDecider(
					handlerDetail,
					await loadDeputyDecision({
						organizationId: request.organizationId,
						approvalRequestId: request.id,
						entityId: request.entityId,
					}),
				)
			: handlerDetail;

	const source: ApprovalInboxSource = {
		type: request.entityType,
		displayName: handler.displayName,
		supportsBulkApprove: handler.supportsBulkApprove,
		handler,
	};
	const item = toInboxItem(source, detail.approval, undefined, { inDetail: true });
	let actions = isOrphanedTimeCorrectionDetail(detail)
		? { ...item.capabilities, canApprove: false, canBulkApprove: false }
		: item.capabilities;
	let review: { sections: ApprovalInboxDetailSection[]; decisionsBlocked: boolean } | null =
		null;
	// The request's submitted revision and committed results (#325). With
	// evidence, the live correction reconstruction (UTC clock times from current
	// rows) would contradict the submitted proposal and is not built.
	const timeEvidence =
		request.entityType === "time_entry"
			? await loadTimeReviewEvidence({
					organizationId: request.organizationId,
					approvalRequestId: request.id,
					workPeriodId: request.entityId,
					requestPending: request.status === "pending",
					kind: timeApprovalKindOf(detail.entity),
				})
			: null;
	const sections = buildDetailSections(detail, {
		liveCorrection: !(timeEvidence?.status === "evidenced" && timeEvidence.kind === "time_correction"),
	});

	if (request.entityType === "absence_entry") {
		const evidence = await loadAbsenceReviewEvidence({
			organizationId: request.organizationId,
			entity: detail.entity,
		});
		if (evidence) review = buildAbsenceReviewSections(evidence);
	} else if (request.entityType === "travel_expense_claim") {
		// The claim's frozen submission and decision history (#296).
		review = buildTravelExpenseReviewSections(
			await loadTravelExpenseReviewEvidence({
				organizationId: request.organizationId,
				claimId: request.entityId,
			}),
		);
	} else if (request.entityType === "travel_expense_report") {
		// The whole report's frozen submission (#602); never the live draft rows.
		review = buildTravelExpenseReportReviewSections(
			await loadTravelExpenseReportReviewEvidence({
				organizationId: request.organizationId,
				reportId: request.entityId,
				// An earlier cycle's request shows the facts its reviewer saw.
				approvalRequestId: request.id,
			}),
		);
	} else if (timeEvidence) {
		review = buildTimeReviewSections(timeEvidence);
	}
	if (request.entityType === "absence_entry") {
		// Who covers during the absence (#1011), after what was submitted.
		sections.splice(1, 0, buildAbsenceDeputySection(absenceDeputyOf(detail.entity)));
	}
	if (review) {
		sections.splice(1, 0, ...review.sections);
		if (review.decisionsBlocked) {
			// The server holds these decisions too; the UI only mirrors that.
			actions = {
				...actions,
				canApprove: false,
				canReject: false,
				canBulkApprove: false,
			};
		}
	}

	return {
		item,
		sections,
		actions,
	};
}

export async function getApprovalInboxDetail({
	approvalId,
	organizationId,
	approverId,
	includeAllApprovers,
	eligibleApprovalScopes,
	covering,
	database = db,
	loadCanonicalOrdinaryApprovals:
		loadCanonical = loadOrdinaryCanonicalApprovals,
}: {
	approvalId: string;
	organizationId: string;
	approverId?: string;
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: ApprovalQueryParams["eligibleApprovalScopes"];
	/** Absent approvers the viewer covers for (#1016); canonical reads only. */
	covering?: ApprovalInboxCover[];
	database?: Pick<typeof db, "query">;
	loadCanonicalOrdinaryApprovals?: (
		input: Parameters<typeof loadOrdinaryCanonicalApprovals>[0],
	) => Promise<OrdinaryCanonicalApproval[]>;
}): Promise<ApprovalInboxDetailResult> {
	const request = await database.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, approvalId),
			eq(approvalRequest.organizationId, organizationId),
		),
	});

	if (!request) {
		if (!approverId) {
			throw new ApprovalInboxBadRequestError("Approval not found");
		}
		const covers = coversByApprover(covering, approverId);
		const canonical = await loadCanonical({
			approverId,
			organizationId,
			includeAllApprovers,
			eligibleApprovalScopes,
			...(covers.size > 0 ? { coveredApproverIds: [...covers.keys()] } : {}),
			assignmentId: approvalId,
			limit: 1,
		});
		const approval = canonical.find(
			(candidate) => candidate.item.id === approvalId,
		);
		if (approval) {
			const item = markCoveringFor(approval.detail.item, approval.decisionTarget?.approverId, covers);
			return item === approval.detail.item ? approval.detail : { ...approval.detail, item };
		}
		throw new ApprovalInboxBadRequestError("Approval not found");
	}
	if (
		approverId &&
		!includeAllApprovers &&
		request.approverId !== approverId &&
		!(
			eligibleApprovalScopes?.some(
				(scope) =>
					scope.requesterEmployeeId === request.requestedBy &&
					scope.eligibleApproverIds.includes(approverId) &&
					scope.eligibleApproverIds.includes(request.approverId),
			) ?? false
		)
	) {
		throw new ApprovalInboxBadRequestError("Approval not found");
	}

	const handler = getSupportedInboxHandler(request.entityType);
	if (!handler) {
		throw new ApprovalInboxBadRequestError("Unsupported approval type");
	}

	return getApprovalInboxDetailFromRequest({ request, handler });
}

function validateDetailMatchesRequest(
	detail: ApprovalDetail,
	request: GetApprovalInboxDetailFromRequestInput["request"],
): void {
	if (
		detail.approval.id !== request.id ||
		detail.approval.entityId !== request.entityId ||
		detail.approval.approvalType !== request.entityType ||
		detail.approval.organizationId !== request.organizationId ||
		detail.approval.approverId !== request.approverId ||
		detail.approval.status !== request.status
	) {
		throw new ApprovalInboxBadRequestError("Approval detail mismatch");
	}
}

function toInboxItem(
	source: ApprovalInboxSource,
	approval: UnifiedApprovalItem,
	now: Date | undefined,
	options: { inDetail?: boolean } = {},
): ApprovalInboxItem {
	// Outside the detail view, an approval needing its acceptances is not offered (#604).
	const quickApproveBlocked = approval.requiresDetailReview === true && !options.inDetail;
	const triage = buildInboxTriage({
		type: source.type,
		priority: approval.priority,
		status: approval.status,
		createdAt: approval.createdAt,
		now,
		isPayrollRelevant: approval.triage?.isPayrollRelevant,
		riskLevel: approval.triage?.riskLevel,
		timeDeltaMinutes: approval.triage?.timeDeltaMinutes,
	});

	return {
		id: approval.id,
		type: source.type,
		entityId: approval.entityId,
		status: approval.status,
		...(approval.closedAs ? { closedAs: approval.closedAs } : {}),
		requester: {
			id: approval.requester.id,
			name: approval.requester.name,
			email: approval.requester.email,
			image: approval.requester.image,
			teamId: approval.requester.teamId,
		},
		summary: {
			title: approval.display.title,
			subtitle: approval.display.subtitle,
			detail: approval.display.summary,
			badge: approval.display.badge ?? null,
			...(approval.display.stage ? { stage: approval.display.stage } : {}),
			...(approval.display.localized
				? {
						localized: {
							title: approval.display.localized.title,
							subtitle: approval.display.localized.subtitle,
							detail: approval.display.localized.summary,
						},
					}
				: {}),
		},
		timing: {
			createdAt: serializeDate(approval.createdAt) ?? "",
			resolvedAt: serializeDate(approval.resolvedAt),
			slaDeadline: serializeDate(approval.sla.deadline),
			ageDays: getAgeDays({ createdAt: approval.createdAt, now }),
		},
		triage,
		capabilities: {
			canApprove:
				approval.status === "pending" &&
				approval.isActionable !== false &&
				!quickApproveBlocked,
			canReject:
				approval.status === "pending" && approval.isActionable !== false,
			canBulkApprove:
				approval.status === "pending" &&
				approval.isActionable !== false &&
				source.supportsBulkApprove &&
				approval.requiresDetailReview !== true,
			requiresRejectReason: true,
			...(approval.requiresDetailReview ? { requiresDetailReview: true } : {}),
		},
	};
}

/** A request's status in the report pages' wording (#687), never the raw value. */
const REQUEST_STATUS_TEXT: Record<
	ApprovalInboxStatus | "returned" | "withdrawn",
	ApprovalInboxLocalizedText
> = {
	pending: {
		key: "approvals:approvals.requestStatusPending",
		fallback: "Awaiting review",
	},
	approved: {
		key: "approvals:approvals.requestStatusApproved",
		fallback: "Approved",
	},
	rejected: {
		key: "approvals:approvals.requestStatusRejected",
		fallback: "Rejected",
	},
	returned: {
		key: "approvals:approvals.requestStatusReturned",
		fallback: "Returned for changes",
	},
	withdrawn: {
		key: "approvals:approvals.requestStatusWithdrawn",
		fallback: "Withdrawn",
	},
};

function absenceDeputyOf(entity: unknown): AbsenceDeputyView | null {
	if (typeof entity !== "object" || entity === null) return null;
	const deputy = (entity as { deputy?: unknown }).deputy;
	if (typeof deputy !== "object" || deputy === null) return null;
	const { id, name, canDecideApprovals } = deputy as Record<string, unknown>;
	return typeof id === "string" && typeof name === "string" && typeof canDecideApprovals === "boolean"
		? { id, name, canDecideApprovals }
		: null;
}

function buildDetailSections(
	detail: ApprovalDetail,
	options: { liveCorrection: boolean },
): ApprovalInboxDetailSection[] {
	const stage = detail.approval.display.stage;
	const useDisplayLocalTimelineIds = isOrdinaryTimeApprovalDetail(detail);
	const { localized } = detail.approval.display;
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: { key: "approvals:approvals.request", fallback: "Request" },
			rows: [
				{
					label: { key: "approvals:approvals.requestType", fallback: "Type" },
					// A localized title names the kind as specifically as the list row.
					value: localized?.title ?? detail.approval.typeName,
				},
				{
					label: {
						key: "approvals:approvals.requestSummary",
						fallback: "Summary",
					},
					value: localized?.summary ?? detail.approval.display.summary,
				},
				{
					label: { key: "approvals:approvals.requestStatus", fallback: "Status" },
					// A returned or withdrawn report cycle is not a rejection (#603).
					value:
						REQUEST_STATUS_TEXT[
							detail.approval.closedAs ?? detail.approval.status
						],
				},
				...(stage
					? [
							{
								label: {
									key: "approvals:approvals.requestStage",
									fallback: "Stage",
								},
								value: `${stage.name} (${stage.order})`,
							},
						]
					: []),
			],
		},
	];
	const timeRequestWarning = getTimeRequestWarning(detail.entity);
	if (timeRequestWarning) {
		sections.push({
			type: "callout",
			title: "Reconciliation required",
			body: timeRequestWarning,
			tone: "warning",
		});
	}

	if (options.liveCorrection) sections.push(...buildTimeCorrectionDetailSections(detail));

	if (detail.timeline.length > 0) {
		sections.push({
			type: "timeline",
			title: { key: "approvals:approvals.timeline", fallback: "Timeline" },
			events: detail.timeline.map((event, index) => ({
				id: useDisplayLocalTimelineIds
					? `timeline-${event.type}-${index + 1}`
					: event.id,
				label: event.message,
				at: serializeDate(event.timestamp) ?? "",
				actorName: event.performedBy?.name ?? null,
				...(event.actingFor ? { actingForName: event.actingFor.name } : {}),
			})),
		});
	}

	return sections;
}

function isOrdinaryTimeApprovalDetail(detail: ApprovalDetail): boolean {
	if (
		detail.approval.approvalType !== "time_entry" ||
		typeof detail.entity !== "object" ||
		detail.entity === null
	) {
		return false;
	}

	const entity = detail.entity as {
		timeApprovalKind?: unknown;
		timeRequestHasOrdinaryEvidence?: unknown;
	};
	return (
		entity.timeApprovalKind === "manual_time_submission" ||
		entity.timeApprovalKind === "policy_clock_out" ||
		entity.timeRequestHasOrdinaryEvidence === true
	);
}

function timeApprovalKindOf(entity: unknown) {
	if (typeof entity !== "object" || entity === null) return null;
	const kind = (entity as { timeApprovalKind?: unknown }).timeApprovalKind;
	if (isTimeApprovalWorkflowType(kind)) return kind;
	return hasPendingCorrectionDetail(entity) ? "time_correction" : null;
}

function getTimeRequestWarning(entity: unknown): string | null {
	if (
		typeof entity !== "object" ||
		entity === null ||
		!("timeRequestWarning" in entity)
	) {
		return null;
	}
	const warning = (entity as { timeRequestWarning?: unknown })
		.timeRequestWarning;
	return typeof warning === "string" ? warning : null;
}

interface TimeCorrectionReviewDetail {
	action: "edit" | "delete";
	clockIn: { original: Date; requested: Date | null } | null;
	clockOut: { original: Date | null; requested: Date | null } | null;
	metadataChanges?: TimeCorrectionMetadataChanges;
	isOrphaned: boolean;
	timeComparison?: ApprovalInboxTimeComparison;
}

function hasPendingCorrectionDetail(entity: unknown): entity is {
	pendingCorrection: TimeCorrectionReviewDetail;
} {
	return (
		typeof entity === "object" &&
		entity !== null &&
		"pendingCorrection" in entity &&
		typeof (entity as { pendingCorrection?: unknown }).pendingCorrection ===
			"object" &&
		(entity as { pendingCorrection?: unknown }).pendingCorrection !== null
	);
}

function isOrphanedTimeCorrectionDetail(detail: ApprovalDetail) {
	return (
		detail.approval.approvalType === "time_entry" &&
		hasPendingCorrectionDetail(detail.entity) &&
		detail.entity.pendingCorrection.isOrphaned
	);
}

function buildTimeCorrectionDetailSections(
	detail: ApprovalDetail,
): ApprovalInboxDetailSection[] {
	if (
		detail.approval.approvalType !== "time_entry" ||
		!hasPendingCorrectionDetail(detail.entity)
	) {
		return [];
	}

	const correction = detail.entity.pendingCorrection;
	const rows: Extract<
		ApprovalInboxDetailSection,
		{ type: "key_value" }
	>["rows"] = [
		{
			label: { key: "approvals:approvals.action", fallback: "Action" },
			value:
				correction.action === "delete"
					? { key: "approvals:approvals.delete", fallback: "Delete" }
					: { key: "approvals:approvals.edit", fallback: "Edit" },
		},
	];

	if (correction.clockIn && !correction.timeComparison) {
		rows.push({
			label: { key: "approvals:approvals.clockIn", fallback: "Clock in" },
			value: formatCorrectionChange(
				correction.clockIn.original,
				correction.clockIn.requested,
			),
			...(correction.clockIn.requested ? {} : { tone: "danger" as const }),
		});
	}

	if (correction.clockOut && !correction.timeComparison) {
		rows.push({
			label: { key: "approvals:approvals.clockOut", fallback: "Clock out" },
			value: formatCorrectionChange(
				correction.clockOut.original,
				correction.clockOut.requested,
			),
			...(correction.clockOut.requested ? {} : { tone: "danger" as const }),
		});
	}

	if (correction.metadataChanges?.workLocation) {
		rows.push({
			label: {
				key: "approvals:approvals.workLocation",
				fallback: "Work location",
			},
			value: {
				kind: "change",
				original: {
					kind: "work_location",
					value: correction.metadataChanges.workLocation.original,
				},
				requested: {
					kind: "work_location",
					value: correction.metadataChanges.workLocation.requested,
				},
			},
		});
	}

	if (correction.metadataChanges?.workCategory) {
		rows.push({
			label: {
				key: "approvals:approvals.workCategory",
				fallback: "Work category",
			},
			value: {
				kind: "change",
				original: {
					kind: "work_category",
					value: correction.metadataChanges.workCategory.original,
				},
				requested: {
					kind: "work_category",
					value: correction.metadataChanges.workCategory.requested,
				},
			},
		});
	}

	const sections: ApprovalInboxDetailSection[] = [
		...(correction.timeComparison ? [correction.timeComparison] : []),
		{
			type: "key_value",
			title: {
				key: "approvals:approvals.requestedCorrection",
				fallback: "Requested Correction",
			},
			rows,
		},
	];

	if (correction.isOrphaned) {
		sections.unshift({
			type: "callout",
			title: "Correction data missing",
			body: "This approval references correction entries that no longer exist or no longer match the work period. Reject it or clean up the stale approval request before approving.",
			tone: "danger",
		});
	}

	return sections;
}

function formatCorrectionChange(original: Date | null, requested: Date | null) {
	return `${formatCorrectionTime(original)} -> ${formatCorrectionTime(requested)}`;
}

function formatCorrectionTime(value: Date | null) {
	return value
		? DateTime.fromJSDate(value, { zone: "utc" }).toFormat("HH:mm")
		: "missing";
}

function compareInboxItems(
	left: ApprovalInboxItem,
	right: ApprovalInboxItem,
): number {
	return (
		riskRank[left.triage.riskLevel] - riskRank[right.triage.riskLevel] ||
		priorityRank[left.triage.priority] - priorityRank[right.triage.priority] ||
		left.timing.createdAt.localeCompare(right.timing.createdAt) ||
		left.id.localeCompare(right.id)
	);
}

function compareInboxItemToCursor(
	item: ApprovalInboxItem,
	cursor: ApprovalInboxCursor,
): number {
	return (
		riskRank[item.triage.riskLevel] - riskRank[cursor.riskLevel] ||
		priorityRank[item.triage.priority] - priorityRank[cursor.priority] ||
		item.timing.createdAt.localeCompare(cursor.createdAt) ||
		item.id.localeCompare(cursor.id)
	);
}

function getEffectiveLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit))
		return DEFAULT_LIMIT;

	const integerLimit = Math.floor(limit);
	return integerLimit >= 1 ? integerLimit : DEFAULT_LIMIT;
}

function parseCursor(cursor: string | undefined): ApprovalInboxCursor | null {
	if (!cursor) return null;

	try {
		const parsed = JSON.parse(cursor) as Partial<ApprovalInboxCursor>;
		if (
			parsed.riskLevel &&
			parsed.priority &&
			parsed.createdAt &&
			parsed.id &&
			parsed.riskLevel in riskRank &&
			parsed.priority in priorityRank
		) {
			return {
				riskLevel: parsed.riskLevel,
				priority: parsed.priority,
				createdAt: parsed.createdAt,
				id: parsed.id,
			};
		}
	} catch {
		return null;
	}

	return null;
}
