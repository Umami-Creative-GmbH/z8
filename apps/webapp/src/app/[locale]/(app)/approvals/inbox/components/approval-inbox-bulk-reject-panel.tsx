"use client";

import type { useTranslate } from "@tolgee/react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { ApprovalReasonForm } from "./approval-reason-form";

export function ApprovalInboxBulkRejectPanel({
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
		<ActionPanel
			open={open}
			onOpenChange={(next) => {
				if (!isPending) onOpenChange(next);
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
				<ActionPanelBody>
					{open && (
						<ApprovalReasonForm
							reason={reason}
							onReasonChange={onReasonChange}
							onCancel={() => onOpenChange(false)}
							onConfirm={onReject}
							canReject={canBulkRejectSelection}
							isPending={isPending}
						/>
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
