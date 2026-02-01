"use client";

import { useState, useCallback } from "react";
import { IconCheck, IconInbox, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
	useApprovalInbox,
	useBulkApprove,
	type ApprovalInboxFilters,
} from "@/lib/query/use-approval-inbox";
import type { UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { ApprovalInboxToolbar } from "./components/approval-inbox-toolbar";
import { ApprovalInboxTable } from "./components/approval-inbox-table";
import { ApprovalDetailPanel } from "./components/approval-detail-panel";

export default function ApprovalInboxPage() {
	const { t } = useTranslate();
	const [filters, setFilters] = useState<ApprovalInboxFilters>({ status: "pending" });
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [detailApproval, setDetailApproval] = useState<UnifiedApprovalItem | null>(null);

	const {
		data,
		isLoading,
		isFetching,
		fetchNextPage,
		hasNextPage,
		isFetchingNextPage,
		refetch,
	} = useApprovalInbox(filters);

	const bulkApproveMutation = useBulkApprove();

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

		const result = await bulkApproveMutation.mutateAsync(Array.from(selectedIds));

		if (result.succeeded.length > 0) {
			toast.success(
				t(
					"approvals.bulkApproveSuccess",
					`${result.succeeded.length} request(s) approved`,
					{ count: result.succeeded.length },
				),
			);
		}

		if (result.failed.length > 0) {
			toast.error(
				t(
					"approvals.bulkApproveFailed",
					`${result.failed.length} request(s) failed`,
					{ count: result.failed.length },
				),
			);
		}

		setSelectedIds(new Set());
		refetch();
	}, [selectedIds, bulkApproveMutation, t, refetch]);

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
						<Button
							onClick={handleBulkApprove}
							disabled={bulkApproveMutation.isPending}
						>
							{bulkApproveMutation.isPending ? (
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
							) : (
								<IconCheck className="mr-2 h-4 w-4" aria-hidden="true" />
							)}
							{t("approvals.approveSelected", "Approve Selected")} ({selectedIds.size})
						</Button>
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
							<span className="text-sm font-normal text-muted-foreground">
								({totalCount})
							</span>
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
		</div>
	);
}
