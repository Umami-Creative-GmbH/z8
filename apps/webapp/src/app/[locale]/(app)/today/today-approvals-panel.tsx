"use client";

import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ApprovalReasonForm } from "@/app/[locale]/(app)/approvals/inbox/components/approval-reason-form";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";
import { useTodayDecisionReservation } from "./today-decision-reservations";

type TodayApprovalsPanelProps = {
	items: BriefingApprovalActionItem[];
	error?: string;
	onRetry?: () => void;
	onDecision?: () => void;
	stale?: boolean;
};

type ApprovalDecision = "approve" | "reject";

type ApprovalDecisionResponse = {
	success?: boolean;
	error?: string;
};

export function TodayApprovalsPanel({
	items,
	error,
	onRetry,
	onDecision,
	stale,
}: TodayApprovalsPanelProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const { pendingApprovalId: actingApprovalId, reserve, release } = useTodayDecisionReservation();
	const [isRefreshPending, startRefreshTransition] = useTransition();
	const [decisionError, setDecisionError] = useState<string | null>(null);
	const [decided, setDecided] = useState<Set<string>>(() => new Set());
	const active = useRef(false);
	const generation = useRef(0);
	useEffect(() => {
		active.current = true;
		generation.current++;
		return () => {
			active.current = false;
		};
	}, []);
	// The item whose rejection reason the manager is writing, and that reason.
	const [rejecting, setRejecting] = useState<BriefingApprovalActionItem | null>(null);
	const [rejectReason, setRejectReason] = useState("");
	const isBusy = actingApprovalId !== null || isRefreshPending;
	const decisionsOff = isBusy || Boolean(error) || stale;
	// The panel's own rejection is on its way: neither Cancel nor Escape may drop it.
	const rejectionPending = rejecting !== null && actingApprovalId === rejecting.approvalId;

	/** Settles true only when the decision was saved for this view. */
	function decideApproval(
		item: BriefingApprovalActionItem,
		decision: ApprovalDecision,
		reason?: string,
	): Promise<boolean> {
		if (isBusy || error || stale || !active.current || decided.has(item.approvalId)) {
			return Promise.resolve(false);
		}

		const reservation = reserve(item.approvalId);
		if (!reservation) return Promise.resolve(false);
		const request = generation.current;
		setDecisionError(null);

		return postApprovalDecision(item.approvalId, decision, reason)
			.then((result) => {
				if (!active.current || request !== generation.current) return false;
				if (!result.success) {
					const message = result.error || fallbackError(t, decision);
					setDecisionError(message);
					toast.error(message);
					return false;
				}

				toast.success(
					decision === "approve"
						? t("today.approvals.toast.approved", "Request approved")
						: t("today.approvals.toast.rejected", "Request rejected"),
				);
				setDecided((previous) => new Set(previous).add(item.approvalId));
				onDecision?.();
				startTransition(() => {
					startRefreshTransition(() => {
						refresh();
					});
				});
				return true;
			})
			.catch(() => {
				if (!active.current || request !== generation.current) return false;
				setDecisionError(fallbackError(t, decision));
				toast.error(fallbackError(t, decision));
				return false;
			})
			.finally(() => {
				// Settlement releases the command even when its former view has retired.
				release(reservation);
			});
	}

	function openRejectPanel(item: BriefingApprovalActionItem) {
		if (decisionsOff) return;
		// The panel shows only this rejection's outcome.
		setDecisionError(null);
		setRejectReason("");
		setRejecting(item);
	}

	function closeRejectPanel() {
		setRejecting(null);
		setRejectReason("");
	}

	async function confirmRejection() {
		const reason = rejectReason.trim();
		if (!rejecting || !reason) return;
		// A failed rejection keeps the panel and the manager's reason for another try.
		if (await decideApproval(rejecting, "reject", reason)) closeRejectPanel();
	}

	return (
		<Card className="min-w-0 gap-4" aria-busy={isBusy}>
			<CardHeader className="gap-2">
				<div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<h2 className="font-semibold text-base leading-none">
							{t("today.approvals.title", "Approvals")}
						</h2>
						<CardDescription className="break-words">
							{t("today.approvals.description", "Requests waiting for a manager decision.")}
						</CardDescription>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Badge variant={items.length > 0 ? "default" : "secondary"}>
							{error || stale ? t("today.briefing.unavailable", "Unavailable") : items.length}
						</Badge>
						<Button asChild size="sm" variant="outline">
							<Link href="/approvals/inbox">{t("today.approvals.openInbox", "Open inbox")}</Link>
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{error ? <SectionError message={error} onRetry={onRetry} /> : null}
				{/* While the reject panel is open, it shows the decision's outcome itself. */}
				{decisionError && !rejecting ? <SectionError message={decisionError} /> : null}
				{error && items.length > 0 ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t(
							"today.briefing.retainedSection",
							"Previous results shown. Retry to check for changes.",
						)}
					</p>
				) : null}
				{items.length > 0 ? (
					<ul
						aria-label={t("today.approvals.pendingAriaLabel", "Pending approvals")}
						className="space-y-3"
					>
						{items.map((item) => (
							<li
								className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-start sm:justify-between"
								key={item.id}
							>
								<div className="min-w-0 space-y-1">
									<Link
										href={item.href}
										className="break-words font-medium text-sm underline underline-offset-4"
									>
										{item.title}
									</Link>
									<p className="break-words text-muted-foreground text-sm">{item.summary}</p>
									<p className="break-words text-muted-foreground text-xs">
										{item.requesterName} - {item.description}
									</p>
								</div>
								{decided.has(item.approvalId) ? (
									<p role="status" className="text-sm text-muted-foreground">
										{t(
											"today.approvals.decided",
											"Decision saved. Refresh to load the current queue.",
										)}
									</p>
								) : item.ownRequest ? (
									<p className="shrink-0 font-medium text-muted-foreground text-xs leading-5 sm:max-w-48 sm:text-right">
										{t(
											"today.approvals.ownRequest",
											"Your own request: another approver decides it.",
										)}
									</p>
								) : (
									<div className="flex shrink-0 gap-2">
										{item.canReject ? (
											<Button
												aria-label={t("today.approvals.rejectLabel", "Reject {title}", {
													title: item.title,
												})}
												disabled={decisionsOff}
												onClick={() => openRejectPanel(item)}
												size="sm"
												type="button"
												variant="outline"
											>
												{t("today.approvals.reject", "Reject")}
											</Button>
										) : null}
										{item.requiresDetailReview || !item.canApprove ? (
											// The inbox approves it only in its detail view (acceptances to collect,
											// a decision it blocks), or not from the list at all.
											<Button asChild size="sm">
												<Link
													aria-label={t(
														"today.approvals.reviewInInboxLabel",
														"Review {title} in inbox",
														{ title: item.title },
													)}
													href={item.href}
												>
													{t("today.approvals.reviewInInbox", "Review in inbox")}
												</Link>
											</Button>
										) : (
											<Button
												aria-label={t("today.approvals.approveLabel", "Approve {title}", {
													title: item.title,
												})}
												disabled={decisionsOff}
												onClick={() => void decideApproval(item, "approve")}
												size="sm"
												type="button"
											>
												{t("today.approvals.approve", "Approve")}
											</Button>
										)}
									</div>
								)}
							</li>
						))}
					</ul>
				) : !error && !stale ? (
					<p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
						{t("today.approvals.empty", "No approvals are waiting.")}
					</p>
				) : null}
			</CardContent>
			<ActionPanel
				open={rejecting !== null}
				onOpenChange={(open) => {
					// Escape and the backdrop close it exactly when Cancel does.
					if (!open && !rejectionPending) closeRejectPanel();
				}}
			>
				<ActionPanelContent size="compact">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("today.approvals.rejectPanel.title", "Reject request")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"today.approvals.rejectPanel.description",
								"The requester sees this reason with the rejection.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						{rejecting ? (
							<>
								<div className="min-w-0 space-y-1 rounded-lg border bg-muted/20 p-3">
									<p className="break-words font-medium text-sm">{rejecting.title}</p>
									<p className="break-words text-muted-foreground text-sm">{rejecting.summary}</p>
								</div>
								{decisionError ? <SectionError message={decisionError} /> : null}
								<ApprovalReasonForm
									key={rejecting.approvalId}
									reason={rejectReason}
									onReasonChange={setRejectReason}
									onCancel={closeRejectPanel}
									onConfirm={confirmRejection}
									// Off while any decision or refresh is under way, so confirming never does nothing.
									canReject={!decisionsOff && !decided.has(rejecting.approvalId)}
									isPending={rejectionPending}
								/>
							</>
						) : null}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>
		</Card>
	);
}

async function postApprovalDecision(
	approvalId: string,
	decision: ApprovalDecision,
	reason?: string,
): Promise<ApprovalDecisionResponse> {
	const response = await fetch(`/api/approvals/inbox/${approvalId}/${decision}`, {
		method: "POST",
		...(decision === "reject"
			? {
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ reason }),
				}
			: {}),
	});

	const payload: unknown = await response.json();
	const parsed = parseApprovalDecisionResponse(payload);

	if (!response.ok || !parsed.success) {
		return { success: false, error: parsed.error };
	}

	return { success: true };
}

function parseApprovalDecisionResponse(payload: unknown): ApprovalDecisionResponse {
	if (!isRecord(payload)) {
		return { success: false };
	}

	return {
		success: payload.success === true,
		error: typeof payload.error === "string" ? payload.error : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function fallbackError(t: ReturnType<typeof useTranslate>["t"], decision: ApprovalDecision) {
	return decision === "approve"
		? t("today.approvals.toast.approveError", "Unable to approve request")
		: t("today.approvals.toast.rejectError", "Unable to reject request");
}

function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
	const { t } = useTranslate();
	return (
		<div
			className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm"
			role="alert"
		>
			{message}
			{onRetry ? (
				<Button type="button" size="sm" variant="outline" onClick={onRetry} className="mt-2">
					{t("today.approvals.retry", "Retry approvals")}
				</Button>
			) : null}
		</div>
	);
}
