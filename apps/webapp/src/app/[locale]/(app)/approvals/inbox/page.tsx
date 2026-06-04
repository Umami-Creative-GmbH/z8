"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconInbox,
	IconLoader2,
	IconRefresh,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxDecisionFailure,
	ApprovalInboxFastLaneGroup,
	ApprovalInboxItem,
	ApprovalInboxType,
	ApprovalInboxWarning,
} from "@/lib/approvals/inbox/types";
import {
	type ApprovalInboxFilters,
	useApprovalInbox,
	useBulkApprove,
	useBulkReject,
} from "@/lib/query/use-approval-inbox";
import { ApprovalDetailPanel } from "./components/approval-detail-panel";
import { ApprovalFastLanes } from "./components/approval-fast-lanes";
import { ApprovalInboxTable } from "./components/approval-inbox-table";
import { ApprovalInboxToolbar } from "./components/approval-inbox-toolbar";
import { ApprovalSprintPanel } from "./components/approval-sprint-panel";

function getBulkFailureMessage(
	t: ReturnType<typeof useTranslate>["t"],
	failed: ApprovalInboxDecisionFailure[],
	fallbackKey: string,
): string {
	const summary = t(fallbackKey, `${failed.length} request(s) failed`, { count: failed.length });
	const details = failed.map((item) => item.message).join("\n");

	return details ? `${summary}\n${details}` : summary;
}

function handleBulkDecisionToasts(
	t: ReturnType<typeof useTranslate>["t"],
	result: ApprovalInboxBulkDecisionResult,
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

function dedupeWarnings(warnings: ApprovalInboxWarning[]): ApprovalInboxWarning[] {
	const seen = new Set<string>();
	const uniqueWarnings: ApprovalInboxWarning[] = [];

	for (const warning of warnings) {
		const key = `${warning.source}:${warning.message}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		uniqueWarnings.push(warning);
	}

	return uniqueWarnings;
}

type ApprovalInboxFastLaneGroupView = {
	key: ApprovalInboxFastLaneGroup;
	items: ApprovalInboxItem[];
};

const RISK_RANK: Record<ApprovalInboxItem["triage"]["riskLevel"], number> = {
	low: 1,
	medium: 2,
	high: 3,
};

function subscribeHydrationSnapshot() {
	return () => undefined;
}

function getClientHydrationSnapshot() {
	return true;
}

function getServerHydrationSnapshot() {
	return false;
}

function groupFastLaneItems(items: ApprovalInboxItem[]): ApprovalInboxFastLaneGroupView[] {
	const groups = new Map<ApprovalInboxFastLaneGroup, ApprovalInboxItem[]>();

	for (const item of items) {
		const groupKey = item.triage.fastLaneGroup;
		if (groupKey === null) {
			continue;
		}

		groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
	}

	return Array.from(groups, ([key, groupedItems]) => ({ key, items: groupedItems }));
}

function sortSprintItems(items: ApprovalInboxItem[]): ApprovalInboxItem[] {
	return [...items].sort((first, second) => {
		const riskDifference = RISK_RANK[second.triage.riskLevel] - RISK_RANK[first.triage.riskLevel];
		if (riskDifference !== 0) {
			return riskDifference;
		}

		return second.timing.ageDays - first.timing.ageDays;
	});
}

export function getInitialApprovalInboxFilters(
	searchParams: Pick<URLSearchParams, "get"> | null,
): ApprovalInboxFilters {
	const rawTypes = searchParams?.get("types") ?? null;
	const types = rawTypes
		?.split(",")
		.map((value) => value.trim())
		.filter((value): value is ApprovalInboxType =>
			["absence_entry", "time_entry", "travel_expense_claim"].includes(value),
		);

	return {
		status: "pending",
		...(types?.length ? { types } : {}),
	};
}

function ApprovalInboxContent() {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const [filters, setFilters] = useState<ApprovalInboxFilters>(() =>
		getInitialApprovalInboxFilters(searchParams),
	);
	const [selectedIdDraft, setSelectedIdDraft] = useState<{
		itemIdsKey: string;
		ids: Set<string>;
	}>({ itemIdsKey: "", ids: new Set() });
	const [detailApproval, setDetailApproval] = useState<ApprovalInboxItem | null>(null);
	const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
	const [bulkRejectReason, setBulkRejectReason] = useState("");
	const [sprintOpen, setSprintOpen] = useState(false);
	const hasHydrated = useSyncExternalStore(
		subscribeHydrationSnapshot,
		getClientHydrationSnapshot,
		getServerHydrationSnapshot,
	);
	const bulkActionInFlightRef = useRef(false);

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

	const pages = data?.pages ?? [];
	const items = pages.flatMap((page) => page.items);
	const firstPage = pages[0];
	const totalCount = firstPage?.total ?? 0;
	const warnings = dedupeWarnings(pages.flatMap((page) => page.warnings));
	const supportedTypes = firstPage?.supportedTypes ?? [];
	const itemIdsKey = items.map((item) => item.id).join("\u001f");
	const selectedIds =
		selectedIdDraft.itemIdsKey === itemIdsKey ? selectedIdDraft.ids : new Set<string>();
	const pendingItems = items.filter((item) => item.status === "pending");
	const fastLaneGroups = groupFastLaneItems(pendingItems);
	const sprintItems = sortSprintItems(pendingItems);
	const selectedItems = items.filter((item) => selectedIds.has(item.id));
	const selectedBulkApproveIds = selectedItems
		.filter((item) => item.capabilities.canApprove && item.capabilities.canBulkApprove)
		.map((item) => item.id);
	const selectedBulkRejectIds = selectedItems
		.filter((item) => item.capabilities.canReject)
		.map((item) => item.id);

	// Selection handlers - use functional setState for stable callbacks
	const handleSelectAll = (checked: boolean) => {
		if (checked) {
			// Need items for select all - this is acceptable
			setSelectedIdDraft({ itemIdsKey, ids: new Set(items.map((item) => item.id)) });
		} else {
			setSelectedIdDraft({ itemIdsKey, ids: new Set() });
		}
	};

	const handleSelectItem = (id: string, checked: boolean) => {
		setSelectedIdDraft((previousDraft) => {
			const previousIds =
				previousDraft.itemIdsKey === itemIdsKey ? previousDraft.ids : new Set<string>();
			const newSelection = new Set(previousIds);
			if (checked) {
				newSelection.add(id);
			} else {
				newSelection.delete(id);
			}
			return { itemIdsKey, ids: newSelection };
		});
	};

	const handleBulkApprove = async () => {
		if (selectedBulkApproveIds.length === 0 || bulkActionInFlightRef.current) return;

		bulkActionInFlightRef.current = true;
		try {
			const result = await bulkApproveMutation.mutateAsync(selectedBulkApproveIds);
			handleBulkDecisionToasts(
				t,
				result,
				"approvals:approvals.bulkApproveSuccess",
				"approved",
				"approvals:approvals.bulkApproveFailed",
			);

			setSelectedIdDraft({ itemIdsKey, ids: new Set() });
			refetch();
		} catch (error) {
			bulkActionInFlightRef.current = false;
			toast.error(
				getErrorMessage(
					error,
					t("approvals:approvals.bulkApproveRequestFailed", "Bulk approve failed"),
				),
			);
			return;
		}

		bulkActionInFlightRef.current = false;
	};

	const handleBulkReject = async () => {
		const reason = bulkRejectReason.trim();
		if (selectedBulkRejectIds.length === 0 || !reason || bulkActionInFlightRef.current) return;

		bulkActionInFlightRef.current = true;
		try {
			const result = await bulkRejectMutation.mutateAsync({
				approvalIds: selectedBulkRejectIds,
				reason,
			});
			handleBulkDecisionToasts(
				t,
				result,
				"approvals:approvals.bulkRejectSuccess",
				"rejected",
				"approvals:approvals.bulkRejectFailed",
			);

			setBulkRejectOpen(false);
			setBulkRejectReason("");
			setSelectedIdDraft({ itemIdsKey, ids: new Set() });
			refetch();
		} catch (error) {
			bulkActionInFlightRef.current = false;
			toast.error(
				getErrorMessage(
					error,
					t("approvals:approvals.bulkRejectRequestFailed", "Bulk reject failed"),
				),
			);
			return;
		}

		bulkActionInFlightRef.current = false;
	};

	const handleFastLaneApprove = async (approvalIds: string[]) => {
		if (approvalIds.length === 0 || bulkActionInFlightRef.current) return;

		bulkActionInFlightRef.current = true;
		try {
			const result = await bulkApproveMutation.mutateAsync(approvalIds);
			handleBulkDecisionToasts(
				t,
				result,
				"approvals:approvals.bulkApproveSuccess",
				"approved",
				"approvals:approvals.bulkApproveFailed",
			);

			setSelectedIdDraft({ itemIdsKey, ids: new Set() });
			refetch();
		} catch (error) {
			bulkActionInFlightRef.current = false;
			toast.error(
				getErrorMessage(
					error,
					t("approvals:approvals.bulkApproveRequestFailed", "Bulk approve failed"),
				),
			);
			return;
		}

		bulkActionInFlightRef.current = false;
	};

	const handleFastLaneReject = async (approvalIds: string[], reason: string) => {
		const trimmedReason = reason.trim();
		if (approvalIds.length === 0 || !trimmedReason || bulkActionInFlightRef.current) return;

		bulkActionInFlightRef.current = true;
		try {
			const result = await bulkRejectMutation.mutateAsync({
				approvalIds,
				reason: trimmedReason,
			});
			handleBulkDecisionToasts(
				t,
				result,
				"approvals:approvals.bulkRejectSuccess",
				"rejected",
				"approvals:approvals.bulkRejectFailed",
			);

			setSelectedIdDraft({ itemIdsKey, ids: new Set() });
			refetch();
		} catch (error) {
			bulkActionInFlightRef.current = false;
			toast.error(
				getErrorMessage(
					error,
					t("approvals:approvals.bulkRejectRequestFailed", "Bulk reject failed"),
				),
			);
			return;
		}

		bulkActionInFlightRef.current = false;
	};

	const handleOpenDetail = (approval: ApprovalInboxItem) => {
		setDetailApproval(approval);
	};

	const handleCloseDetail = () => {
		setDetailApproval(null);
	};

	const handleApprovalActioned = () => {
		refetch();
		setSelectedIdDraft({ itemIdsKey, ids: new Set() });
	};

	const isBulkActionPending = bulkApproveMutation.isPending || bulkRejectMutation.isPending;
	const canBulkApproveSelection = selectedBulkApproveIds.length > 0;
	const canBulkRejectSelection = selectedBulkRejectIds.length > 0;

	const handleFiltersChange = (nextFilters: ApprovalInboxFilters) => {
		setSelectedIdDraft({ itemIdsKey, ids: new Set() });
		setFilters(nextFilters);
	};

	// Loading state
	if (!hasHydrated || (isLoading && !data)) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
				<div className="flex items-center justify-between px-4 lg:px-6">
					<div className="space-y-2">
						<Skeleton className="h-8 w-48" />
						<Skeleton className="h-4 w-96" />
					</div>
				</div>
				<div className="px-4 lg:px-6">
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
			</div>
		);
	}

	if (isError) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
				<div className="flex items-center justify-between px-4 lg:px-6">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("approvals:approvals.inbox", "Approval Inbox")}
						</h1>
						<p className="text-sm text-muted-foreground">
							{t(
								"approvals:approvals.inboxDescription",
								"Review and approve pending requests from your team",
							)}
						</p>
					</div>
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						{isFetching ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="size-4" aria-hidden="true" />
						)}
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
				</div>

				<div className="px-4 lg:px-6">
					<Card>
						<CardContent className="py-12">
							<div className="flex flex-col items-center justify-center text-center">
								<IconInbox className="size-12 text-muted-foreground/50" aria-hidden="true" />
								<h2 className="mt-4 text-lg font-medium">
									{t("approvals:approvals.inboxErrorTitle", "Unable to load approval inbox")}
								</h2>
								<p className="mt-1 max-w-md text-sm text-muted-foreground">
									{getErrorMessage(
										error,
										t("approvals:approvals.inboxErrorDescription", "Failed to fetch approvals"),
									)}
								</p>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Header */}
			<div className="flex items-center justify-between px-4 lg:px-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("approvals:approvals.inbox", "Approval Inbox")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"approvals:approvals.inboxDescription",
							"Review and approve pending requests from your team",
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{selectedIds.size > 0 && (
						<>
							<Button
								variant="outline"
								onClick={() => setBulkRejectOpen(true)}
								disabled={isBulkActionPending || !canBulkRejectSelection}
							>
								<IconX className="mr-2 size-4" aria-hidden="true" />
								{t("approvals:approvals.rejectSelected", "Reject Selected")} ({selectedIds.size})
							</Button>
							<Button
								onClick={handleBulkApprove}
								disabled={isBulkActionPending || !canBulkApproveSelection}
							>
								{bulkApproveMutation.isPending ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconCheck className="mr-2 size-4" aria-hidden="true" />
								)}
								{t("approvals:approvals.approveSelected", "Approve Selected")} ({selectedIds.size})
							</Button>
						</>
					)}
					<Button
						variant="outline"
						onClick={() => setSprintOpen(true)}
						disabled={sprintItems.length === 0}
					>
						<IconInbox className="mr-2 size-4" aria-hidden="true" />
						{t("approvals:sprint.start", "Start approval sprint")}
					</Button>
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						{isFetching ? (
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="size-4" aria-hidden="true" />
						)}
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
				</div>
			</div>

			{/* Main content */}
			<div className="px-4 lg:px-6">
				{warnings.length > 0 && (
					<div className="mb-4 space-y-2">
						{warnings.map((warning) => (
							<div
								key={`${warning.source}:${warning.message}`}
								className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200"
							>
								<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
								<div>
									<div className="font-medium">{warning.source}</div>
									<div>{warning.message}</div>
								</div>
							</div>
						))}
					</div>
				)}
				<Card>
					<CardHeader className="pb-0">
						<CardTitle className="flex items-center gap-2">
							<IconInbox className="size-5" aria-hidden="true" />
							{t("approvals:approvals.pendingRequests", "Pending Requests")}
							{totalCount > 0 && (
								<span className="text-sm font-normal text-muted-foreground">({totalCount})</span>
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"approvals:approvals.pendingRequestsDescription",
								"Select requests to approve in bulk, or click a row for details",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="pt-4">
						<ApprovalFastLanes
							groups={fastLaneGroups}
							isBusy={isBulkActionPending}
							onBulkApprove={handleFastLaneApprove}
							onBulkReject={handleFastLaneReject}
						/>

						{/* Toolbar with filters */}
						<div className="mt-4">
							<ApprovalInboxToolbar
								filters={filters}
								onFiltersChange={handleFiltersChange}
								selectedCount={selectedIds.size}
								totalCount={totalCount}
								allSelected={items.length > 0 && selectedIds.size === items.length}
								onSelectAll={handleSelectAll}
								supportedTypes={supportedTypes}
							/>
						</div>

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
										<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("common.loadMore", "Load More")}
								</Button>
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			{/* Detail slide-over panel */}
			<ApprovalDetailPanel
				approval={detailApproval}
				open={!!detailApproval}
				onOpenChange={(open) => !open && handleCloseDetail()}
				onActioned={handleApprovalActioned}
			/>

			<ApprovalSprintPanel
				open={sprintOpen}
				items={sprintItems}
				onOpenChange={setSprintOpen}
				onActioned={handleApprovalActioned}
				onOpenDetails={(approval) => {
					const item = items.find((candidate) => candidate.id === approval.id);
					if (item) {
						handleOpenDetail(item);
					}
				}}
				shortcutsEnabled={detailApproval === null}
			/>

			<ActionPanel
				open={bulkRejectOpen}
				onOpenChange={(open) => {
					setBulkRejectOpen(open);
					if (!open) {
						setBulkRejectReason("");
					}
				}}
			>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("approvals:approvals.rejectSelected", "Reject Selected")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"approvals:approvals.bulkRejectDescription",
								"Provide a reason that will be applied to each selected request.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-2">
						<label className="text-sm font-medium" htmlFor="bulk-reject-reason">
							{t("approvals:approvals.rejectionReason", "Reason for rejection")}
						</label>
						<Textarea
							id="bulk-reject-reason"
							value={bulkRejectReason}
							onChange={(event) => setBulkRejectReason(event.target.value)}
							placeholder={t(
								"approvals:approvals.rejectionReasonPlaceholder",
								"Please provide a reason for rejecting this request…",
							)}
							rows={4}
						/>
					</ActionPanelBody>
					<ActionPanelFooter>
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
							disabled={
								!bulkRejectReason.trim() || bulkRejectMutation.isPending || !canBulkRejectSelection
							}
						>
							{bulkRejectMutation.isPending && (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							)}
							<IconX className="mr-2 size-4" aria-hidden="true" />
							{t("approvals:approvals.confirmReject", "Confirm Rejection")}
						</Button>
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>
		</div>
	);
}

export default function ApprovalInboxPage() {
	return (
		<Suspense fallback={null}>
			<ApprovalInboxContent />
		</Suspense>
	);
}
