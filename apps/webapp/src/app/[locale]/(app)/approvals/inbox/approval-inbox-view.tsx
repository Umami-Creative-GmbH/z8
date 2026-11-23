"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useReducer, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { ApprovalFastLaneReview } from "@/lib/approvals/inbox/fast-lane-review";
import type {
	ApprovalInboxBulkDecisionResult,
	ApprovalInboxCoveringSection,
	ApprovalInboxDecisionFailure,
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
import { getInitialApprovalInboxFilters } from "./approval-inbox-filters";
import {
	type ApprovalInboxFastLaneGroupView,
	dedupeWarnings,
	getErrorMessage,
	groupFastLaneItems,
	isDecidableByViewer,
	isSelectableForBulkDecision,
	sortSprintItems,
} from "./approval-inbox-items";
import { approvalInboxUiReducer, createApprovalInboxUiState } from "./approval-inbox-state";
import { ApprovalDetailPanel } from "./components/approval-detail-panel";
import { ApprovalInboxBulkRejectPanel } from "./components/approval-inbox-bulk-reject-panel";
import { ApprovalInboxErrorState } from "./components/approval-inbox-error-state";
import { ApprovalInboxLoadingState } from "./components/approval-inbox-loading-state";
import {
	type ApprovalInboxHeaderBulkState,
	ApprovalInboxPageHeader,
} from "./components/approval-inbox-page-header";
import {
	type ApprovalInboxPaginationState,
	type ApprovalInboxRequestActivityState,
	ApprovalInboxRequestsCard,
} from "./components/approval-inbox-requests-card";
import { ApprovalSprintPanel } from "./components/approval-sprint-panel";

type Translate = ReturnType<typeof useTranslate>["t"];
type BulkDecision = "approve" | "reject";

function getBulkSuccessMessage(t: Translate, count: number, decision: BulkDecision): string {
	return decision === "approve"
		? t(
				"approvals:approvals.bulkApprovedCount",
				"{count, plural, one {# request approved} other {# requests approved}}",
				{ count },
			)
		: t(
				"approvals:approvals.bulkRejectedCount",
				"{count, plural, one {# request rejected} other {# requests rejected}}",
				{ count },
			);
}

function getBulkFailureMessage(
	t: Translate,
	failed: ApprovalInboxDecisionFailure[],
	decision: BulkDecision,
): string {
	const count = failed.length;
	const summary =
		decision === "approve"
			? t(
					"approvals:approvals.bulkApproveFailed",
					"{count, plural, one {# request failed} other {# requests failed}}",
					{ count },
				)
			: t(
					"approvals:approvals.bulkRejectFailed",
					"{count, plural, one {# request failed} other {# requests failed}}",
					{ count },
				);
	const details = failed.map((item) => item.message).join("\n");

	return details ? `${summary}\n${details}` : summary;
}

function handleBulkDecisionToasts(
	t: Translate,
	result: ApprovalInboxBulkDecisionResult,
	decision: BulkDecision,
) {
	if (result.succeeded.length > 0) {
		toast.success(getBulkSuccessMessage(t, result.succeeded.length, decision));
	}

	if (result.failed.length > 0) {
		toast.error(getBulkFailureMessage(t, result.failed, decision));
	}
}

function subscribeHydrationSnapshot() {
	return () => undefined;
}

function getClientHydrationSnapshot() {
	return true;
}

function getServerHydrationSnapshot() {
	return false;
}

type ApprovalInboxPanelsProps = {
	dispatch: (action: Parameters<typeof approvalInboxUiReducer>[1]) => void;
	itemIdsKey: string;
	refetch: () => void;
	t: Translate;
	warnings: ApprovalInboxWarning[];
	totalCount: number;
	fastLaneGroups: ApprovalInboxFastLaneGroupView[];
	filters: ApprovalInboxFilters;
	selectedCount: number;
	items: ApprovalInboxItem[];
	selectedIds: Set<string>;
	supportedTypes: ApprovalInboxType[];
	paginationState: ApprovalInboxPaginationState;
	activityState: ApprovalInboxRequestActivityState;
	bulkState: ApprovalInboxHeaderBulkState & { rejectPending: boolean };
	panelState: {
		detailApproval: ApprovalInboxItem | null;
		sprintOpen: boolean;
		bulkRejectOpen: boolean;
		bulkRejectReason: string;
	};
	sprintItems: ApprovalInboxItem[];
	onBulkApprove: () => void;
	onFastLaneApprove: (approvalIds: string[], review: ApprovalFastLaneReview) => Promise<void>;
	onFastLaneReject: (
		approvalIds: string[],
		reason: string,
		review: ApprovalFastLaneReview,
	) => Promise<void>;
	onSelectAll: (checked: boolean) => void;
	onSelectItem: (id: string, checked: boolean) => void;
	onFetchNextPage: () => void;
	onBulkReject: () => void;
	covering?: ApprovalInboxCoveringSection[];
};

function ApprovalInboxPanels({
	dispatch,
	itemIdsKey,
	refetch,
	t,
	warnings,
	totalCount,
	fastLaneGroups,
	filters,
	selectedCount,
	items,
	selectedIds,
	supportedTypes,
	paginationState,
	activityState,
	bulkState,
	panelState,
	sprintItems,
	onBulkApprove,
	onFastLaneApprove,
	onFastLaneReject,
	onSelectAll,
	onSelectItem,
	onFetchNextPage,
	onBulkReject,
	covering,
}: ApprovalInboxPanelsProps) {
	const onActioned = () => {
		refetch();
		dispatch({ type: "selectionCleared", itemIdsKey });
	};

	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			<ApprovalInboxPageHeader
				t={t}
				bulkState={bulkState}
				isFetching={activityState.isFetching}
				selectedCount={selectedCount}
				sprintItemCount={sprintItems.length}
				onBulkApprove={onBulkApprove}
				onOpenBulkReject={() => dispatch({ type: "bulkRejectOpenChanged", open: true })}
				onOpenSprint={() => dispatch({ type: "sprintOpenChanged", open: true })}
				onRefresh={refetch}
			/>
			<ApprovalInboxRequestsCard
				t={t}
				warnings={warnings}
				totalCount={totalCount}
				fastLaneGroups={fastLaneGroups}
				activityState={activityState}
				filters={filters}
				selectedCount={selectedCount}
				items={items}
				selectedIds={selectedIds}
				supportedTypes={supportedTypes}
				paginationState={paginationState}
				onBulkApprove={onFastLaneApprove}
				onBulkReject={onFastLaneReject}
				onFiltersChange={(nextFilters) =>
					dispatch({ type: "filtersChanged", filters: nextFilters, itemIdsKey })
				}
				onSelectAll={onSelectAll}
				onSelectItem={onSelectItem}
				onRowClick={(approval) => dispatch({ type: "detailApprovalChanged", approval })}
				onFetchNextPage={onFetchNextPage}
				covering={covering}
			/>
			<ApprovalDetailPanel
				approval={panelState.detailApproval}
				open={!!panelState.detailApproval}
				onOpenChange={(open) =>
					!open && dispatch({ type: "detailApprovalChanged", approval: null })
				}
				onActioned={onActioned}
			/>
			<ApprovalSprintPanel
				open={panelState.sprintOpen}
				items={sprintItems}
				onOpenChange={(open) => dispatch({ type: "sprintOpenChanged", open })}
				onActioned={onActioned}
				onOpenDetails={(approval) => {
					const item = items.find((candidate) => candidate.id === approval.id);
					if (item) dispatch({ type: "detailApprovalChanged", approval: item });
				}}
				shortcutsEnabled={panelState.detailApproval === null}
			/>
			<ApprovalInboxBulkRejectPanel
				t={t}
				open={panelState.bulkRejectOpen}
				reason={panelState.bulkRejectReason}
				isPending={bulkState.rejectPending}
				canBulkRejectSelection={bulkState.canRejectSelection}
				onOpenChange={(open) => dispatch({ type: "bulkRejectOpenChanged", open })}
				onReasonChange={(reason) => dispatch({ type: "bulkRejectReasonChanged", reason })}
				onReject={onBulkReject}
			/>
		</div>
	);
}

function ApprovalInboxContent({ initialFilters }: { initialFilters: ApprovalInboxFilters }) {
	const { t } = useTranslate();
	const [uiState, dispatch] = useReducer(
		approvalInboxUiReducer,
		initialFilters,
		createApprovalInboxUiState,
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
	const firstPage = pages[0];
	// The viewer's own approvals, then each "Covering for" section's rows (#1016).
	const items = [
		...pages.flatMap((page) => page.items),
		...(firstPage?.covering ?? []).flatMap((section) => section.rows),
	];
	const totalCount = firstPage?.total ?? 0;
	const warnings = dedupeWarnings([
		...pages.flatMap((page) => page.warnings),
		...(isError && data
			? [
					{
						source: t("common.refresh", "Refresh"),
						message: t(
							"approvals:approvals.refreshFailedRetained",
							"Refresh failed. Displayed requests may be outdated; retry before deciding.",
						),
					},
				]
			: []),
	]);
	const supportedTypes = firstPage?.supportedTypes ?? [];
	const itemIdsKey = items.map((item) => item.id).join("\u001f");
	const selectedIds =
		uiState.selectedIdDraft.itemIdsKey === itemIdsKey
			? uiState.selectedIdDraft.ids
			: new Set<string>();
	const decidableItems = items.filter(
		(item) => item.status === "pending" && isDecidableByViewer(item),
	);
	const fastLaneGroups = groupFastLaneItems(decidableItems);
	const sprintItems = sortSprintItems(decidableItems);
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
			ids: checked
				? new Set(
						items
							.filter((item) => !item.coveringFor && isSelectableForBulkDecision(item))
							.map((item) => item.id),
					)
				: new Set(),
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

	async function runBulkDecision(
		decision: BulkDecision,
		mutate: () => Promise<ApprovalInboxBulkDecisionResult>,
		closeRejectPanel = false,
	) {
		if (bulkActionInFlightRef.current) return;
		bulkActionInFlightRef.current = true;
		try {
			const result = await mutate();
			handleBulkDecisionToasts(t, result, decision);
			if (closeRejectPanel) dispatch({ type: "bulkRejectOpenChanged", open: false });
			dispatch({ type: "selectionCleared", itemIdsKey });
			refetch();
		} catch (error) {
			bulkActionInFlightRef.current = false;
			const fallback =
				decision === "approve"
					? t("approvals:approvals.bulkApproveRequestFailed", "Bulk approve failed")
					: t("approvals:approvals.bulkRejectRequestFailed", "Bulk reject failed");
			toast.error(getErrorMessage(error, fallback));
			return;
		}
		bulkActionInFlightRef.current = false;
	}

	const handleBulkApprove = async () => {
		if (selectedBulkApproveIds.length === 0) return;
		await runBulkDecision("approve", () => bulkApproveMutation.mutateAsync(selectedBulkApproveIds));
	};

	const handleBulkReject = async () => {
		const reason = uiState.bulkRejectReason.trim();
		if (!selectedBulkRejectIds.length || !reason) return;
		await runBulkDecision(
			"reject",
			() => bulkRejectMutation.mutateAsync({ approvalIds: selectedBulkRejectIds, reason }),
			true,
		);
	};

	const handleFastLaneApprove = async (approvalIds: string[], fastLane: ApprovalFastLaneReview) => {
		if (!approvalIds.length) return;
		await runBulkDecision("approve", () =>
			bulkApproveMutation.mutateAsync({ approvalIds, fastLane }),
		);
	};

	const handleFastLaneReject = async (
		approvalIds: string[],
		reason: string,
		fastLane: ApprovalFastLaneReview,
	) => {
		const trimmedReason = reason.trim();
		if (!approvalIds.length || !trimmedReason) return;
		await runBulkDecision("reject", () =>
			bulkRejectMutation.mutateAsync({ approvalIds, reason: trimmedReason, fastLane }),
		);
	};

	const isBulkActionPending = bulkApproveMutation.isPending || bulkRejectMutation.isPending;

	if (!hasHydrated || (isLoading && !data)) {
		return <ApprovalInboxLoadingState />;
	}

	if (isError && !data) {
		return (
			<ApprovalInboxErrorState
				t={t}
				error={error}
				isFetching={isFetching}
				onRefresh={() => refetch()}
			/>
		);
	}

	return (
		<ApprovalInboxPanels
			dispatch={dispatch}
			itemIdsKey={itemIdsKey}
			refetch={refetch}
			t={t}
			warnings={warnings}
			totalCount={totalCount}
			fastLaneGroups={fastLaneGroups}
			filters={uiState.filters}
			selectedCount={selectedIds.size}
			items={items}
			selectedIds={selectedIds}
			supportedTypes={supportedTypes}
			paginationState={{ hasNextPage: !!hasNextPage, isFetchingNextPage }}
			activityState={{ isBulkActionPending, isFetching }}
			bulkState={{
				isActionPending: isBulkActionPending,
				canApproveSelection: selectedBulkApproveIds.length > 0,
				canRejectSelection: selectedBulkRejectIds.length > 0,
				approvePending: bulkApproveMutation.isPending,
				rejectPending: bulkRejectMutation.isPending,
			}}
			panelState={{
				detailApproval: uiState.detailApproval,
				sprintOpen: uiState.sprintOpen,
				bulkRejectOpen: uiState.bulkRejectOpen,
				bulkRejectReason: uiState.bulkRejectReason,
			}}
			sprintItems={sprintItems}
			onBulkApprove={handleBulkApprove}
			onFastLaneApprove={handleFastLaneApprove}
			onFastLaneReject={handleFastLaneReject}
			onSelectAll={handleSelectAll}
			onSelectItem={handleSelectItem}
			onFetchNextPage={() => fetchNextPage()}
			onBulkReject={handleBulkReject}
			covering={firstPage?.covering}
		/>
	);
}

function ApprovalInboxNavigation() {
	const searchParams = useSearchParams();
	// A changed URL filter starts a fresh inbox, including back/forward and
	// unfiltered arrivals. Local edits survive renders at the same URL filter.
	return (
		<ApprovalInboxContent
			key={searchParams?.get("types") ?? ""}
			initialFilters={getInitialApprovalInboxFilters(searchParams)}
		/>
	);
}

/** The Approval inbox client view; `/approvals/inbox` renders it after its server guard. */
export function ApprovalInboxView() {
	return (
		<Suspense fallback={<ApprovalInboxLoadingState />}>
			<ApprovalInboxNavigation />
		</Suspense>
	);
}
