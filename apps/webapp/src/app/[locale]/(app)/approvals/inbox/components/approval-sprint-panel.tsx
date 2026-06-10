"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useReducer, useRef } from "react";
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
import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";
import { useApproveApproval, useRejectApproval } from "@/lib/query/use-approval-inbox";
import { ApprovalSprintCard } from "./approval-sprint-card";

interface ApprovalSprintPanelProps {
	open: boolean;
	items: ApprovalInboxItem[];
	onOpenChange: (open: boolean) => void;
	onActioned: () => void;
	onOpenDetails?: (item: ApprovalInboxItem) => void;
	shortcutsEnabled?: boolean;
}

type ApprovalSprintState = {
	currentIndex: number;
	isRejecting: boolean;
	rejectReason: string;
	isSubmitting: boolean;
	dismissedApprovalIds: string[];
	previousOpen: boolean;
};

type ApprovalSprintAction =
	| { type: "openChanged"; open: boolean }
	| { type: "advance" }
	| { type: "rejectModeChanged"; isRejecting: boolean }
	| { type: "rejectReasonChanged"; rejectReason: string }
	| { type: "submissionStarted" }
	| { type: "submissionFinished" }
	| { type: "approveSucceeded"; approvalId: string }
	| { type: "rejectSucceeded"; approvalId: string }
	| { type: "closed" };

function approvalSprintReducer(
	state: ApprovalSprintState,
	action: ApprovalSprintAction,
): ApprovalSprintState {
	switch (action.type) {
		case "openChanged":
			return action.open
				? {
						...state,
						previousOpen: action.open,
						currentIndex: 0,
						isRejecting: false,
						rejectReason: "",
						dismissedApprovalIds: [],
					}
				: { ...state, previousOpen: action.open };
		case "advance":
			return {
				...state,
				currentIndex: state.currentIndex + 1,
				isRejecting: false,
				rejectReason: "",
			};
		case "rejectModeChanged":
			return { ...state, isRejecting: action.isRejecting };
		case "rejectReasonChanged":
			return { ...state, rejectReason: action.rejectReason };
		case "submissionStarted":
			return { ...state, isSubmitting: true };
		case "submissionFinished":
			return { ...state, isSubmitting: false };
		case "approveSucceeded":
			return {
				...state,
				isRejecting: false,
				rejectReason: "",
				isSubmitting: false,
				dismissedApprovalIds: [...state.dismissedApprovalIds, action.approvalId],
			};
		case "rejectSucceeded":
			return {
				...state,
				isRejecting: false,
				rejectReason: "",
				isSubmitting: false,
				dismissedApprovalIds: [...state.dismissedApprovalIds, action.approvalId],
			};
		case "closed":
			return { ...state, isRejecting: false, rejectReason: "" };
	}
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
	const [sprintState, dispatchSprint] = useReducer(approvalSprintReducer, {
		currentIndex: 0,
		isRejecting: false,
		rejectReason: "",
		isSubmitting: false,
		dismissedApprovalIds: [],
		previousOpen: open,
	});
	const {
		currentIndex,
		isRejecting,
		rejectReason,
		isSubmitting,
		dismissedApprovalIds,
		previousOpen,
	} = sprintState;
	const submittingApprovalRef = useRef<string | null>(null);
	const shortcutStateRef = useRef({
		isBusy: false,
		canReject: false,
		handleApprove: async () => {},
		handleReject: async () => {},
		isRejecting: false,
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
	const canApproveCurrentItem = currentItem?.capabilities.canApprove === true;
	const canRejectCurrentItem = currentItem?.capabilities.canReject === true;

	if (previousOpen !== open) {
		dispatchSprint({ type: "openChanged", open });
	}

	const advance = () => {
		dispatchSprint({ type: "advance" });
	};

	const handleApprove = async () => {
		if (!currentItemId || isBusy || !canApproveCurrentItem) return;
		if (submittingApprovalRef.current === currentItemId) return;

		submittingApprovalRef.current = currentItemId;
		dispatchSprint({ type: "submissionStarted" });
		try {
			const result = await approveMutation.mutateAsync(currentItemId);
			if (result.success) {
				toast.success(t("approvals:approvals.approved", "Request approved"));
				submittingApprovalRef.current = null;
				dispatchSprint({ type: "approveSucceeded", approvalId: currentItemId });
				onActioned();
				return;
			} else {
				toast.error(result.error || t("approvals:approvals.approveFailed", "Failed to approve"));
			}
		} catch (_error) {
			toast.error(t("approvals:approvals.approveFailed", "Failed to approve"));
		}

		submittingApprovalRef.current = null;
		dispatchSprint({ type: "submissionFinished" });
	};

	const handleReject = async () => {
		if (!currentItem || isBusy || !currentItem.capabilities.canReject || !trimmedRejectReason)
			return;
		if (submittingApprovalRef.current === currentItem.id) return;

		submittingApprovalRef.current = currentItem.id;
		dispatchSprint({ type: "submissionStarted" });
		try {
			const result = await rejectMutation.mutateAsync({
				approvalId: currentItem.id,
				reason: trimmedRejectReason,
			});
			if (result.success) {
				toast.success(t("approvals:approvals.rejected", "Request rejected"));
				dispatchSprint({ type: "rejectSucceeded", approvalId: currentItem.id });
				onActioned();
			} else {
				toast.error(result.error || t("approvals:approvals.rejectFailed", "Failed to reject"));
			}
		} catch (_error) {
			toast.error(t("approvals:approvals.rejectFailed", "Failed to reject"));
		}

		submittingApprovalRef.current = null;
		dispatchSprint({ type: "submissionFinished" });
	};

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			dispatchSprint({ type: "closed" });
		}
		onOpenChange(nextOpen);
	};

	useEffect(() => {
		shortcutStateRef.current = {
			isBusy,
			canReject: canRejectCurrentItem,
			handleApprove,
			handleReject,
			isRejecting,
			advance,
		};
	});

	useEffect(() => {
		if (!open || !shortcutsEnabled) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			if (isTextInputActive() || isTextInputTarget(event.target)) return;

			const shortcutState = shortcutStateRef.current;
			if (shortcutState.isBusy) return;

			if (event.key === "a") {
				event.preventDefault();
				if (!shortcutState.isRejecting) {
					void shortcutState.handleApprove();
				}
			} else if (event.key === "r") {
				event.preventDefault();
				if (!shortcutState.canReject) return;
				if (shortcutState.isRejecting) {
					void shortcutState.handleReject();
				} else {
					dispatchSprint({ type: "rejectModeChanged", isRejecting: true });
				}
			} else if (event.key === "s" || event.key === "n") {
				event.preventDefault();
				if (!shortcutState.isRejecting) {
					shortcutState.advance();
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [open, shortcutsEnabled]);

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
							{t("approvals:sprint.progress", "{current} of {total}", {
								current: boundedCurrentIndex + 1,
								total: visibleItems.length,
							})}
						</div>
						<ApprovalSprintCard
							item={currentItem}
							isBusy={isBusy}
							onApprove={handleApprove}
							onReject={() => {
					if (currentItem.capabilities.canReject) {
						dispatchSprint({ type: "rejectModeChanged", isRejecting: true });
					}
							}}
							onSkip={advance}
							onOpenDetails={() => onOpenDetails?.(currentItem)}
						/>

						{isRejecting ? (
							<div className="space-y-3 rounded-lg border bg-muted/30 p-4">
								<label className="font-medium text-sm" htmlFor="sprint-reject-reason">
									{t("approvals:sprint.rejectReason", "Reason for rejection")}
								</label>
								<Textarea
									id="sprint-reject-reason"
									name="sprint-reject-reason"
									autoComplete="off"
					value={rejectReason}
					onChange={(event) =>
						dispatchSprint({ type: "rejectReasonChanged", rejectReason: event.target.value })
					}
									disabled={isBusy}
								/>
								<div className="flex flex-wrap gap-2">
									<Button
										type="button"
										variant="destructive"
										onClick={handleReject}
										disabled={
											isBusy ||
											!currentItem.capabilities.canReject ||
											trimmedRejectReason.length === 0
										}
									>
										{isBusy ? <IconLoader2 className="animate-spin" aria-hidden="true" /> : null}
										{t("approvals:sprint.confirmReject", "Confirm reject")}
									</Button>
									<Button
										type="button"
					variant="outline"
					onClick={() => {
						dispatchSprint({ type: "closed" });
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

function isTextInputActive() {
	const active = document.activeElement;
	return (
		active instanceof HTMLInputElement ||
		active instanceof HTMLTextAreaElement ||
		active instanceof HTMLSelectElement ||
		active?.getAttribute("contenteditable") === "true"
	);
}

function isTextInputTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.getAttribute("contenteditable") === "true")
	);
}
