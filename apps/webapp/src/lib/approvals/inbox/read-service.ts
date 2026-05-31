import { and, eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { db } from "@/db";
import { approvalRequest } from "@/db/schema";
import type {
	ApprovalDetail,
	ApprovalQueryParams,
	ApprovalTypeHandler,
	UnifiedApprovalItem,
} from "@/lib/approvals/domain/types";
import { ApprovalInboxBadRequestError } from "./current-actor";
import { getAgeDays, serializeDate } from "./serialization";
import {
	getSupportedInboxSources,
	getSupportedInboxHandler,
	isSupportedInboxType,
	type ApprovalInboxSource,
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
}: GetApprovalInboxListFromSourcesInput): Promise<ApprovalInboxListResult> {
	const selectedSources = sources.filter(
		(source) => !params.types || params.types.includes(source.type),
	);
	const warnings: ApprovalInboxWarning[] = [];
	const items: ApprovalInboxItem[] = [];
	const counts = Object.fromEntries(
		sources.map((source) => [source.type, 0]),
	) as ApprovalInboxListResult["counts"];

	for (const source of selectedSources) {
		const approvalsExit = await Effect.runPromiseExit(source.handler.getApprovals(params));
		if (Exit.isFailure(approvalsExit)) {
			warnings.push({
				source: source.type,
				message: `${source.displayName} approvals could not be loaded.`,
			});
		} else {
			items.push(...approvalsExit.value.map((approval) => toInboxItem(source, approval, now)));
		}
	}

	for (const source of sources) {
		const countExit = await Effect.runPromiseExit(
			source.handler.getCount(params.approverId, params.organizationId, {
				eligibleApprovalScopes: params.eligibleApprovalScopes,
				includeAllApprovers: params.includeAllApprovers,
			}),
		);
		counts[source.type] = Exit.isSuccess(countExit) ? countExit.value : 0;
	}

	const sortedItems = items.sort(compareInboxItems);
	const cursor = parseCursor(params.cursor);
	const cursorFilteredItems = cursor
		? sortedItems.filter((item) => compareInboxItemToCursor(item, cursor) > 0)
		: sortedItems;
	const limit = getEffectiveLimit(params.limit);
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

export function getApprovalInboxList(params: ApprovalInboxListParams): Promise<ApprovalInboxListResult> {
	return getApprovalInboxListFromSources({ sources: getSupportedInboxSources(), params });
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

	const detail = await Effect.runPromise(handler.getDetail(request.entityId, request.organizationId));
	validateDetailMatchesRequest(detail, request);

	const source: ApprovalInboxSource = {
		type: request.entityType,
		displayName: handler.displayName,
		supportsBulkApprove: handler.supportsBulkApprove,
		handler,
	};
	const item = toInboxItem(source, detail.approval, undefined);

	return {
		item,
		sections: buildDetailSections(detail),
		actions: item.capabilities,
	};
}

export async function getApprovalInboxDetail({
	approvalId,
	organizationId,
}: {
	approvalId: string;
	organizationId: string;
}): Promise<ApprovalInboxDetailResult> {
	const request = await db.query.approvalRequest.findFirst({
		where: and(
			eq(approvalRequest.id, approvalId),
			eq(approvalRequest.organizationId, organizationId),
		),
	});

	if (!request) {
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
		},
		timing: {
			createdAt: serializeDate(approval.createdAt) ?? "",
			resolvedAt: serializeDate(approval.resolvedAt),
			slaDeadline: serializeDate(approval.sla.deadline),
			ageDays: getAgeDays({ createdAt: approval.createdAt, now }),
		},
		triage,
		capabilities: {
			canApprove: approval.status === "pending",
			canReject: approval.status === "pending",
			canBulkApprove: approval.status === "pending" && source.supportsBulkApprove,
			requiresRejectReason: true,
		},
	};
}

function buildDetailSections(detail: ApprovalDetail): ApprovalInboxDetailSection[] {
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: "Request",
			rows: [
				{ label: "Type", value: detail.approval.typeName },
				{ label: "Summary", value: detail.approval.display.summary },
				{ label: "Status", value: detail.approval.status },
			],
		},
	];

	if (detail.timeline.length > 0) {
		sections.push({
			type: "timeline",
			title: "Timeline",
			events: detail.timeline.map((event) => ({
				id: event.id,
				label: event.message,
				at: serializeDate(event.timestamp) ?? "",
				actorName: event.performedBy?.name ?? null,
			})),
		});
	}

	return sections;
}

function compareInboxItems(left: ApprovalInboxItem, right: ApprovalInboxItem): number {
	return (
		riskRank[left.triage.riskLevel] - riskRank[right.triage.riskLevel] ||
		priorityRank[left.triage.priority] - priorityRank[right.triage.priority] ||
		left.timing.createdAt.localeCompare(right.timing.createdAt) ||
		left.id.localeCompare(right.id)
	);
}

function compareInboxItemToCursor(item: ApprovalInboxItem, cursor: ApprovalInboxCursor): number {
	return (
		riskRank[item.triage.riskLevel] - riskRank[cursor.riskLevel] ||
		priorityRank[item.triage.priority] - priorityRank[cursor.priority] ||
		item.timing.createdAt.localeCompare(cursor.createdAt) ||
		item.id.localeCompare(cursor.id)
	);
}

function getEffectiveLimit(limit: number | undefined): number {
	if (typeof limit !== "number" || !Number.isFinite(limit)) return DEFAULT_LIMIT;

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
