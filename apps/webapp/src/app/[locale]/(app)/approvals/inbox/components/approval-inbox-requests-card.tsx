"use client";

import { IconAlertTriangle, IconInbox, IconLoader2, IconUserShare } from "@tabler/icons-react";
import type { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApprovalFastLaneReview } from "@/lib/approvals/inbox/fast-lane-review";
import type {
	ApprovalInboxCoveringSection,
	ApprovalInboxItem,
	ApprovalInboxType,
	ApprovalInboxWarning,
} from "@/lib/approvals/inbox/types";
import type { ApprovalInboxFilters } from "@/lib/query/use-approval-inbox";
import { type ApprovalInboxFastLaneGroupView, isDecidableByViewer } from "../approval-inbox-items";
import { ApprovalFastLanes } from "./approval-fast-lanes";
import { ApprovalInboxTable } from "./approval-inbox-table";
import { ApprovalInboxToolbar } from "./approval-inbox-toolbar";
import { getCoveringForDescription, getCoveringForTitle } from "./covering-notes";

type Translate = ReturnType<typeof useTranslate>["t"];

export type ApprovalInboxPaginationState = {
	hasNextPage: boolean;
	isFetchingNextPage: boolean;
};

export type ApprovalInboxRequestActivityState = {
	isBulkActionPending: boolean;
	isFetching: boolean;
};

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

/**
 * The cover start summary links to a "Covering for" section (#1018). Sections
 * arrive after the page loaded, so the linked one scrolls into view on mount.
 */
function scrollToLinkedSection(node: HTMLDivElement | null) {
	if (node && window.location.hash === `#${node.id}`) node.scrollIntoView({ block: "start" });
}

type ApprovalInboxTableBinding = {
	selectedIds: Set<string>;
	onSelectItem: (id: string, checked: boolean) => void;
	onRowClick: (approval: ApprovalInboxItem) => void;
	isFetching: boolean;
	filtered: boolean;
};

/** One "Covering for" section per absent approver the viewer covers for (#1016). */
function ApprovalInboxCoveringSectionCard({
	t,
	section,
	table,
}: {
	t: Translate;
	section: ApprovalInboxCoveringSection;
	table: ApprovalInboxTableBinding;
}) {
	return (
		<Card
			// The cover start summary links here (#1018).
			id={`covering-${section.approverId}`}
			ref={scrollToLinkedSection}
			className="scroll-mt-20"
			data-testid="approval-covering-section"
		>
			<CardHeader className="pb-0">
				<CardTitle className="flex flex-wrap items-center gap-2">
					<IconUserShare className="size-5" aria-hidden="true" />
					{getCoveringForTitle(t, section.approverName)}
					<span className="text-sm font-normal text-muted-foreground">({section.count})</span>
				</CardTitle>
				<CardDescription>{getCoveringForDescription(t, section.approverName)}</CardDescription>
			</CardHeader>
			<CardContent className="pt-4">
				<ApprovalInboxTable items={section.rows} {...table} />
				{section.hasMore && (
					<p className="mt-3 text-sm text-muted-foreground">
						{t(
							"approvals:approvals.coveringForShowingFirst",
							"Showing the first {shown} of {count}.",
							{
								shown: section.rows.length,
								count: section.count,
							},
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

export function ApprovalInboxRequestsCard({
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
	covering,
}: {
	t: Translate;
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
	onBulkApprove: (approvalIds: string[], review: ApprovalFastLaneReview) => Promise<void>;
	onBulkReject: (
		approvalIds: string[],
		reason: string,
		review: ApprovalFastLaneReview,
	) => Promise<void>;
	onFiltersChange: (nextFilters: ApprovalInboxFilters) => void;
	onSelectAll: (checked: boolean) => void;
	onSelectItem: (id: string, checked: boolean) => void;
	onRowClick: (approval: ApprovalInboxItem) => void;
	onFetchNextPage: () => void;
	covering?: ApprovalInboxCoveringSection[];
}) {
	const ownItems = items.filter((item) => !item.coveringFor);
	const selectableCount = ownItems.filter(isDecidableByViewer).length;
	const table: ApprovalInboxTableBinding = {
		selectedIds,
		onSelectItem,
		onRowClick,
		isFetching: activityState.isFetching,
		filtered: !!filters.search || !!filters.types?.length,
	};

	return (
		<div className="flex flex-col gap-6">
			<ApprovalInboxWarnings warnings={warnings} />
			<Card>
				<CardHeader className="pb-0">
					<CardTitle className="flex flex-wrap items-center gap-2">
						<IconInbox className="size-5" aria-hidden="true" />
						{t("approvals:approvals.pendingRequests", "Pending Requests")}
						<span className="rounded-md bg-primary/10 px-2 py-1 text-sm font-semibold tabular-nums text-primary">
							{totalCount}
						</span>
					</CardTitle>
					<CardDescription>
						{t(
							"approvals:approvals.pendingRequestsDescription",
							"Select requests to approve in bulk, or click a row for details",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="pt-4">
					<div className="border-b pb-4">
						<ApprovalInboxToolbar
							filters={filters}
							onFiltersChange={onFiltersChange}
							selectedCount={selectedCount}
							totalCount={totalCount}
							allSelected={selectableCount > 0 && selectedCount === selectableCount}
							onSelectAll={onSelectAll}
							supportedTypes={supportedTypes}
						/>
					</div>
					<div className="mt-4">
						<ApprovalInboxTable items={ownItems} {...table} />
					</div>
					{paginationState.hasNextPage && (
						<div className="mt-4 flex justify-center">
							<Button
								variant="outline"
								onClick={onFetchNextPage}
								disabled={paginationState.isFetchingNextPage}
							>
								{paginationState.isFetchingNextPage ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								) : null}
								{t("common.loadMore", "Load More")}
							</Button>
						</div>
					)}
				</CardContent>
			</Card>
			<ApprovalFastLanes
				groups={fastLaneGroups}
				isBusy={activityState.isBulkActionPending}
				onBulkApprove={onBulkApprove}
				onBulkReject={onBulkReject}
			/>
			{covering?.map((section) => (
				<ApprovalInboxCoveringSectionCard
					key={section.approverId}
					t={t}
					section={section}
					table={table}
				/>
			))}
		</div>
	);
}
