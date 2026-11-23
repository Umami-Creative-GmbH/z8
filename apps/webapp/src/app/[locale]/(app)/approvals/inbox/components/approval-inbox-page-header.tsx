"use client";

import { IconCheck, IconInbox, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import type { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";

export type ApprovalInboxHeaderBulkState = {
	isActionPending: boolean;
	canApproveSelection: boolean;
	canRejectSelection: boolean;
	approvePending: boolean;
};

export function ApprovalInboxPageHeader({
	t,
	bulkState,
	isFetching,
	selectedCount,
	sprintItemCount,
	onBulkApprove,
	onOpenBulkReject,
	onOpenSprint,
	onRefresh,
}: {
	t: ReturnType<typeof useTranslate>["t"];
	bulkState: ApprovalInboxHeaderBulkState;
	isFetching: boolean;
	selectedCount: number;
	sprintItemCount: number;
	onBulkApprove: () => void;
	onOpenBulkReject: () => void;
	onOpenSprint: () => void;
	onRefresh: () => void;
}) {
	return (
		// Stacks and wraps on phones so the bulk actions stay on screen (#846).
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<h1 className="break-words text-2xl font-semibold tracking-tight">
					{t("approvals:approvals.inbox", "Approval Inbox")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"approvals:approvals.inboxDescription",
						"Review and approve pending requests from your team",
					)}
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
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
						<Button
							onClick={onBulkApprove}
							disabled={bulkState.isActionPending || !bulkState.canApproveSelection}
						>
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
				<Button variant="ghost" size="icon" onClick={onRefresh} disabled={isFetching}>
					{isFetching ? (
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
