"use client";

/**
 * Approval Inbox React Query Hooks
 *
 * Provides hooks for fetching and mutating approvals in the unified inbox.
 */

import {
	keepPreviousData,
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { SUPPORTED_APPROVAL_INBOX_TYPES } from "@/lib/approvals/inbox/types";
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxDetailResult,
	ApprovalInboxItem,
	ApprovalInboxListResult,
	ApprovalInboxPriority,
	ApprovalInboxStatus,
	ApprovalInboxType,
} from "@/lib/approvals/inbox/types";
import { queryKeys } from "./keys";

// ============================================
// TYPES
// ============================================

export interface ApprovalInboxFilters {
	status?: ApprovalInboxStatus;
	types?: ApprovalInboxType[];
	teamId?: string;
	search?: string;
	priority?: ApprovalInboxPriority;
	minAgeDays?: number;
	dateRange?: {
		from: Date;
		to: Date;
	};
}

// ============================================
// DATA FETCHING FUNCTIONS
// ============================================

async function fetchApprovals(
	filters: ApprovalInboxFilters,
	cursor?: string,
): Promise<ApprovalInboxListResult> {
	const params = new URLSearchParams();

	if (filters.status) params.set("status", filters.status);
	if (filters.types?.length) params.set("types", filters.types.join(","));
	if (filters.teamId) params.set("teamId", filters.teamId);
	if (filters.search) params.set("search", filters.search);
	if (filters.priority) params.set("priority", filters.priority);
	if (filters.minAgeDays) params.set("minAgeDays", String(filters.minAgeDays));
	if (filters.dateRange) {
		params.set("dateFrom", filters.dateRange.from.toISOString());
		params.set("dateTo", filters.dateRange.to.toISOString());
	}
	if (cursor) params.set("cursor", cursor);
	params.set("limit", "20");

	const response = await fetch(`/api/approvals/inbox?${params}`);
	if (!response.ok) {
		return readQueryError(response, "Failed to fetch approvals");
	}
	return response.json();
}

export async function readQueryError(response: Response, fallback: string): Promise<never> {
	const rawPayload = await response.text();
	let payload: unknown = null;

	if (rawPayload) {
		try {
			payload = JSON.parse(rawPayload);
		} catch {
			payload = null;
		}
	}

	throw new Error(
		typeof payload === "object" &&
			payload !== null &&
			"error" in payload &&
			typeof payload.error === "string"
			? payload.error
			: fallback,
	);
}

async function fetchApprovalCounts(): Promise<Record<ApprovalInboxType, number>> {
	const response = await fetch("/api/approvals/inbox/counts");
	if (!response.ok) {
		throw new Error("Failed to fetch approval counts");
	}
	return response.json();
}

async function fetchApprovalDetail(approvalId: string): Promise<ApprovalInboxDetailResult> {
	const response = await fetch(`/api/approvals/inbox/${approvalId}`);
	if (!response.ok) {
		throw new Error("Failed to fetch approval detail");
	}
	return response.json();
}

async function approveApproval(approvalId: string): Promise<{ success: boolean; error?: string }> {
	const response = await fetch(`/api/approvals/inbox/${approvalId}/approve`, {
		method: "POST",
	});
	return response.json();
}

async function rejectApproval(
	approvalId: string,
	reason: string,
): Promise<{ success: boolean; error?: string }> {
	const response = await fetch(`/api/approvals/inbox/${approvalId}/reject`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ reason }),
	});
	return response.json();
}

type BulkDecisionAction = "approve" | "reject";
const SUPPORTED_BULK_FAILURE_CODES = [
	"forbidden",
	"stale",
	"validation_failed",
	"not_found",
	"unsupported",
] as const;

export async function readBulkDecisionResult(
	response: Response,
	action: BulkDecisionAction = "approve",
): Promise<ApprovalInboxBulkDecisionResult> {
	const rawPayload = await response.text();
	let payload: unknown = null;

	if (rawPayload) {
		try {
			payload = JSON.parse(rawPayload);
		} catch {
			payload = null;
		}
	}

	if (!response.ok) {
		throw new Error(
			typeof payload === "object" &&
				payload !== null &&
				"error" in payload &&
				typeof payload.error === "string"
				? payload.error
				: `Bulk ${action} request failed`,
		);
	}

	if (
		typeof payload !== "object" ||
		payload === null ||
		!("succeeded" in payload) ||
		!("failed" in payload) ||
		!Array.isArray(payload.succeeded) ||
		!Array.isArray(payload.failed) ||
		!payload.succeeded.every(isBulkDecisionSuccess) ||
		!payload.failed.every(isBulkDecisionFailure)
	) {
		throw new Error(`Invalid bulk ${action} response`);
	}

	return payload as ApprovalInboxBulkDecisionResult;
}

function isBulkDecisionSuccess(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"type" in value &&
		SUPPORTED_APPROVAL_INBOX_TYPES.includes(value.type as ApprovalInboxType) &&
		"status" in value &&
		(value.status === "approved" || value.status === "rejected")
	);
}

function isBulkDecisionFailure(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"code" in value &&
		SUPPORTED_BULK_FAILURE_CODES.includes(
			value.code as (typeof SUPPORTED_BULK_FAILURE_CODES)[number],
		) &&
		"message" in value &&
		typeof value.message === "string"
	);
}

async function bulkApproveApprovals(
	approvalIds: string[],
): Promise<ApprovalInboxBulkDecisionResult> {
	const response = await fetch("/api/approvals/inbox/bulk-approve", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ approvalIds }),
	});
	return readBulkDecisionResult(response, "approve");
}

async function bulkRejectApprovals(
	approvalIds: string[],
	reason: string,
): Promise<ApprovalInboxBulkDecisionResult> {
	const response = await fetch("/api/approvals/inbox/bulk-reject", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ approvalIds, reason }),
	});
	return readBulkDecisionResult(response, "reject");
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook for fetching paginated approvals with infinite scrolling.
 */
export function useApprovalInbox(filters: ApprovalInboxFilters = {}) {
	const isClient = typeof window !== "undefined";

	return useInfiniteQuery({
		queryKey: queryKeys.approvals.inbox(filters),
		queryFn: ({ pageParam }) => fetchApprovals(filters, pageParam as string | undefined),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		initialPageParam: undefined as string | undefined,
		placeholderData: keepPreviousData,
		enabled: isClient,
	});
}

/**
 * Hook for fetching approval counts per type.
 */
export function useApprovalCounts() {
	const isClient = typeof window !== "undefined";

	return useQuery({
		queryKey: queryKeys.approvals.inboxCounts(),
		queryFn: fetchApprovalCounts,
		enabled: isClient,
		staleTime: 60 * 1000, // 1 minute
	});
}

/**
 * Hook for fetching approval detail.
 */
export function useApprovalDetail(approvalId: string | null) {
	const isClient = typeof window !== "undefined";

	return useQuery({
		queryKey: queryKeys.approvals.detail(approvalId || ""),
		queryFn: () => fetchApprovalDetail(approvalId!),
		enabled: isClient && !!approvalId,
	});
}

/**
 * Hook for approving a single approval.
 */
export function useApproveApproval() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: approveApproval,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
		},
	});
}

/**
 * Hook for rejecting a single approval.
 */
export function useRejectApproval() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({ approvalId, reason }: { approvalId: string; reason: string }) =>
			rejectApproval(approvalId, reason),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
		},
	});
}

/**
 * Hook for bulk approving multiple approvals.
 */
export function useBulkApprove() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: bulkApproveApprovals,
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
		},
	});
}

/**
 * Hook for bulk rejecting multiple approvals.
 */
export function useBulkReject() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: ({ approvalIds, reason }: { approvalIds: string[]; reason: string }) =>
			bulkRejectApprovals(approvalIds, reason),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all });
		},
	});
}

/**
 * Helper hook to get all loaded approval items from infinite query.
 */
export function useApprovalItems(filters: ApprovalInboxFilters = {}): ApprovalInboxItem[] {
	const { data } = useApprovalInbox(filters);
	return data?.pages.flatMap((page) => page.items) ?? [];
}
