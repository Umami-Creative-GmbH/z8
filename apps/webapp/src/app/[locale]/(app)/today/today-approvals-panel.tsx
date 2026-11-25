"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import {
	type RefObject,
	startTransition,
	useEffect,
	useMemo,
	useRef,
	useState,
	useTransition,
} from "react";
import { toast } from "sonner";
import { ApprovalReasonForm } from "@/app/[locale]/(app)/approvals/inbox/components/approval-reason-form";
import { getApprovalTypeLabels } from "@/app/[locale]/(app)/approvals/inbox/components/approval-type-labels";
import { useApprovalInboxSummaryText } from "@/components/approvals/use-approval-inbox-summary-text";
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
import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";
import { Link } from "@/navigation";
import { useTodayDecisionReservation } from "./today-decision-reservations";

type TodayApprovalsPanelProps = {
	items: BriefingApprovalActionItem[];
	/** Every pending approval of the briefing's employees; `items` may show only the first. */
	total?: number;
	error?: string;
	/** Approval types whose items could not be listed. */
	unavailableTypes?: ApprovalInboxType[];
	/** Approval types whose items listed but whose count failed: `total` misses them. */
	uncountedTypes?: ApprovalInboxType[];
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

type Translate = ReturnType<typeof useTranslate>["t"];

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
	// List summaries never name a per diem place (#1978): no travel expense catalog on /today.
	const inboxText = useApprovalInboxSummaryText(locale);
	const decisions = useApprovalDecisions({ error, stale, onDecision });
	// Where focus goes when the reject panel closes.
	const listRef = useRef<HTMLUListElement>(null);
	const lastRejectedId = useRef<string | null>(null);
	const rejection = useRejectPanel(items, decisions);
	// Once the item is gone, the dropped rejection ends with it, so it can't reopen by itself
	// if a later refresh lists the item again, or leave its error behind on the card.
	// Adjusted during render (React's "state from props" pattern), not in an effect.
	if (rejection.dropped) rejection.closePanel();
	const total = Math.max(totalProp ?? items.length, items.length);
	// A source failed: the total may miss its approvals, so it is only a lower bound (#1980).
	const incomplete = unavailableTypes.length > 0 || uncountedTypes.length > 0;
	// Each kind of failure in its own words, as the dashboard tells them apart (#1978).
	const partialFailure = usePartialFailureText(locale, unavailableTypes, uncountedTypes);
	const unavailable = Boolean(error) || Boolean(stale);
	// Rows, labels and the reject panel all show the viewer's texts.
	const shownItems = items.map((item) => ({ ...item, ...itemTexts(t, inboxText, item) }));

	return (
		<Card className="min-w-0 gap-4" aria-busy={decisions.isBusy}>
			<TodayApprovalsHeader total={total} unavailable={unavailable} incomplete={incomplete} />
			<CardContent className="space-y-3">
				<TodayApprovalsNotices
					error={error}
					stale={stale}
					partialFailure={partialFailure}
					// While the reject panel is open, it shows the decision's outcome itself.
					decisionError={rejection.open ? null : decisions.decisionError}
					retained={Boolean(error) && items.length > 0}
					onRetry={onRetry}
				/>
				{shownItems.length > 0 ? (
					<ul
						ref={listRef}
						tabIndex={-1}
						aria-label={t("today.approvals.pendingAriaLabel", "Pending approvals")}
						// A focus target after a saved rejection: shows where focus went (WCAG 2.4.7).
						className="space-y-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
					>
						{shownItems.map((item) => (
							<TodayApprovalRow
								key={item.id}
								item={item}
								decided={decisions.decided.has(item.approvalId)}
								decisionsOff={decisions.decisionsOff}
								onReject={(rejected) => {
									if (rejection.openPanel(rejected)) lastRejectedId.current = rejected.approvalId;
								}}
								onApprove={(approved) => void decisions.decideApproval(approved, "approve")}
							/>
						))}
					</ul>
				) : null}
				<TodayApprovalsQueueNote
					shownCount={items.length}
					total={total}
					incomplete={incomplete}
					unavailable={unavailable}
				/>
				<TodayApprovalsEmpty
					empty={items.length === 0 && total === 0 && !incomplete && !unavailable}
				/>
			</CardContent>
			<RejectApprovalPanel
				rejection={rejection}
				unavailable={unavailable}
				decisions={decisions}
				listRef={listRef}
				lastRejectedId={lastRejectedId}
			/>
		</Card>
	);
}

/** The item's texts in the viewer's language where the inbox localizes them, else English. */
function itemTexts(
	t: Translate,
	inboxText: ReturnType<typeof useApprovalInboxSummaryText>,
	item: BriefingApprovalActionItem,
) {
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

/** Each kind of failure in its own words, as the dashboard tells them apart (#1978). */
function usePartialFailureText(
	locale: string,
	unavailableTypes: ApprovalInboxType[],
	uncountedTypes: ApprovalInboxType[],
) {
	const { t } = useTranslate();
	const typeLabels: Record<string, string> = getApprovalTypeLabels(t);
	// "A, B and C" in the viewer's language, not English punctuation.
	const listFormat = useMemo(
		() => new Intl.ListFormat(locale, { type: "conjunction" }),
		[locale],
	);
	const typeList = (types: ApprovalInboxType[]) =>
		listFormat.format(types.map((type) => typeLabels[type] ?? type));
	return [
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
}

type ApprovalDecisions = ReturnType<typeof useApprovalDecisions>;

function useApprovalDecisions({
	error,
	stale,
	onDecision,
}: Pick<TodayApprovalsPanelProps, "error" | "stale" | "onDecision">) {
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
	const isBusy = actingApprovalId !== null || isRefreshPending;
	const decisionsOff = isBusy || Boolean(error) || stale;

	function canDecide(item: BriefingApprovalActionItem) {
		return !decisionsOff && active.current && !decided.has(item.approvalId);
	}

	/** Whether a settled request still belongs to the mounted view that sent it. */
	function isCurrent(request: number) {
		return active.current && request === generation.current;
	}

	function fail(message: string): DecisionOutcome {
		setDecisionError(message);
		toast.error(message);
		return "failed";
	}

	function succeed(item: BriefingApprovalActionItem, decision: ApprovalDecision): DecisionOutcome {
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
	}

	/**
	 * Settles "saved" when the decision was saved for this view, "failed" when it was not sent or
	 * refused, and "stale" when it settled after its view retired: its outcome is unknown here.
	 */
	function decideApproval(
		item: BriefingApprovalActionItem,
		decision: ApprovalDecision,
		reason?: string,
	): Promise<DecisionOutcome> {
		if (!canDecide(item)) {
			return Promise.resolve("failed");
		}

		const reservation = reserve(item.approvalId);
		if (!reservation) return Promise.resolve("failed");
		const request = generation.current;
		setDecisionError(null);

		return postApprovalDecision(item.approvalId, decision, reason)
			.then((result): DecisionOutcome => {
				if (!isCurrent(request)) return "stale";
				if (!result.success) return fail(result.error || fallbackError(t, decision));
				return succeed(item, decision);
			})
			.catch((): DecisionOutcome => {
				if (!isCurrent(request)) return "stale";
				return fail(fallbackError(t, decision));
			})
			.finally(() => {
				// Settlement releases the command even when its former view has retired.
				release(reservation);
			});
	}

	return {
		actingApprovalId,
		isBusy,
		decisionsOff,
		decisionError,
		setDecisionError,
		decided,
		decideApproval,
	};
}

type RejectPanelState = ReturnType<typeof useRejectPanel>;

function useRejectPanel(items: BriefingApprovalActionItem[], decisions: ApprovalDecisions) {
	const { actingApprovalId, decisionsOff, setDecisionError, decideApproval } = decisions;
	// The item whose rejection reason the manager is writing, and that reason.
	const [rejecting, setRejecting] = useState<BriefingApprovalActionItem | null>(null);
	// What the panel shows: the last item it was opened for, kept while the sheet slides out so
	// it never empties before it leaves. Opening the panel replaces it, and resets the reason.
	const [panelItem, setPanelItem] = useState<BriefingApprovalActionItem | null>(null);
	// Each opening gets a fresh reason form, even for the same item reopened while closing.
	const [panelOpening, setPanelOpening] = useState(0);
	const [reason, setReason] = useState("");
	// The panel's own rejection is on its way: neither Cancel nor Escape may drop it.
	const pending = rejecting !== null && actingApprovalId === rejecting.approvalId;
	// A refresh can drop the item the panel was opened for; then the panel is gone too,
	// unless its rejection is already on its way.
	// The item as the latest briefing lists it: a refresh can change what it may still do.
	const current =
		rejecting === null ? undefined : items.find((item) => item.approvalId === rejecting.approvalId);
	const listed = current !== undefined;
	const stillRejectable = current !== undefined && current.canReject && !current.ownRequest;
	const open = rejecting !== null && (listed || pending);
	// A refresh dropped the item while no rejection of it was on its way.
	const dropped = rejecting !== null && !open;

	/** Opens the panel for the item, unless decisions are off; says whether it opened. */
	function openPanel(item: BriefingApprovalActionItem) {
		if (decisionsOff) return false;
		// The panel shows only this rejection's outcome.
		setDecisionError(null);
		setReason("");
		setRejecting(item);
		setPanelItem(item);
		setPanelOpening((opening) => opening + 1);
		return true;
	}

	function closePanel() {
		setRejecting(null);
		// The reason stays for the close animation; opening the panel again resets it.
		// The error belonged to this rejection and was shown in its panel; dismissing it ends it.
		setDecisionError(null);
	}

	async function confirm() {
		const trimmed = reason.trim();
		if (!rejecting || !trimmed) return;
		// A failed rejection keeps the panel and the manager's reason for another try. One that
		// settled after its view retired may have been saved, so it is never offered again.
		if ((await decideApproval(rejecting, "reject", trimmed)) !== "failed") closePanel();
	}

	return {
		open,
		dropped,
		pending,
		listed,
		stillRejectable,
		panelItem,
		panelOpening,
		reason,
		setReason,
		openPanel,
		closePanel,
		confirm,
	};
}

function TodayApprovalsHeader({
	total,
	unavailable,
	incomplete,
}: {
	total: number;
	unavailable: boolean;
	incomplete: boolean;
}) {
	const { t } = useTranslate();
	return (
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
						{unavailable
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
	);
}

function TodayApprovalsNotices({
	error,
	stale,
	partialFailure,
	decisionError,
	retained,
	onRetry,
}: {
	error?: string;
	stale?: boolean;
	partialFailure: string;
	decisionError: string | null;
	retained: boolean;
	onRetry?: () => void;
}) {
	const { t } = useTranslate();
	return (
		<>
			{error ? <SectionError message={error} onRetry={onRetry} /> : null}
			{!error && !stale && partialFailure ? (
				<SectionError message={partialFailure} onRetry={onRetry} />
			) : null}
			{decisionError ? <SectionError message={decisionError} /> : null}
			{retained ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"today.briefing.retainedSection",
						"Previous results shown. Retry to check for changes.",
					)}
				</p>
			) : null}
		</>
	);
}

function TodayApprovalRow({
	item,
	decided,
	decisionsOff,
	onReject,
	onApprove,
}: {
	item: BriefingApprovalActionItem;
	decided: boolean;
	decisionsOff: boolean | undefined;
	onReject: (item: BriefingApprovalActionItem) => void;
	onApprove: (item: BriefingApprovalActionItem) => void;
}) {
	const { t } = useTranslate();
	return (
		<li className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-start sm:justify-between">
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
			{decided ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("today.approvals.decided", "Decision saved. Refresh to load the current queue.")}
				</p>
			) : item.ownRequest ? (
				<p className="shrink-0 font-medium text-muted-foreground text-xs leading-5 sm:max-w-48 sm:text-right">
					{t("today.approvals.ownRequest", "Your own request: another approver decides it.")}
				</p>
			) : (
				<TodayApprovalRowActions
					item={item}
					decisionsOff={decisionsOff}
					onReject={onReject}
					onApprove={onApprove}
				/>
			)}
		</li>
	);
}

function TodayApprovalRowActions({
	item,
	decisionsOff,
	onReject,
	onApprove,
}: {
	item: BriefingApprovalActionItem;
	decisionsOff: boolean | undefined;
	onReject: (item: BriefingApprovalActionItem) => void;
	onApprove: (item: BriefingApprovalActionItem) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex shrink-0 gap-2">
			{item.canReject ? (
				<Button
					aria-label={t("today.approvals.rejectLabel", "Reject {title}", {
						title: item.title,
					})}
					data-reject-approval-id={item.approvalId}
					disabled={decisionsOff}
					onClick={() => onReject(item)}
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
						aria-label={t("today.approvals.reviewInInboxNamed", "Review in inbox: {title}", {
							title: item.title,
						})}
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
					onClick={() => onApprove(item)}
					size="sm"
					type="button"
				>
					{t("today.approvals.approve", "Approve")}
				</Button>
			)}
		</div>
	);
}

function TodayApprovalsQueueNote({
	shownCount,
	total,
	incomplete,
	unavailable,
}: {
	shownCount: number;
	total: number;
	incomplete: boolean;
	unavailable: boolean;
}) {
	const { t } = useTranslate();
	// Counted approvals it does not list, never shown as an empty queue.
	const truncated = total > shownCount;
	if (unavailable || !(truncated || (incomplete && total > 0))) return null;
	// The briefing lists the first page; the inbox holds the rest. With a failed source,
	// the total is a lower bound, so even a list as long as it may not be complete.
	return (
		<p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
			{shownCount > 0 ? (
				<>
					<span>
						{incomplete
							? t(
									"today.approvals.truncatedAtLeast",
									"Showing {shown} of at least {total, plural, one {# pending approval} other {# pending approvals}}.",
									{ shown: shownCount, total },
								)
							: t(
									"today.approvals.truncated",
									"Showing {shown} of {total, plural, one {# pending approval} other {# pending approvals}}.",
									{ shown: shownCount, total },
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
	);
}

function TodayApprovalsEmpty({ empty }: { empty: boolean }) {
	const { t } = useTranslate();
	if (!empty) return null;
	return (
		<p className="rounded-lg border border-dashed bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
			{t("today.approvals.empty", "No approvals are waiting.")}
		</p>
	);
}

function RejectApprovalPanel({
	rejection,
	unavailable,
	decisions,
	listRef,
	lastRejectedId,
}: {
	rejection: RejectPanelState;
	unavailable: boolean;
	decisions: ApprovalDecisions;
	listRef: RefObject<HTMLUListElement | null>;
	lastRejectedId: RefObject<string | null>;
}) {
	const { t } = useTranslate();
	const { open, pending, closePanel } = rejection;
	return (
		<ActionPanel
			open={open}
			onOpenChange={(next) => {
				// Escape and the backdrop close it exactly when Cancel does.
				if (!next && !pending) closePanel();
			}}
		>
			<ActionPanelContent
				size="compact"
				// Like Cancel, the close button can't drop a rejection that is on its way.
				showCloseButton={!pending}
				// Back to the row's Reject button; once a saved decision has replaced it, to the list,
				// so keyboard and screen-reader users keep their place.
				finalFocus={() => {
					const id = lastRejectedId.current;
					const button = id
						? // A disabled button (stale or errored briefing) can't take focus: the list does.
							listRef.current?.querySelector<HTMLElement>(
								`[data-reject-approval-id="${id}"]:not(:disabled)`,
							)
						: null;
					return button ?? listRef.current ?? true;
				}}
			>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("today.approvals.rejectPanel.title", "Reject request")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"today.approvals.rejectPanel.description",
							"The requester sees this reason with the rejection.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-4">
					{rejection.panelItem ? (
						<RejectApprovalPanelBody
							panelItem={rejection.panelItem}
							rejection={rejection}
							unavailable={unavailable}
							decisions={decisions}
						/>
					) : null}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function RejectApprovalPanelBody({
	panelItem,
	rejection,
	unavailable,
	decisions,
}: {
	panelItem: BriefingApprovalActionItem;
	rejection: RejectPanelState;
	unavailable: boolean;
	decisions: ApprovalDecisions;
}) {
	const { t } = useTranslate();
	const { open, pending, listed, stillRejectable } = rejection;
	const { decisionError, decisionsOff, decided } = decisions;
	return (
		<>
			<div className="min-w-0 space-y-1 rounded-lg border bg-muted/20 p-3">
				<p className="break-words font-medium text-sm">{panelItem.title}</p>
				<p className="break-words text-muted-foreground text-sm">{panelItem.summary}</p>
			</div>
			{decisionError ? <SectionError message={decisionError} /> : null}
			{listed && !stillRejectable && !pending ? (
				// A refresh changed what the item may do: say why Confirm is off.
				<p
					role="status"
					className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground"
				>
					<span>
						{t(
							"today.approvals.rejectPanel.noLongerRejectable",
							"This request can no longer be rejected here.",
						)}
					</span>
					<Link href="/approvals/inbox" className="font-medium underline underline-offset-4">
						{t("today.approvals.openInboxLink", "Open the inbox")}
					</Link>
				</p>
			) : null}
			{open && unavailable && !pending ? (
				// The briefing's own alert is behind the modal panel: say why Confirm is off.
				<p role="status" className="text-sm text-muted-foreground">
					{t(
						"today.approvals.rejectPanel.briefingUnavailable",
						"Today's approvals could not be refreshed. Close this panel and retry.",
					)}
				</p>
			) : null}
			<ApprovalReasonForm
				key={`${panelItem.approvalId}:${rejection.panelOpening}`}
				reason={rejection.reason}
				onReasonChange={rejection.setReason}
				onCancel={rejection.closePanel}
				onConfirm={rejection.confirm}
				// Off while any decision or refresh is under way, so confirming never does nothing.
				canReject={stillRejectable && !decisionsOff && !decided.has(panelItem.approvalId)}
				isPending={pending}
			/>
		</>
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

function fallbackError(t: Translate, decision: ApprovalDecision) {
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
