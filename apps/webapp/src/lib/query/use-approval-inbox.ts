/**
 * Approval Inbox React Query Hooks
 *
 * Provides hooks for fetching and mutating approvals in the unified inbox.
 */

import {
	useInfiniteQuery,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { queryKeys } from "./keys";
import type {
	ApprovalPriority,
	ApprovalStatus,
	ApprovalType,
	PaginatedApprovalResult,
	UnifiedApprovalItem,
	BulkApproveResult,
	ApprovalDetail,
} from "@/lib/approvals/domain/types";

// ============================================
// TYPES
// ============================================

export interface ApprovalInboxFilters {
	status?: ApprovalStatus;
	types?: ApprovalType[];
	teamId?: string;
	search?: string;
	priority?: ApprovalPriority;
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
): Promise<PaginatedApprovalResult> {
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
		throw new Error("Failed to fetch approvals");
	}
	return response.json();
}

async function fetchApprovalCounts(): Promise<Record<ApprovalType, number>> {
	const response = await fetch("/api/approvals/inbox/counts");
	if (!response.ok) {
		throw new Error("Failed to fetch approval counts");
	}
	return response.json();
}

async function fetchApprovalDetail(approvalId: string): Promise<ApprovalDetail> {
	const response = await fetch(`/api/approvals/inbox/${approvalId}`);
	if (!response.ok) {
		throw new Error("Failed to fetch approval detail");
	}
	return response.json();
}

async function approveApproval(
	approvalId: string,
): Promise<{ success: boolean; error?: string }> {
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

async function bulkApproveApprovals(
	approvalIds: string[],
): Promise<BulkApproveResult> {
	const response = await fetch("/api/approvals/inbox/bulk-approve", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ approvalIds }),
	});
	return response.json();
}

// ============================================
// HOOKS
// ============================================

/**
 * Hook for fetching paginated approvals with infinite scrolling.
 */
export function useApprovalInbox(filters: ApprovalInboxFilters = {}) {
	return useInfiniteQuery({
		queryKey: queryKeys.approvals.inbox(filters),
		queryFn: ({ pageParam }) => fetchApprovals(filters, pageParam as string | undefined),
		getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
		initialPageParam: undefined as string | undefined,
	});
}

/**
 * Hook for fetching approval counts per type.
 */
export function useApprovalCounts() {
	return useQuery({
		queryKey: queryKeys.approvals.inboxCounts(),
		queryFn: fetchApprovalCounts,
		staleTime: 60 * 1000, // 1 minute
	});
}

/**
 * Hook for fetching approval detail.
 */
export function useApprovalDetail(approvalId: string | null) {
	return useQuery({
		queryKey: queryKeys.approvals.detail(approvalId || ""),
		queryFn: () => fetchApprovalDetail(approvalId!),
		enabled: !!approvalId,
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
 * Helper hook to get all loaded approval items from infinite query.
 */
export function useApprovalItems(filters: ApprovalInboxFilters = {}): UnifiedApprovalItem[] {
	const { data } = useApprovalInbox(filters);
	return data?.pages.flatMap((page) => page.items) ?? [];
}
