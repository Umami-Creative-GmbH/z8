"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { TriagedApprovalItem } from "@/lib/approvals/triage";
import { useApproveApproval, useRejectApproval } from "@/lib/query/use-approval-inbox";
import { ApprovalSprintCard } from "./approval-sprint-card";

interface ApprovalSprintPanelProps {
	open: boolean;
	items: TriagedApprovalItem[];
	onOpenChange: (open: boolean) => void;
	onActioned: () => void;
	onOpenDetails?: (item: TriagedApprovalItem) => void;
	shortcutsEnabled?: boolean;
}

export function ApprovalSprintPanel({
	open,
	items,
	onOpenChange,
	onActioned,
	onOpenDetails,
	shortcutsEnabled = true,
}: ApprovalSprintPanelProps) {
	const { t } = useTranslate();
	const approveMutation = useApproveApproval();
	const rejectMutation = useRejectApproval();
	const [currentIndex, setCurrentIndex] = useState(0);
	const [isRejecting, setIsRejecting] = useState(false);
	const [rejectReason, setRejectReason] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [dismissedApprovalIds, setDismissedApprovalIds] = useState<string[]>([]);
	const [previousOpen, setPreviousOpen] = useState(open);
	const submittingApprovalRef = useRef<string | null>(null);
	const shortcutStateRef = useRef({
		isBusy: false,
		handleApprove: async () => {},
		advance: () => {},
	});
	const visibleItems = items.filter((item) => !dismissedApprovalIds.includes(item.id));
	const visibleItemCount = visibleItems.length;
	const boundedCurrentIndex =
		visibleItemCount === 0 ? 0 : Math.min(currentIndex, visibleItemCount - 1);
	const currentItem = visibleItems[boundedCurrentIndex];
	const currentItemId = currentItem?.id;
	const isBusy = isSubmitting || approveMutation.isPending || rejectMutation.isPending;
	const trimmedRejectReason = rejectReason.trim();

	if (previousOpen !== open) {
		setPreviousOpen(open);
		if (open) {
			setCurrentIndex(0);
			setIsRejecting(false);
			setRejectReason("");
			setDismissedApprovalIds([]);
		}
	}

	const advance = () => {
		setIsRejecting(false);
		setRejectReason("");
		setCurrentIndex((index) => index + 1);
	};

	const handleApprove = async () => {
		if (!currentItemId || isBusy) return;
		if (submittingApprovalRef.current === currentItemId) return;

		submittingApprovalRef.current = currentItemId;
		setIsSubmitting(true);
		try {
			const result = await approveMutation.mutateAsync(currentItemId);
			if (result.success) {
				toast.success(t("approvals:approvals.approved", "Request approved"));
				setIsRejecting(false);
				setRejectReason("");
				submittingApprovalRef.current = null;
				setIsSubmitting(false);
				setDismissedApprovalIds((approvalIds) => [...approvalIds, currentItemId]);
				onActioned();
				return;
			} else {
				toast.error(result.error || t("approvals:approvals.approveFailed", "Failed to approve"));
			}
		} catch (_error) {
			toast.error(t("approvals:approvals.approveFailed", "Failed to approve"));
		}

		submittingApprovalRef.current = null;
		setIsSubmitting(false);
	};

	const handleReject = async () => {
		if (!currentItem || isBusy || !trimmedRejectReason) return;
		if (submittingApprovalRef.current === currentItem.id) return;

		submittingApprovalRef.current = currentItem.id;
		setIsSubmitting(true);
		try {
			const result = await rejectMutation.mutateAsync({
				approvalId: currentItem.id,
				reason: trimmedRejectReason,
			});
			if (result.success) {
				toast.success(t("approvals:approvals.rejected", "Request rejected"));
				setIsRejecting(false);
				setRejectReason("");
				setDismissedApprovalIds((approvalIds) => [...approvalIds, currentItem.id]);
				onActioned();
			} else {
				toast.error(result.error || t("approvals:approvals.rejectFailed", "Failed to reject"));
			}
		} catch (_error) {
			toast.error(t("approvals:approvals.rejectFailed", "Failed to reject"));
		}

		submittingApprovalRef.current = null;
		setIsSubmitting(false);
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setIsRejecting(false);
			setRejectReason("");
		}
		onOpenChange(nextOpen);
	};

	useEffect(() => {
		shortcutStateRef.current = { isBusy, handleApprove, advance };
	});

	useEffect(() => {
		if (!open || isRejecting || !shortcutsEnabled) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			if (isEditableShortcutTarget(event.target)) return;

			const shortcutState = shortcutStateRef.current;
			if (shortcutState.isBusy) return;

			if (event.key === "a") {
				event.preventDefault();
				void shortcutState.handleApprove();
			} else if (event.key === "r") {
				event.preventDefault();
				setIsRejecting(true);
			} else if (event.key === "s" || event.key === "n") {
				event.preventDefault();
				shortcutState.advance();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [open, isRejecting, shortcutsEnabled]);

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto overscroll-contain sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t("approvals:sprint.title", "Approval sprint")}</DialogTitle>
					<DialogDescription>
						{t(
							"approvals:sprint.description",
							"Review pending approvals one at a time with keyboard shortcuts.",
						)}
					</DialogDescription>
				</DialogHeader>

				{currentItem ? (
					<div className="space-y-4">
						<div className="text-muted-foreground text-sm">
							{t(
								"approvals:sprint.progress",
								boundedCurrentIndex + 1 + " of " + visibleItems.length,
								{
									current: boundedCurrentIndex + 1,
									total: visibleItems.length,
								},
							)}
						</div>
						<ApprovalSprintCard
							item={currentItem}
							isBusy={isBusy}
							onApprove={handleApprove}
							onReject={() => setIsRejecting(true)}
							onSkip={advance}
							onOpenDetails={() => onOpenDetails?.(currentItem)}
						/>

						{isRejecting ? (
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<label className="font-medium text-sm" htmlFor="sprint-reject-reason">
									{t("approvals:sprint.rejectReason", "Sprint reject reason")}
								</label>
								<Textarea
									id="sprint-reject-reason"
									name="sprint-reject-reason"
									autoComplete="off"
									value={rejectReason}
									onChange={(event) => setRejectReason(event.target.value)}
									disabled={isBusy}
								/>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="destructive"
										onClick={handleReject}
										disabled={isBusy || trimmedRejectReason.length === 0}
									>
										{isBusy ? <IconLoader2 className="animate-spin" aria-hidden="true" /> : null}
										{t("approvals:sprint.confirmReject", "Confirm reject")}
									</Button>
									<Button
										type="button"
										variant="outline"
										onClick={() => {
											setIsRejecting(false);
											setRejectReason("");
										}}
										disabled={isBusy}
									>
										{t("common.cancel", "Cancel")}
									</Button>
								</div>
							</div>
						) : null}
					</div>
				) : (
					<div className="rounded-lg border bg-muted/30 p-8 text-center font-medium">
						{t("approvals:sprint.complete", "Sprint complete")}
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return (
		target.matches("input, textarea, select") ||
		target.isContentEditable ||
		target.closest("[contenteditable='true']") !== null
	);
}
