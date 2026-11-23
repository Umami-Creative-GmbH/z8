"use client";

import { IconInbox } from "@tabler/icons-react";
import type { useTranslate } from "@tolgee/react";
import { Card, CardContent } from "@/components/ui/card";
import { getErrorMessage } from "../approval-inbox-items";
import { ApprovalInboxPageHeader } from "./approval-inbox-page-header";

const IDLE_BULK_STATE = {
	isActionPending: false,
	canApproveSelection: false,
	canRejectSelection: false,
	approvePending: false,
};

function noop() {}

export function ApprovalInboxErrorState({
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
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			<ApprovalInboxPageHeader
				t={t}
				bulkState={IDLE_BULK_STATE}
				isFetching={isFetching}
				selectedCount={0}
				sprintItemCount={0}
				onBulkApprove={noop}
				onOpenBulkReject={noop}
				onOpenSprint={noop}
				onRefresh={onRefresh}
			/>
			<div>
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
