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
import { Suspense, useReducer, useRef, useSyncExternalStore } from "react";
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
import { approvalInboxUiReducer, createApprovalInboxUiState } from "./approval-inbox-state";

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

type ApprovalInboxHeaderBulkState = {
	isActionPending: boolean;
	canApproveSelection: boolean;
	canRejectSelection: boolean;
	approvePending: boolean;
};

type ApprovalInboxRefreshState = {
	isFetching: boolean;
};

type ApprovalInboxPaginationState = {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
};

type ApprovalInboxRequestActivityState = {
	isBulkActionPending: boolean;
	isFetching: boolean;
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
	return items.toSorted((first, second) => {
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

function ApprovalInboxLoadingState() {
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

function ApprovalInboxPageHeader({
	t,
	bulkState,
	refreshState,
	selectedCount,
	sprintItemCount,
	onBulkApprove,
	onOpenBulkReject,
	onOpenSprint,
	onRefresh,
}: {
	t: ReturnType<typeof useTranslate>["t"];
	bulkState: ApprovalInboxHeaderBulkState;
	refreshState: ApprovalInboxRefreshState;
	selectedCount: number;
	sprintItemCount: number;
	onBulkApprove: () => void;
	onOpenBulkReject: () => void;
	onOpenSprint: () => void;
	onRefresh: () => void;
}) {
	return (
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
				{selectedCount > 0 && (
					<>
						<Button
							variant="outline"
							onClick={onOpenBulkReject}
							disabled={bulkState.isActionPending || !bulkState.canRejectSelection}
						>
							<IconX className="mr-2 size-4" aria-hidden="true" />
							{t("approvals:approvals.rejectSelected", "Reject Selected")} ({selectedCount})
						</Button>
						<Button onClick={onBulkApprove} disabled={bulkState.isActionPending || !bulkState.canApproveSelection}>
							{bulkState.approvePending ? (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconCheck className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("approvals:approvals.approveSelected", "Approve Selected")} ({selectedCount})
						</Button>
					</>
				)}
				<Button variant="outline" onClick={onOpenSprint} disabled={sprintItemCount === 0}>
					<IconInbox className="mr-2 size-4" aria-hidden="true" />
					{t("approvals:sprint.start", "Start approval sprint")}
				</Button>
				<Button variant="ghost" size="icon" onClick={onRefresh} disabled={refreshState.isFetching}>
					{refreshState.isFetching ? (
						<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconRefresh className="size-4" aria-hidden="true" />
					)}
					<span className="sr-only">{t("common.refresh", "Refresh")}</span>
				</Button>
			</div>
		</div>
	);
}

function ApprovalInboxErrorState({
	t,
	error,
	isFetching,
	onRefresh,
}: {
	t: ReturnType<typeof useTranslate>["t"];
	error: unknown;
	isFetching: boolean;
	onRefresh: () => void;
}) {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<ApprovalInboxPageHeader
				t={t}
				bulkState={{
					isActionPending: false,
					canApproveSelection: false,
					canRejectSelection: false,
					approvePending: false,
				}}
				refreshState={{ isFetching }}
				selectedCount={0}
				sprintItemCount={0}
				onBulkApprove={() => undefined}
				onOpenBulkReject={() => undefined}
				onOpenSprint={() => undefined}
				onRefresh={onRefresh}
			/>
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

function ApprovalInboxWarnings({ warnings }: { warnings: ApprovalInboxWarning[] }) {
	if (warnings.length === 0) return null;

	return (
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
	);
}

function ApprovalInboxRequestsCard({
	t,
	warnings,
	totalCount,
	fastLaneGroups,
	activityState,
	filters,
	selectedCount,
	items,
	selectedIds,
	supportedTypes,
	paginationState,
	onBulkApprove,
	onBulkReject,
	onFiltersChange,
	onSelectAll,
	onSelectItem,
	onRowClick,
	onFetchNextPage,
}: {
	t: ReturnType<typeof useTranslate>["t"];
	warnings: ApprovalInboxWarning[];
	totalCount: number;
	fastLaneGroups: ApprovalInboxFastLaneGroupView[];
	activityState: ApprovalInboxRequestActivityState;
	filters: ApprovalInboxFilters;
	selectedCount: number;
	items: ApprovalInboxItem[];
	selectedIds: Set<string>;
	supportedTypes: ApprovalInboxType[];
	paginationState: ApprovalInboxPaginationState;
	onBulkApprove: (approvalIds: string[]) => Promise<void>;
	onBulkReject: (approvalIds: string[], reason: string) => Promise<void>;
	onFiltersChange: (nextFilters: ApprovalInboxFilters) => void;
	onSelectAll: (checked: boolean) => void;
	onSelectItem: (id: string, checked: boolean) => void;
	onRowClick: (approval: ApprovalInboxItem) => void;
	onFetchNextPage: () => void;
}) {
	return (
		<div className="px-4 lg:px-6">
			<ApprovalInboxWarnings warnings={warnings} />
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
						isBusy={activityState.isBulkActionPending}
						onBulkApprove={onBulkApprove}
						onBulkReject={onBulkReject}
					/>
					<div className="mt-4">
						<ApprovalInboxToolbar
							filters={filters}
							onFiltersChange={onFiltersChange}
							selectedCount={selectedCount}
							totalCount={totalCount}
							allSelected={items.length > 0 && selectedCount === items.length}
							onSelectAll={onSelectAll}
							supportedTypes={supportedTypes}
						/>
					</div>
					<div className="mt-4">
						<ApprovalInboxTable
							items={items}
							selectedIds={selectedIds}
							onSelectItem={onSelectItem}
							onRowClick={onRowClick}
							isFetching={activityState.isFetching}
						/>
					</div>
					{paginationState.hasNextPage && (
						<div className="mt-4 flex justify-center">
							<Button variant="outline" onClick={onFetchNextPage} disabled={paginationState.isFetchingNextPage}>
								{paginationState.isFetchingNextPage ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								) : null}
								{t("common.loadMore", "Load More")}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function BulkRejectPanel({
	t,
	open,
	reason,
	isPending,
	canBulkRejectSelection,
	onOpenChange,
	onReasonChange,
	onReject,
}: {
	t: ReturnType<typeof useTranslate>["t"];
	open: boolean;
	reason: string;
	isPending: boolean;
	canBulkRejectSelection: boolean;
	onOpenChange: (open: boolean) => void;
	onReasonChange: (reason: string) => void;
	onReject: () => void;
}) {
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("approvals:approvals.rejectSelected", "Reject Selected")}</ActionPanelTitle>
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
						value={reason}
						onChange={(event) => onReasonChange(event.target.value)}
						placeholder={t(
							"approvals:approvals.rejectionReasonPlaceholder",
							"Please provide a reason for rejecting this request…",
						)}
						rows={4}
					/>
				</ActionPanelBody>
				<ActionPanelFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button
						variant="destructive"
						onClick={onReject}
						disabled={!reason.trim() || isPending || !canBulkRejectSelection}
					>
						{isPending && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
						<IconX className="mr-2 size-4" aria-hidden="true" />
						{t("approvals:approvals.confirmReject", "Confirm Rejection")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function ApprovalInboxContent() {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const [uiState, dispatch] = useReducer(
		approvalInboxUiReducer,
		searchParams,
		(params) => createApprovalInboxUiState(getInitialApprovalInboxFilters(params)),
	);
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
	} = useApprovalInbox(uiState.filters);

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
		uiState.selectedIdDraft.itemIdsKey === itemIdsKey ? uiState.selectedIdDraft.ids : new Set<string>();
	const pendingItems = items.filter((item) => item.status === "pending");
	const fastLaneGroups = groupFastLaneItems(pendingItems);
	const sprintItems = sortSprintItems(pendingItems);
	const selectedItems = items.filter((item) => selectedIds.has(item.id));
	const selectedBulkApproveIds = selectedItems.flatMap((item) =>
		item.capabilities.canApprove && item.capabilities.canBulkApprove ? [item.id] : [],
	);
	const selectedBulkRejectIds = selectedItems.flatMap((item) =>
		item.capabilities.canReject ? [item.id] : [],
	);

	const handleSelectAll = (checked: boolean) => {
		dispatch({
			type: "selectionChanged",
			itemIdsKey,
			ids: checked ? new Set(items.map((item) => item.id)) : new Set(),
		});
	};

	const handleSelectItem = (id: string, checked: boolean) => {
		const newSelection = new Set(selectedIds);
		if (checked) {
			newSelection.add(id);
		} else {
			newSelection.delete(id);
		}
		dispatch({ type: "selectionChanged", itemIdsKey, ids: newSelection });
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

			dispatch({ type: "selectionCleared", itemIdsKey });
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
		const reason = uiState.bulkRejectReason.trim();
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

			dispatch({ type: "bulkRejectOpenChanged", open: false });
			dispatch({ type: "selectionCleared", itemIdsKey });
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

			dispatch({ type: "selectionCleared", itemIdsKey });
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

			dispatch({ type: "selectionCleared", itemIdsKey });
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
		dispatch({ type: "detailApprovalChanged", approval });
	};

	const handleCloseDetail = () => {
		dispatch({ type: "detailApprovalChanged", approval: null });
	};

	const handleApprovalActioned = () => {
		refetch();
		dispatch({ type: "selectionCleared", itemIdsKey });
	};

	const isBulkActionPending = bulkApproveMutation.isPending || bulkRejectMutation.isPending;
	const canBulkApproveSelection = selectedBulkApproveIds.length > 0;
	const canBulkRejectSelection = selectedBulkRejectIds.length > 0;

	const handleFiltersChange = (nextFilters: ApprovalInboxFilters) => {
		dispatch({ type: "filtersChanged", filters: nextFilters, itemIdsKey });
	};

	if (!hasHydrated || (isLoading && !data)) {
		return <ApprovalInboxLoadingState />;
	}

	if (isError) {
		return <ApprovalInboxErrorState t={t} error={error} isFetching={isFetching} onRefresh={() => refetch()} />;
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<ApprovalInboxPageHeader
				t={t}
				bulkState={{
					isActionPending: isBulkActionPending,
					canApproveSelection: canBulkApproveSelection,
					canRejectSelection: canBulkRejectSelection,
					approvePending: bulkApproveMutation.isPending,
				}}
				refreshState={{ isFetching }}
				selectedCount={selectedIds.size}
				sprintItemCount={sprintItems.length}
				onBulkApprove={handleBulkApprove}
				onOpenBulkReject={() => dispatch({ type: "bulkRejectOpenChanged", open: true })}
				onOpenSprint={() => dispatch({ type: "sprintOpenChanged", open: true })}
				onRefresh={() => refetch()}
			/>
			<ApprovalInboxRequestsCard
				t={t}
				warnings={warnings}
				totalCount={totalCount}
				fastLaneGroups={fastLaneGroups}
				activityState={{ isBulkActionPending, isFetching }}
				filters={uiState.filters}
				selectedCount={selectedIds.size}
				items={items}
				selectedIds={selectedIds}
				supportedTypes={supportedTypes}
				paginationState={{ hasNextPage: !!hasNextPage, isFetchingNextPage }}
				onBulkApprove={handleFastLaneApprove}
				onBulkReject={handleFastLaneReject}
				onFiltersChange={handleFiltersChange}
				onSelectAll={handleSelectAll}
				onSelectItem={handleSelectItem}
				onRowClick={handleOpenDetail}
				onFetchNextPage={() => fetchNextPage()}
			/>
			<ApprovalDetailPanel
				approval={uiState.detailApproval}
				open={!!uiState.detailApproval}
				onOpenChange={(open) => !open && handleCloseDetail()}
				onActioned={handleApprovalActioned}
			/>

			<ApprovalSprintPanel
				open={uiState.sprintOpen}
				items={sprintItems}
				onOpenChange={(open) => dispatch({ type: "sprintOpenChanged", open })}
				onActioned={handleApprovalActioned}
				onOpenDetails={(approval) => {
					const item = items.find((candidate) => candidate.id === approval.id);
					if (item) {
						handleOpenDetail(item);
					}
				}}
				shortcutsEnabled={uiState.detailApproval === null}
			/>
			<BulkRejectPanel
				t={t}
				open={uiState.bulkRejectOpen}
				reason={uiState.bulkRejectReason}
				isPending={bulkRejectMutation.isPending}
				canBulkRejectSelection={canBulkRejectSelection}
				onOpenChange={(open) => dispatch({ type: "bulkRejectOpenChanged", open })}
				onReasonChange={(reason) => dispatch({ type: "bulkRejectReasonChanged", reason })}
				onReject={handleBulkReject}
			/>
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
