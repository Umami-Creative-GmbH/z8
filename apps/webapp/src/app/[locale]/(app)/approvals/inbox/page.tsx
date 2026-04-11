"use client";

import { IconCheck, IconInbox, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type {
	ApprovalType,
	BulkDecisionFailure,
	BulkDecisionResult,
	UnifiedApprovalItem,
} from "@/lib/approvals/domain/types";
import {
	type ApprovalInboxFilters,
	useApprovalInbox,
	useBulkApprove,
	useBulkReject,
} from "@/lib/query/use-approval-inbox";
import { ApprovalDetailPanel } from "./components/approval-detail-panel";
import { ApprovalInboxTable } from "./components/approval-inbox-table";
import { ApprovalInboxToolbar } from "./components/approval-inbox-toolbar";

function getBulkFailureMessage(
	t: ReturnType<typeof useTranslate>["t"],
	failed: BulkDecisionFailure[],
	fallbackKey: string,
): string {
	const summary = t(fallbackKey, `${failed.length} request(s) failed`, { count: failed.length });
	const details = failed.map((item) => item.message).join("\n");

	return details ? `${summary}\n${details}` : summary;
}

function handleBulkDecisionToasts(
	t: ReturnType<typeof useTranslate>["t"],
	result: BulkDecisionResult,
	successKey: string,
	successLabel: string,
	failureKey: string,
) {
	if (result.succeeded.length > 0) {
		toast.success(
			t(successKey, `${result.succeeded.length} request(s) ${successLabel}`, {
				count: result.succeeded.length,
			}),
		);
	}

	if (result.failed.length > 0) {
		toast.error(getBulkFailureMessage(t, result.failed, failureKey));
	}
}

function getErrorMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

export function getInitialApprovalInboxFilters(
	searchParams: Pick<URLSearchParams, "get"> | null,
): ApprovalInboxFilters {
	const rawTypes = searchParams?.get("types") ?? null;
	const types = rawTypes
		?.split(",")
		.map((value) => value.trim())
		.filter((value): value is ApprovalType => value.length > 0);

	return {
		status: "pending",
		...(types?.length ? { types } : {}),
	};
}

export default function ApprovalInboxPage() {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const [filters, setFilters] = useState<ApprovalInboxFilters>(() =>
		getInitialApprovalInboxFilters(searchParams),
	);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [detailApproval, setDetailApproval] = useState<UnifiedApprovalItem | null>(null);
	const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
	const [bulkRejectReason, setBulkRejectReason] = useState("");

	const {
		data,
		isLoading,
		isError,
		error,
		isFetching,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		refetch,
	} = useApprovalInbox(filters);

	const bulkApproveMutation = useBulkApprove();
	const bulkRejectMutation = useBulkReject();

	// Flatten pages into single array
	const items = data?.pages.flatMap((page) => page.items) ?? [];
	const totalCount = data?.pages[0]?.total ?? 0;

	// Selection handlers - use functional setState for stable callbacks
	const handleSelectAll = useCallback(
		(checked: boolean) => {
			if (checked) {
				// Need items for select all - this is acceptable
				setSelectedIds(new Set(items.map((item) => item.id)));
			} else {
				setSelectedIds(new Set());
			}
		},
		[items],
	);

	const handleSelectItem = useCallback((id: string, checked: boolean) => {
		setSelectedIds((prev) => {
			const newSelection = new Set(prev);
			if (checked) {
				newSelection.add(id);
			} else {
				newSelection.delete(id);
			}
			return newSelection;
		});
	}, []);

	const handleBulkApprove = useCallback(async () => {
		if (selectedIds.size === 0) return;

		try {
			const result = await bulkApproveMutation.mutateAsync(Array.from(selectedIds));
			handleBulkDecisionToasts(
				t,
				result,
				"approvals.bulkApproveSuccess",
				"approved",
				"approvals.bulkApproveFailed",
			);

			setSelectedIds(new Set());
			refetch();
		} catch (error) {
			toast.error(
				getErrorMessage(error, t("approvals.bulkApproveRequestFailed", "Bulk approve failed")),
			);
		}
	}, [selectedIds, bulkApproveMutation, t, refetch]);

	const handleBulkReject = useCallback(async () => {
		const reason = bulkRejectReason.trim();
		if (selectedIds.size === 0 || !reason) return;

		try {
			const result = await bulkRejectMutation.mutateAsync({
				approvalIds: Array.from(selectedIds),
				reason,
			});
			handleBulkDecisionToasts(
				t,
				result,
				"approvals.bulkRejectSuccess",
				"rejected",
				"approvals.bulkRejectFailed",
			);

			setBulkRejectOpen(false);
			setBulkRejectReason("");
			setSelectedIds(new Set());
			refetch();
		} catch (error) {
			toast.error(
				getErrorMessage(error, t("approvals.bulkRejectRequestFailed", "Bulk reject failed")),
			);
		}
	}, [bulkRejectReason, bulkRejectMutation, refetch, selectedIds, t]);

	const handleOpenDetail = useCallback((approval: UnifiedApprovalItem) => {
		setDetailApproval(approval);
	}, []);

	const handleCloseDetail = useCallback(() => {
		setDetailApproval(null);
	}, []);

	const handleApprovalActioned = useCallback(() => {
		refetch();
		setSelectedIds(new Set());
	}, [refetch]);

	const isBulkActionPending = bulkApproveMutation.isPending || bulkRejectMutation.isPending;

	// Loading state
	if (isLoading) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<div className="flex items-center justify-between">
					<div className="space-y-2">
						<Skeleton className="h-8 w-48" />
						<Skeleton className="h-4 w-96" />
					</div>
				</div>
				<Card>
					<CardHeader>
						<Skeleton className="h-6 w-32" />
					</CardHeader>
					<CardContent>
						<div className="space-y-3">
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
							<Skeleton className="h-12 w-full" />
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("approvals.inbox", "Approval Inbox")}
						</h1>
						<p className="text-sm text-muted-foreground">
							{t(
								"approvals.inboxDescription",
								"Review and approve pending requests from your team",
							)}
						</p>
					</div>
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						{isFetching ? (
							<IconLoader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="h-4 w-4" aria-hidden="true" />
						)}
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
				</div>

				<Card>
					<CardContent className="py-12">
						<div className="flex flex-col items-center justify-center text-center">
							<IconInbox className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
							<h2 className="mt-4 text-lg font-medium">
								{t("approvals.inboxErrorTitle", "Unable to load approval inbox")}
							</h2>
							<p className="mt-1 max-w-md text-sm text-muted-foreground">
								{getErrorMessage(
									error,
									t("approvals.inboxErrorDescription", "Failed to fetch approvals"),
								)}
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4 pt-0">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("approvals.inbox", "Approval Inbox")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("approvals.inboxDescription", "Review and approve pending requests from your team")}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{selectedIds.size > 0 && (
						<>
							<Button
								variant="outline"
								onClick={() => setBulkRejectOpen(true)}
								disabled={isBulkActionPending}
							>
								<IconX className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("approvals.rejectSelected", "Reject Selected")} ({selectedIds.size})
							</Button>
							<Button onClick={handleBulkApprove} disabled={isBulkActionPending}>
								{bulkApproveMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								) : (
									<IconCheck className="mr-2 h-4 w-4" aria-hidden="true" />
								)}
								{t("approvals.approveSelected", "Approve Selected")} ({selectedIds.size})
							</Button>
						</>
					)}
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						{isFetching ? (
							<IconLoader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="h-4 w-4" aria-hidden="true" />
						)}
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
				</div>
			</div>

			{/* Main content */}
			<Card>
				<CardHeader className="pb-0">
					<CardTitle className="flex items-center gap-2">
						<IconInbox className="h-5 w-5" aria-hidden="true" />
						{t("approvals.pendingRequests", "Pending Requests")}
						{totalCount > 0 && (
							<span className="text-sm font-normal text-muted-foreground">({totalCount})</span>
						)}
					</CardTitle>
					<CardDescription>
						{t(
							"approvals.pendingRequestsDescription",
							"Select requests to approve in bulk, or click a row for details",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-4">
					{/* Toolbar with filters */}
					<ApprovalInboxToolbar
						filters={filters}
						onFiltersChange={setFilters}
						selectedCount={selectedIds.size}
						totalCount={items.length}
						allSelected={items.length > 0 && selectedIds.size === items.length}
						onSelectAll={handleSelectAll}
					/>

					{/* Table */}
					<div className="mt-4">
						<ApprovalInboxTable
							items={items}
							selectedIds={selectedIds}
							onSelectItem={handleSelectItem}
							onRowClick={handleOpenDetail}
							isFetching={isFetching}
						/>
					</div>

					{/* Load more */}
					{hasNextPage && (
						<div className="mt-4 flex justify-center">
							<Button
								variant="outline"
								onClick={() => fetchNextPage()}
								disabled={isFetchingNextPage}
							>
								{isFetchingNextPage ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								) : null}
								{t("common.loadMore", "Load More")}
							</Button>
						</div>
					)}

					{/* Empty state */}
					{items.length === 0 && !isFetching && (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<IconInbox className="h-12 w-12 text-muted-foreground/50" aria-hidden="true" />
							<h3 className="mt-4 text-lg font-medium">
								{t("approvals.noRequests", "No pending requests")}
							</h3>
							<p className="mt-1 text-sm text-muted-foreground">
								{t(
									"approvals.noRequestsDescription",
									"When team members submit requests, they will appear here",
								)}
							</p>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Detail slide-over panel */}
			<ApprovalDetailPanel
				approval={detailApproval}
				open={!!detailApproval}
				onOpenChange={(open) => !open && handleCloseDetail()}
				onActioned={handleApprovalActioned}
			/>

			<Dialog
				open={bulkRejectOpen}
				onOpenChange={(open) => {
					setBulkRejectOpen(open);
					if (!open) {
						setBulkRejectReason("");
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("approvals.rejectSelected", "Reject Selected")}</DialogTitle>
						<DialogDescription>
							{t(
								"approvals.bulkRejectDescription",
								"Provide a reason that will be applied to each selected request.",
							)}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2">
						<label className="text-sm font-medium" htmlFor="bulk-reject-reason">
							{t("approvals.rejectionReason", "Reason for rejection")}
						</label>
						<Textarea
							id="bulk-reject-reason"
							value={bulkRejectReason}
							onChange={(event) => setBulkRejectReason(event.target.value)}
							placeholder={t(
								"approvals.rejectionReasonPlaceholder",
								"Please provide a reason for rejecting this request…",
							)}
							rows={4}
						/>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setBulkRejectOpen(false);
								setBulkRejectReason("");
							}}
							disabled={bulkRejectMutation.isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							variant="destructive"
							onClick={handleBulkReject}
							disabled={!bulkRejectReason.trim() || bulkRejectMutation.isPending}
						>
							{bulkRejectMutation.isPending && (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
							)}
							<IconX className="mr-2 h-4 w-4" aria-hidden="true" />
							{t("approvals.confirmReject", "Confirm Rejection")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
