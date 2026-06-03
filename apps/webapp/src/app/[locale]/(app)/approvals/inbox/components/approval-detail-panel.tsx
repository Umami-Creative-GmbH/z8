"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import type { ApprovalInboxDetailSection, ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { useEmployeeClockStatuses } from "@/lib/query";
import {
	useApprovalDetail,
	useApproveApproval,
	useRejectApproval,
} from "@/lib/query/use-approval-inbox";
import { cn } from "@/lib/utils";

interface ApprovalDetailPanelProps {
	approval: ApprovalInboxItem | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onActioned: () => void;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
	return (
		<h4 className="mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
			{children}
		</h4>
	);
}

function renderDetailSection(section: ApprovalInboxDetailSection) {
	switch (section.type) {
		case "key_value":
			return (
				<section key={section.title}>
					<SectionTitle>{section.title}</SectionTitle>
					<div className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm">
						{section.rows.map((row) => (
							<div
								key={`${row.label}-${row.value}`}
								className="grid grid-cols-[minmax(0,1fr)_minmax(8rem,max-content)] items-start gap-4"
							>
								<span className="text-sm text-muted-foreground">{row.label}</span>
								<span
									className={cn(
										"min-w-0 text-right text-sm font-semibold text-foreground",
										row.tone === "warning" && "text-amber-600 dark:text-amber-400",
										row.tone === "danger" && "text-destructive",
									)}
								>
									{row.value}
								</span>
							</div>
						))}
					</div>
				</section>
			);
		case "text":
			return (
				<section key={section.title}>
					<SectionTitle>{section.title}</SectionTitle>
					<p className="rounded-xl border bg-card/60 p-4 text-sm leading-6 shadow-sm">
						{section.body}
					</p>
				</section>
			);
		case "timeline":
			return (
				<section key={section.title}>
					<SectionTitle>{section.title}</SectionTitle>
					<div className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm">
						{section.events.map((event) => (
							<div key={event.id} className="border-l-2 border-primary/30 pl-3">
								<p className="text-sm font-semibold">{event.label}</p>
								<p className="text-xs text-muted-foreground">
									{event.at}
									{event.actorName ? ` by ${event.actorName}` : ""}
								</p>
							</div>
						))}
					</div>
				</section>
			);
		case "callout":
			return (
				<section
					key={section.title}
					className={cn(
						"rounded-xl border p-4 shadow-sm",
						section.tone === "info" &&
							"border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20",
						section.tone === "warning" &&
							"border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20",
						section.tone === "danger" && "border-destructive/30 bg-destructive/5 text-destructive",
					)}
				>
					<h4 className="text-sm font-medium">{section.title}</h4>
					<p className="mt-1 text-sm leading-6 text-muted-foreground">{section.body}</p>
				</section>
			);
	}
}

export function ApprovalDetailPanel({
	approval,
	open,
	onOpenChange,
	onActioned,
}: ApprovalDetailPanelProps) {
	const { t } = useTranslate();
	const [isRejecting, setIsRejecting] = useState(false);
	const [rejectionReason, setRejectionReason] = useState("");

	const { data: detail } = useApprovalDetail(approval?.id ?? null);
	const approveMutation = useApproveApproval();
	const rejectMutation = useRejectApproval();
	const presence = useEmployeeClockStatuses(approval ? [approval.requester.id] : [], {
		polling: false,
	});
	const item = detail?.item ?? approval;
	const actions = detail?.actions ?? item?.capabilities;
	const sections = detail?.sections ?? [];
	const isPending = approveMutation.isPending || rejectMutation.isPending;

	const handleApprove = async () => {
		if (!approval || !actions?.canApprove || isPending) return;

		const result = await approveMutation.mutateAsync(approval.id);
		if (result.success) {
			toast.success(t("approvals:approvals.approved", "Request approved"));
			onOpenChange(false);
			onActioned();
		} else {
			toast.error(result.error || t("approvals:approvals.approveFailed", "Failed to approve"));
		}
	};

	const handleReject = async () => {
		if (!approval || !actions?.canReject || !rejectionReason.trim() || isPending) return;

		const result = await rejectMutation.mutateAsync({
			approvalId: approval.id,
			reason: rejectionReason.trim(),
		});
		if (result.success) {
			toast.success(t("approvals:approvals.rejected", "Request rejected"));
			setIsRejecting(false);
			setRejectionReason("");
			onOpenChange(false);
			onActioned();
		} else {
			toast.error(result.error || t("approvals:approvals.rejectFailed", "Failed to reject"));
		}
	};

	const handleClose = () => {
		setIsRejecting(false);
		setRejectionReason("");
		onOpenChange(false);
	};

	if (!approval) return null;

	const panelItem = item ?? approval;
	const panelActions = actions ?? panelItem.capabilities;

	return (
		<Sheet open={open} onOpenChange={handleClose}>
			<SheetContent className="w-[min(100vw,560px)] gap-0 overflow-hidden p-0 sm:max-w-[560px]">
				<SheetHeader className="border-b px-5 py-5 pr-12 sm:px-6">
					<div className="flex items-start gap-3">
						<div className="min-w-0 flex-1">
							<SheetTitle>{t("approvals:approvals.detailTitle", "Approval details")}</SheetTitle>
							<SheetDescription className="mt-1 line-clamp-2">
								{panelItem.summary.detail}
							</SheetDescription>
						</div>
						{panelItem.summary.badge && (
							<Badge
								className="mt-0.5 max-w-[10rem] shrink-0 truncate sm:max-w-[13rem]"
								variant="secondary"
								title={panelItem.summary.badge.label}
								style={
									panelItem.summary.badge.color
										? { backgroundColor: panelItem.summary.badge.color }
										: undefined
								}
							>
								{panelItem.summary.badge.label}
							</Badge>
						)}
					</div>
				</SheetHeader>

				<div
					data-slot="approval-detail-body"
					className="flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6"
				>
					<div>
						<SectionTitle>{t("approvals:approvals.requester", "Requester")}</SectionTitle>
						<div className="flex items-center gap-3 rounded-xl border bg-card/60 p-4 shadow-sm">
							<UserAvatar
								image={panelItem.requester.image}
								seed={panelItem.requester.id}
								name={panelItem.requester.name}
								size="md"
								clockStatus={presence.getStatus(panelItem.requester.id)}
							/>
							<div className="min-w-0">
								<div className="truncate font-semibold">{panelItem.requester.name}</div>
								<div className="truncate text-sm text-muted-foreground">
									{panelItem.requester.email}
								</div>
							</div>
						</div>
					</div>

					{sections.length > 0 && <Separator />}

					{sections.map(renderDetailSection)}
				</div>

				<SheetFooter className="border-t bg-muted/95 px-5 py-4 sm:px-6">
					{isRejecting ? (
						<div className="w-full space-y-4">
							<div>
								<label className="text-sm font-medium" htmlFor="rejection-reason">
									{t("approvals:approvals.rejectionReason", "Reason for rejection")}
								</label>
								<Textarea
									id="rejection-reason"
									value={rejectionReason}
									onChange={(e) => setRejectionReason(e.target.value)}
									placeholder={t(
										"approvals:approvals.rejectionReasonPlaceholder",
										"Please provide a reason for rejecting this request…",
									)}
									className="mt-2"
									rows={3}
								/>
							</div>
							<div className="flex gap-2">
								<Button
									variant="outline"
									onClick={() => {
										setIsRejecting(false);
										setRejectionReason("");
									}}
									disabled={isPending}
								>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button
									variant="destructive"
									onClick={handleReject}
									disabled={!actions?.canReject || !rejectionReason.trim() || isPending}
								>
									{rejectMutation.isPending && (
										<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
									)}
									<IconX className="mr-2 size-4" aria-hidden="true" />
									{t("approvals:approvals.confirmReject", "Confirm Rejection")}
								</Button>
							</div>
						</div>
					) : (
						<div className="flex w-full gap-2">
							<Button
								variant="outline"
								className="flex-1"
								onClick={() => setIsRejecting(true)}
								disabled={!panelActions.canReject || isPending}
							>
								<IconX className="mr-2 size-4" aria-hidden="true" />
								{t("approvals:approvals.reject", "Reject")}
							</Button>
							<Button
								className="flex-1"
								onClick={handleApprove}
								disabled={!panelActions.canApprove || isPending}
							>
								{approveMutation.isPending && (
									<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
								)}
								<IconCheck className="mr-2 size-4" aria-hidden="true" />
								{t("approvals:approvals.approve", "Approve")}
							</Button>
						</div>
					)}
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
