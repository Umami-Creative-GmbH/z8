"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ApprovalReasonForm } from "@/app/[locale]/(app)/approvals/inbox/components/approval-reason-form";
import { getApprovalTypeLabels } from "@/app/[locale]/(app)/approvals/inbox/components/approval-type-labels";
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
import { useApprovalInboxText } from "@/components/approvals/use-approval-inbox-text";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";
import { useTodayDecisionReservation } from "./today-decision-reservations";

type TodayApprovalsPanelProps = {
	items: BriefingApprovalActionItem[];
	/** Every pending approval of the briefing's employees; `items` may show only the first. */
	total?: number;
	error?: string;
	/** Approval types whose items could not be listed. */
	unavailableTypes?: string[];
	/** Approval types whose items listed but whose count failed: `total` misses them. */
	uncountedTypes?: string[];
	onRetry?: () => void;
	onDecision?: () => void;
	stale?: boolean;
};

type ApprovalDecision = "approve" | "reject";

type DecisionOutcome = "saved" | "failed" | "stale";

type ApprovalDecisionResponse = {
	success?: boolean;
	error?: string;
};

export function TodayApprovalsPanel({
	items,
	total: totalProp,
	error,
	unavailableTypes = [],
	uncountedTypes = [],
	onRetry,
	onDecision,
	stale,
}: TodayApprovalsPanelProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const inboxText = useApprovalInboxText();
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
	const total = Math.max(totalProp ?? items.length, items.length);
	// A source failed: the total may miss its approvals, so it is only a lower bound (#1980).
	const incomplete = unavailableTypes.length > 0 || uncountedTypes.length > 0;
	// Counted approvals it does not list, never shown as an empty queue.
	const truncated = total > items.length;
	const typeLabels: Record<string, string> = getApprovalTypeLabels(t);
	// "A, B and C" in the viewer's language, not English punctuation.
	const typeList = (types: string[]) =>
		new Intl.ListFormat(locale, { type: "conjunction" }).format(
			types.map((type) => typeLabels[type] ?? type),
		);
	// Each kind of failure in its own words, as the dashboard tells them apart (#1978).
	const partialFailure = [
		unavailableTypes.length > 0
			? t(
					"today.approvals.partialFailure",
					"Some approvals could not be loaded: {types}. The list and total may be incomplete.",
					{ types: typeList(unavailableTypes) },
				)
			: null,
		uncountedTypes.length > 0
			? t(
					"today.approvals.partialFailureNotCounted",
					"Some approvals could not be counted: {types}. The total may be incomplete.",
					{ types: typeList(uncountedTypes) },
				)
			: null,
	]
		.filter((sentence) => sentence !== null)
		.join(" ");
	const isBusy = actingApprovalId !== null || isRefreshPending;
	const decisionsOff = isBusy || Boolean(error) || stale;
	// The panel's own rejection is on its way: neither Cancel nor Escape may drop it.
	const rejectionPending = rejecting !== null && actingApprovalId === rejecting.approvalId;
	// A refresh can drop the item the panel was opened for; then the panel is gone too,
	// unless its rejection is already on its way.
	const rejectingListed =
		rejecting !== null && items.some((item) => item.approvalId === rejecting.approvalId);
	const rejectPanelOpen = rejecting !== null && (rejectingListed || rejectionPending);
	// Once the item is gone, the dropped rejection ends with it, so it can't reopen by itself
	// if a later refresh lists the item again, or leave its error behind on the card.
	// Adjusted during render (React's "state from props" pattern), not in an effect.
	if (rejecting !== null && !rejectPanelOpen) {
		setRejecting(null);
		setRejectReason("");
		setDecisionError(null);
	}

	/** The item's texts in the viewer's language where the inbox localizes them, else English. */
	function itemTexts(item: BriefingApprovalActionItem) {
		const { localized } = item;
		if (!localized) {
			return { title: item.title, description: item.description, summary: item.summary };
		}
		return {
			title: t("today.approvals.itemTitle", "{requester}: {title}", {
				requester: item.requesterName,
				title: inboxText(localized.title),
			}),
			description: inboxText(localized.subtitle),
			// No localized detail: it is text a person entered, shown as written.
			summary: localized.detail ? inboxText(localized.detail) : item.summary,
		};
	}
	// Rows, labels and the reject panel all show the viewer's texts.
	const shownItems = items.map((item) => ({ ...item, ...itemTexts(item) }));

	/**
	 * Settles "saved" when the decision was saved for this view, "failed" when it was not sent or
	 * refused, and "stale" when it settled after its view retired: its outcome is unknown here.
	 */
	function decideApproval(
		item: BriefingApprovalActionItem,
		decision: ApprovalDecision,
		reason?: string,
	): Promise<DecisionOutcome> {
		if (isBusy || error || stale || !active.current || decided.has(item.approvalId)) {
			return Promise.resolve("failed");
		}

		const reservation = reserve(item.approvalId);
		if (!reservation) return Promise.resolve("failed");
		const request = generation.current;
		setDecisionError(null);

		return postApprovalDecision(item.approvalId, decision, reason)
			.then((result): DecisionOutcome => {
				if (!active.current || request !== generation.current) return "stale";
				if (!result.success) {
					const message = result.error || fallbackError(t, decision);
					setDecisionError(message);
					toast.error(message);
					return "failed";
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
				return "saved";
			})
			.catch((): DecisionOutcome => {
				if (!active.current || request !== generation.current) return "stale";
				setDecisionError(fallbackError(t, decision));
				toast.error(fallbackError(t, decision));
				return "failed";
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
		// The error belonged to this rejection and was shown in its panel; dismissing it ends it.
		setDecisionError(null);
	}

	async function confirmRejection() {
		const reason = rejectReason.trim();
		if (!rejecting || !reason) return;
		// A failed rejection keeps the panel and the manager's reason for another try. One that
		// settled after its view retired may have been saved, so it is never offered again.
		if ((await decideApproval(rejecting, "reject", reason)) !== "failed") closeRejectPanel();
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
						<Badge variant={total > 0 ? "default" : "secondary"}>
							{error || stale
								? t("today.briefing.unavailable", "Unavailable")
								: incomplete
									? t("today.approvals.totalAtLeast", "{count}+", { count: total })
									: total}
						</Badge>
						<Button asChild size="sm" variant="outline">
							<Link href="/approvals/inbox">{t("today.approvals.openInbox", "Open inbox")}</Link>
						</Button>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-3">
				{error ? <SectionError message={error} onRetry={onRetry} /> : null}
				{!error && !stale && partialFailure ? (
					<SectionError message={partialFailure} onRetry={onRetry} />
				) : null}
				{/* While the reject panel is open, it shows the decision's outcome itself. */}
				{decisionError && !rejectPanelOpen ? <SectionError message={decisionError} /> : null}
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
						{shownItems.map((item) => (
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
										{/* The title already names the requester. */}
										{item.description}
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
													// Starts with the visible text, so speech input finds it (WCAG 2.5.3).
													aria-label={t(
														"today.approvals.reviewInInboxNamed",
														"Review in inbox: {title}",
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
				) : null}
				{(truncated || (incomplete && total > 0)) && !error && !stale ? (
					// The briefing lists the first page; the inbox holds the rest. With a failed source,
					// the total is a lower bound, so even a list as long as it may not be complete.
					<p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
						{items.length > 0 ? (
							<>
								<span>
									{incomplete
										? t(
												"today.approvals.truncatedAtLeast",
												"Showing {shown} of at least {total, plural, one {# pending approval} other {# pending approvals}}.",
												{ shown: items.length, total },
											)
										: t(
												"today.approvals.truncated",
												"Showing {shown} of {total, plural, one {# pending approval} other {# pending approvals}}.",
												{ shown: items.length, total },
											)}
								</span>
								<Link href="/approvals/inbox" className="font-medium underline underline-offset-4">
									{truncated
										? t("today.approvals.openInboxForRest", "Open the inbox to see the rest")
										: t("today.approvals.openInboxLink", "Open the inbox")}
								</Link>
							</>
						) : (
							// Nothing could be listed here, so don't say "Showing 0 of N".
							<>
								<span>
									{incomplete
										? t(
												"today.approvals.waitingInInboxAtLeast",
												"At least {total, plural, one {# pending approval is} other {# pending approvals are}} waiting in the inbox.",
												{ total },
											)
										: t(
												"today.approvals.waitingInInbox",
												"{total, plural, one {# pending approval is} other {# pending approvals are}} waiting in the inbox.",
												{ total },
											)}
								</span>
								<Link href="/approvals/inbox" className="font-medium underline underline-offset-4">
									{t("today.approvals.openInboxLink", "Open the inbox")}
								</Link>
							</>
						)}
					</p>
				) : null}
				{items.length === 0 && total === 0 && !incomplete && !error && !stale ? (
					<p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
						{t("today.approvals.empty", "No approvals are waiting.")}
					</p>
				) : null}
			</CardContent>
			<ActionPanel
				open={rejectPanelOpen}
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
									canReject={rejectingListed && !decisionsOff && !decided.has(rejecting.approvalId)}
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
