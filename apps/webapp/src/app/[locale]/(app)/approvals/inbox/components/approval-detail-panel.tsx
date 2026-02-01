"use client";

import { useState } from "react";
import {
	IconCalendarOff,
	IconCheck,
	IconClockEdit,
	IconExchange,
	IconLoader2,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { formatRelative, format } from "@/lib/datetime/luxon-utils";
import { toast } from "sonner";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/user-avatar";
import { useApprovalDetail, useApproveApproval, useRejectApproval } from "@/lib/query/use-approval-inbox";
import type { ApprovalType, UnifiedApprovalItem } from "@/lib/approvals/domain/types";
import { cn } from "@/lib/utils";

interface ApprovalDetailPanelProps {
	approval: UnifiedApprovalItem | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onActioned: () => void;
}

// Icon mapping for approval types
const TYPE_ICONS: Record<ApprovalType, React.ComponentType<{ className?: string }>> = {
	absence_entry: IconCalendarOff,
	time_entry: IconClockEdit,
	shift_request: IconExchange,
};

// Priority badge variants
const PRIORITY_VARIANTS: Record<string, "destructive" | "outline" | "default" | "secondary"> = {
	urgent: "destructive",
	high: "outline",
	normal: "default",
	low: "secondary",
};

export function ApprovalDetailPanel({
	approval,
	open,
	onOpenChange,
	onActioned,
}: ApprovalDetailPanelProps) {
	const { t } = useTranslate();
	const [isRejecting, setIsRejecting] = useState(false);
	const [rejectionReason, setRejectionReason] = useState("");

	const { data: detail, isLoading } = useApprovalDetail(approval?.id ?? null);
	const approveMutation = useApproveApproval();
	const rejectMutation = useRejectApproval();

	const handleApprove = async () => {
		if (!approval) return;

		const result = await approveMutation.mutateAsync(approval.id);
		if (result.success) {
			toast.success(t("approvals.approved", "Request approved"));
			onOpenChange(false);
			onActioned();
		} else {
			toast.error(result.error || t("approvals.approveFailed", "Failed to approve"));
		}
	};

	const handleReject = async () => {
		if (!approval || !rejectionReason.trim()) return;

		const result = await rejectMutation.mutateAsync({
			approvalId: approval.id,
			reason: rejectionReason.trim(),
		});
		if (result.success) {
			toast.success(t("approvals.rejected", "Request rejected"));
			setIsRejecting(false);
			setRejectionReason("");
			onOpenChange(false);
			onActioned();
		} else {
			toast.error(result.error || t("approvals.rejectFailed", "Failed to reject"));
		}
	};

	const handleClose = () => {
		setIsRejecting(false);
		setRejectionReason("");
		onOpenChange(false);
	};

	if (!approval) return null;

	const TypeIcon = TYPE_ICONS[approval.approvalType] || IconClockEdit;
	const isPending = approveMutation.isPending || rejectMutation.isPending;

	return (
		<Sheet open={open} onOpenChange={handleClose}>
			<SheetContent className="w-[500px] sm:max-w-[500px] overflow-y-auto overscroll-behavior-contain">
				<SheetHeader>
					<div className="flex items-center gap-2">
						<TypeIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
						<SheetTitle>{approval.typeName}</SheetTitle>
					</div>
					<SheetDescription>{approval.display.summary}</SheetDescription>
				</SheetHeader>

				<div className="mt-6 space-y-6">
					{/* Requester info */}
					<div>
						<h4 className="text-sm font-medium text-muted-foreground mb-2">
							{t("approvals.requester", "Requester")}
						</h4>
						<div className="flex items-center gap-3">
							<UserAvatar
								image={approval.requester.image}
								seed={approval.requester.userId}
								name={approval.requester.name}
								size="md"
							/>
							<div>
								<div className="font-medium">{approval.requester.name}</div>
								<div className="text-sm text-muted-foreground">{approval.requester.email}</div>
							</div>
						</div>
					</div>

					<Separator />

					{/* Request details */}
					<div>
						<h4 className="text-sm font-medium text-muted-foreground mb-2">
							{t("approvals.details", "Details")}
						</h4>
						<div className="space-y-3">
							<div className="flex justify-between">
								<span className="text-sm text-muted-foreground">
									{t("approvals.type", "Type")}
								</span>
								<span className="text-sm font-medium">{approval.display.title}</span>
							</div>
							{approval.display.badge && (
								<div className="flex justify-between items-center">
									<span className="text-sm text-muted-foreground">
										{t("approvals.category", "Category")}
									</span>
									<Badge
										style={
											approval.display.badge.color
												? { backgroundColor: approval.display.badge.color }
												: undefined
										}
									>
										{approval.display.badge.label}
									</Badge>
								</div>
							)}
							<div className="flex justify-between">
								<span className="text-sm text-muted-foreground">
									{t("approvals.dates", "Dates")}
								</span>
								<span className="text-sm font-medium">{approval.display.subtitle}</span>
							</div>
						</div>
					</div>

					<Separator />

					{/* Status info */}
					<div>
						<h4 className="text-sm font-medium text-muted-foreground mb-2">
							{t("approvals.status", "Status")}
						</h4>
						<div className="space-y-3">
							<div className="flex justify-between items-center">
								<span className="text-sm text-muted-foreground">
									{t("approvals.priority", "Priority")}
								</span>
								<Badge variant={PRIORITY_VARIANTS[approval.priority]}>
									{t(`approvals.priorities.${approval.priority}`, approval.priority)}
								</Badge>
							</div>
							<div className="flex justify-between">
								<span className="text-sm text-muted-foreground">
									{t("approvals.requested", "Requested")}
								</span>
								<span className="text-sm">
									{format(approval.createdAt, "PPp")}
									<span className="text-muted-foreground ml-1">
										({formatRelative(approval.createdAt)})
									</span>
								</span>
							</div>
							{approval.sla.deadline && (
								<div className="flex justify-between">
									<span className="text-sm text-muted-foreground">
										{t("approvals.slaDeadline", "SLA Deadline")}
									</span>
									<span
										className={cn(
											"text-sm",
											approval.sla.status === "overdue" && "text-destructive",
											approval.sla.status === "approaching" && "text-amber-500",
										)}
									>
										{format(approval.sla.deadline, "PPp")}
									</span>
								</div>
							)}
						</div>
					</div>

					{/* Timeline */}
					{detail?.timeline && detail.timeline.length > 0 && (
						<>
							<Separator />
							<div>
								<h4 className="text-sm font-medium text-muted-foreground mb-2">
									{t("approvals.timeline", "Timeline")}
								</h4>
								<div className="space-y-3">
									{detail.timeline.map((event) => (
										<div key={event.id} className="flex gap-3">
											{event.performedBy && (
												<UserAvatar
													image={event.performedBy.image}
													seed={event.performedBy.name}
													name={event.performedBy.name}
													size="sm"
												/>
											)}
											<div className="flex-1 min-w-0">
												<p className="text-sm">{event.message}</p>
												<p className="text-xs text-muted-foreground">
													{format(event.timestamp, "PPp")}
												</p>
											</div>
										</div>
									))}
								</div>
							</div>
						</>
					)}
				</div>

				<SheetFooter className="mt-8">
					{isRejecting ? (
						<div className="w-full space-y-4">
							<div>
								<label className="text-sm font-medium" htmlFor="rejection-reason">
									{t("approvals.rejectionReason", "Reason for rejection")}
								</label>
								<Textarea
									id="rejection-reason"
									value={rejectionReason}
									onChange={(e) => setRejectionReason(e.target.value)}
									placeholder={t(
										"approvals.rejectionReasonPlaceholder",
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
									disabled={!rejectionReason.trim() || isPending}
								>
									{rejectMutation.isPending && (
										<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
									)}
									<IconX className="mr-2 h-4 w-4" aria-hidden="true" />
									{t("approvals.confirmReject", "Confirm Rejection")}
								</Button>
							</div>
						</div>
					) : (
						<div className="flex w-full gap-2">
							<Button variant="outline" className="flex-1" onClick={() => setIsRejecting(true)} disabled={isPending}>
								<IconX className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("approvals.reject", "Reject")}
							</Button>
							<Button className="flex-1" onClick={handleApprove} disabled={isPending}>
								{approveMutation.isPending && (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								)}
								<IconCheck className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("approvals.approve", "Approve")}
							</Button>
						</div>
					)}
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
