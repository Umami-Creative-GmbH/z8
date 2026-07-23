import { and, eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { DateTime } from "luxon";
import { db } from "@/db";
import { approvalRequest } from "@/db/schema";
import type {
	ApprovalDetail,
	ApprovalQueryParams,
	ApprovalTypeHandler,
	UnifiedApprovalItem,
} from "@/lib/approvals/domain/types";
import { DatabaseServiceLive } from "@/lib/effect/services/database.service";
import { ApprovalInboxBadRequestError } from "./current-actor";
import {
	countOrdinaryCanonicalApprovals,
	loadOrdinaryCanonicalApprovals,
	type OrdinaryCanonicalApproval,
} from "./ordinary-canonical-read";
import { getAgeDays, serializeDate } from "./serialization";
import {
	type ApprovalInboxSource,
	getSupportedInboxHandler,
	getSupportedInboxSources,
	isSupportedInboxType,
} from "./source-adapters";
import { buildInboxTriage } from "./triage";
import type {
	ApprovalInboxDetailResult,
	ApprovalInboxDetailSection,
	ApprovalInboxItem,
	ApprovalInboxListResult,
	ApprovalInboxRiskLevel,
	ApprovalInboxType,
	ApprovalInboxWarning,
} from "./types";

export interface ApprovalInboxListParams extends ApprovalQueryParams {
	types?: ApprovalInboxType[];
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
}

const DEFAULT_LIMIT = 50;

function provideDatabase<A>(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	effect: Effect.Effect<A, unknown, any>,
): Effect.Effect<A, unknown, never> {
	return effect.pipe(Effect.provide(DatabaseServiceLive)) as Effect.Effect<
		A,
		unknown,
		never
	>;
}

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
}: GetApprovalInboxListFromSourcesInput): Promise<ApprovalInboxListResult> {
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
			approvalsExit: await Effect.runPromiseExit(
				provideDatabase(source.handler.getApprovals(params)),
			),
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
					toInboxItem(source, approval, effectiveNow),
				),
			);
		}
	}

	const countResults = await Promise.all(
		sources.map(async (source) => ({
			source,
			countExit: await Effect.runPromiseExit(
				provideDatabase(
					source.handler.getCount(params.approverId, params.organizationId, {
						eligibleApprovalScopes: params.eligibleApprovalScopes,
						includeAllApprovers: params.includeAllApprovers,
					}),
				),
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
	const canonicalOrdinary =
		(params.status ?? "pending") === "pending" && includesTimeEntries
			? await loadCanonical({
					approverId: params.approverId,
					organizationId: params.organizationId,
					eligibleApprovalScopes: params.eligibleApprovalScopes,
					includeAllApprovers: params.includeAllApprovers,
					search: undefined,
					teamId: undefined,
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
				search: undefined,
				teamId: undefined,
			})
		: ((
				canonicalOrdinary as OrdinaryCanonicalApproval[] & {
					totalCount?: number;
				}
			).totalCount ?? canonicalOrdinary.length);
	counts.time_entry = (counts.time_entry ?? 0) + canonicalTotal;
	if ((params.status ?? "pending") === "pending" && includesTimeEntries) {
		items.push(
			...canonicalOrdinary
				.filter((approval) =>
					matchesCanonicalListFilters(approval.item, params),
				)
				.map((approval) => approval.item),
		);
	}

	const sortedItems = items.sort(compareInboxItems);
	const cursorFilteredItems = cursor
		? sortedItems.filter((item) => compareInboxItemToCursor(item, cursor) > 0)
		: sortedItems;
	const pagedItems = cursorFilteredItems.slice(0, limit);
	const hasMore = cursorFilteredItems.length > limit;
	const lastItem = pagedItems.at(-1);

	return {
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

export function getApprovalInboxList(
	params: ApprovalInboxListParams,
): Promise<ApprovalInboxListResult> {
	return getApprovalInboxListFromSources({
		sources: getSupportedInboxSources(),
		params,
		loadCanonicalOrdinaryApprovals: loadOrdinaryCanonicalApprovals,
		countCanonicalOrdinaryApprovals: countOrdinaryCanonicalApprovals,
	});
}

function matchesCanonicalListFilters(
	item: ApprovalInboxItem,
	params: ApprovalInboxListParams,
): boolean {
	if (params.teamId && item.requester.teamId !== params.teamId) return false;
	if (params.priority && item.triage.priority !== params.priority) return false;
	if (params.minAgeDays && item.timing.ageDays < params.minAgeDays)
		return false;
	if (params.dateRange) {
		const createdAt = new Date(item.timing.createdAt).getTime();
		if (
			createdAt < params.dateRange.from.getTime() ||
			createdAt > params.dateRange.to.getTime()
		) {
			return false;
		}
	}
	const search = params.search?.trim().toLocaleLowerCase("en-US");
	if (!search) return true;
	return [
		item.requester.name,
		item.requester.email,
		item.summary.title,
		item.summary.subtitle,
		item.summary.detail,
		item.summary.stage?.name,
	]
		.filter(Boolean)
		.join(" ")
		.toLocaleLowerCase("en-US")
		.includes(search);
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
}: GetApprovalInboxDetailFromRequestInput): Promise<ApprovalInboxDetailResult> {
	if (!isSupportedInboxType(request.entityType)) {
		throw new ApprovalInboxBadRequestError("Unsupported approval type");
	}
	if (handler.type !== request.entityType) {
		throw new ApprovalInboxBadRequestError("Approval detail mismatch");
	}

	const detail = await Effect.runPromise(
		provideDatabase(
			handler.getDetail(request.entityId, request.organizationId, {
				approvalId: request.id,
			}),
		),
	);
	validateDetailMatchesRequest(detail, request);

	const source: ApprovalInboxSource = {
		type: request.entityType,
		displayName: handler.displayName,
		supportsBulkApprove: handler.supportsBulkApprove,
		handler,
	};
	const item = toInboxItem(source, detail.approval, undefined);
	const actions = isOrphanedTimeCorrectionDetail(detail)
		? { ...item.capabilities, canApprove: false, canBulkApprove: false }
		: item.capabilities;

	return {
		item,
		sections: buildDetailSections(detail),
		actions,
	};
}

export async function getApprovalInboxDetail({
	approvalId,
	organizationId,
	approverId,
	includeAllApprovers,
	eligibleApprovalScopes,
	database = db,
	loadCanonicalOrdinaryApprovals:
		loadCanonical = loadOrdinaryCanonicalApprovals,
}: {
	approvalId: string;
	organizationId: string;
	approverId?: string;
	includeAllApprovers?: boolean;
	eligibleApprovalScopes?: ApprovalQueryParams["eligibleApprovalScopes"];
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
		const canonical = await loadCanonical({
			approverId,
			organizationId,
			includeAllApprovers,
			eligibleApprovalScopes,
			assignmentId: approvalId,
			limit: 1,
		});
		const approval = canonical.find(
			(candidate) => candidate.item.id === approvalId,
		);
		if (approval) return approval.detail;
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
): ApprovalInboxItem {
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
				approval.status === "pending" && approval.isActionable !== false,
			canReject:
				approval.status === "pending" && approval.isActionable !== false,
			canBulkApprove:
				approval.status === "pending" &&
				approval.isActionable !== false &&
				source.supportsBulkApprove,
			requiresRejectReason: true,
		},
	};
}

function buildDetailSections(
	detail: ApprovalDetail,
): ApprovalInboxDetailSection[] {
	const stage = detail.approval.display.stage;
	const useDisplayLocalTimelineIds = isOrdinaryTimeApprovalDetail(detail);
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: "Request",
			rows: [
				{ label: "Type", value: detail.approval.typeName },
				{ label: "Summary", value: detail.approval.display.summary },
				{ label: "Status", value: detail.approval.status },
				...(stage
					? [{ label: "Stage", value: `${stage.name} (${stage.order})` }]
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

	sections.push(...buildTimeCorrectionDetailSections(detail));

	if (detail.timeline.length > 0) {
		sections.push({
			type: "timeline",
			title: "Timeline",
			events: detail.timeline.map((event, index) => ({
				id: useDisplayLocalTimelineIds
					? `timeline-${event.type}-${index + 1}`
					: event.id,
				label: event.message,
				at: serializeDate(event.timestamp) ?? "",
				actorName: event.performedBy?.name ?? null,
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
	clockIn: { original: Date; requested: Date | null };
	clockOut: { original: Date | null; requested: Date | null } | null;
	isOrphaned: boolean;
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
	const rows = [
		{
			label: "Action",
			value: correction.action === "delete" ? "Delete" : "Edit",
		},
		{
			label: "Clock in",
			value: formatCorrectionChange(
				correction.clockIn.original,
				correction.clockIn.requested,
			),
			...(correction.clockIn.requested ? {} : { tone: "danger" as const }),
		},
	];

	if (correction.clockOut) {
		rows.push({
			label: "Clock out",
			value: formatCorrectionChange(
				correction.clockOut.original,
				correction.clockOut.requested,
			),
			...(correction.clockOut.requested ? {} : { tone: "danger" as const }),
		});
	}

	const sections: ApprovalInboxDetailSection[] = [
		{ type: "key_value", title: "Requested Correction", rows },
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
