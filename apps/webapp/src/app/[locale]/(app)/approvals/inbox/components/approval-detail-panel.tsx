"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { TimeCorrectionComparison } from "@/components/approvals/time-correction-comparison";
import { TravelExpenseReportReturnButton } from "@/components/approvals/travel-expense-report-return";
import {
	summaryField,
	useApprovalInboxText,
} from "@/components/approvals/use-approval-inbox-text";
import { formatRecordedInstant } from "@/components/travel-expenses/report/format";
import { ReopenReportPanel } from "@/components/travel-expenses/report/report-reopen";
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
import type {
	ApprovalInboxDetailChangeValue,
	ApprovalInboxDetailSection,
	ApprovalInboxItem,
} from "@/lib/approvals/inbox/types";
import { isApprovalInboxDetailChange } from "@/lib/approvals/inbox/localized-text";
import { useEmployeeClockStatuses } from "@/lib/query";
import {
	useApprovalDetail,
	useApproveApproval,
	useRejectApproval,
} from "@/lib/query/use-approval-inbox";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { getOwnRequestNote } from "./own-request-note";
import { ReceiptExceptionAcceptance } from "./receipt-exception-acceptance";
import {
	allReceiptExceptionsAccepted,
	findReceiptExceptionAcceptance,
} from "./receipt-exception-acceptance-section";

interface ApprovalDetailPanelProps {
	approval: ApprovalInboxItem | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onActioned: () => void;
}

function SectionTitle({
	children,
	asEntered = false,
}: {
	children: React.ReactNode;
	/** Text a person entered (an expense's description) keeps its own casing. */
	asEntered?: boolean;
}) {
	return (
		<h4
			className={cn(
				"mb-2 font-semibold",
				asEntered
					? "text-sm text-foreground"
					: "text-xs text-muted-foreground uppercase tracking-wide",
			)}
		>
			{children}
		</h4>
	);
}

type Translate = ReturnType<typeof useTranslate>["t"];
type InboxText = ReturnType<typeof useApprovalInboxText>;

function workLocationText(t: Translate, value: string) {
	const labels: Record<string, [string, string]> = {
		office: ["timeTracking.workLocationOffice", "Office"],
		home: ["timeTracking.workLocationHome", "Home"],
		remote: ["timeTracking.workLocationRemote", "Remote"],
		other: ["timeTracking.workLocationOther", "Other"],
	};
	const label = labels[value];
	return label ? t(label[0], label[1]) : value;
}

function changeValueText(t: Translate, value: ApprovalInboxDetailChangeValue) {
	if (value.kind === "work_location") {
		return workLocationText(t, value.value);
	}
	if (value.value.state === "named") return value.value.name;
	return value.value.state === "none"
		? t("timeTracking.noCategory", "No category (100%)")
		: t(
				"approvals:approvals.workCategoryUnavailable",
				"Unknown category (unavailable)",
			);
}

function renderDetailSection(
	t: Translate,
	text: InboxText,
	section: ApprovalInboxDetailSection,
	locale: string,
) {
	switch (section.type) {
		case "time_comparison":
			return (
				<TimeCorrectionComparison key="time-comparison" comparison={section} />
			);
		case "key_value":
			return (
				<section key={text(section.title)}>
					<SectionTitle asEntered={section.titleAsEntered}>
						{text(section.title)}
					</SectionTitle>
					<dl className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm">
						{section.rows.map((row) => (
							<div
								key={text(row.label)}
								// The label keeps up to 45%: a long value wraps instead of squeezing it.
								className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] items-start gap-4"
							>
								<dt className="text-sm text-muted-foreground">
									{text(row.label)}
								</dt>
								<dd
									className={cn(
										"min-w-0 text-right text-sm font-semibold break-words text-foreground",
										row.tone === "warning" &&
											"text-amber-600 dark:text-amber-400",
										row.tone === "danger" && "text-destructive",
									)}
								>
									{!isApprovalInboxDetailChange(row.value) ? (
										row.href ? (
											<Link
												href={row.href}
												className="rounded-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2"
											>
												{text(row.value)}
											</Link>
										) : (
											text(row.value)
										)
									) : (
										<span className="grid gap-1">
											<span>
												<span className="sr-only">
													{t("approvals:approvals.original", "Original")}:{" "}
												</span>
												{changeValueText(t, row.value.original)}
											</span>
											<span>
												<span className="sr-only">
													{t("approvals:approvals.requested", "Requested")}:{" "}
												</span>
												{changeValueText(t, row.value.requested)}
											</span>
										</span>
									)}
								</dd>
							</div>
						))}
					</dl>
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
				<section key={text(section.title)}>
					<SectionTitle>{text(section.title)}</SectionTitle>
					<div className="space-y-3 rounded-xl border bg-card/60 p-4 shadow-sm">
						{section.events.map((event) => (
							<div key={event.id} className="border-l-2 border-primary/30 pl-3">
								<p className="text-sm font-semibold">{text(event.label)}</p>
								<p className="text-xs text-muted-foreground">
									{event.actorName
										? t(
												"approvals:approvals.timelineActor",
												"{at} by {actorName}",
												{ at: formatRecordedInstant(locale, event.at), actorName: event.actorName },
											)
										: formatRecordedInstant(locale, event.at)}
								</p>
							</div>
						))}
					</div>
				</section>
			);
		case "callout":
			return (
				<section
					key={text(section.title)}
					className={cn(
						"rounded-xl border p-4 shadow-sm",
						section.tone === "info" &&
							"border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20",
						section.tone === "warning" &&
							"border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20",
						section.tone === "danger" &&
							"border-destructive/30 bg-destructive/5 text-destructive",
					)}
				>
					<h4 className="text-sm font-medium">{text(section.title)}</h4>
					<p className="mt-1 text-sm leading-6 text-muted-foreground">
						{text(section.body)}
					</p>
				</section>
			);
	}
}

function TravelExpenseClaimLink({ item }: { item: ApprovalInboxItem }) {
	const { t } = useTranslate();
	if (item.type !== "travel_expense_claim" && item.type !== "travel_expense_report") return null;

	return (
		<Link
			className="inline-block rounded-sm text-sm text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2"
			href={
				item.type === "travel_expense_report"
					? `/travel-expenses/reports/${item.entityId}`
					: `/travel-expenses/${item.entityId}`
			}
		>
			{item.type === "travel_expense_report"
				? t("approvals:approvals.viewExpenseReport", "View submitted report and receipts")
				: t("approvals:approvals.viewExpenseClaim", "View claim and receipts")}
		</Link>
	);
}

export function ApprovalDetailPanel({
	approval,
	open,
	onOpenChange,
	onActioned,
}: ApprovalDetailPanelProps) {
	const { t } = useTranslate();
	const text = useApprovalInboxText();
	const locale = useLocale();
	const [isRejecting, setIsRejecting] = useState(false);
	const [rejectionReason, setRejectionReason] = useState("");
	const [acceptedExceptions, setAcceptedExceptions] = useState<{
		approvalId: string | null;
		itemIds: string[];
	}>({ approvalId: null, itemIds: [] });

	const { data: detail } = useApprovalDetail(approval?.id ?? null);
	const approveMutation = useApproveApproval();
	const rejectMutation = useRejectApproval();
	const presence = useEmployeeClockStatuses(
		approval ? [approval.requester.id] : [],
		{
			polling: false,
		},
	);
	const item = detail?.item ?? approval;
	const actions = detail?.actions ?? item?.capabilities;
	const sections = detail?.sections ?? [];
	const isPending = approveMutation.isPending || rejectMutation.isPending;
	// Expense report missing-receipt exceptions to accept before approving (#604).
	const receiptExceptions = findReceiptExceptionAcceptance(sections);
	const acceptedExceptionIds =
		acceptedExceptions.approvalId === approval?.id ? acceptedExceptions.itemIds : [];
	const exceptionsAccepted = allReceiptExceptionsAccepted(receiptExceptions, acceptedExceptionIds);

	const handleApprove = async () => {
		if (!approval || !actions?.canApprove || isPending || !exceptionsAccepted) return;

		const result = await approveMutation.mutateAsync(
			receiptExceptions
				? { approvalId: approval.id, acceptedReceiptExceptionItemIds: acceptedExceptionIds }
				: approval.id,
		);
		if (result.success) {
			toast.success(t("approvals:approvals.approved", "Request approved"));
			onOpenChange(false);
			onActioned();
		} else {
			toast.error(
				result.error ||
					t("approvals:approvals.approveFailed", "Failed to approve"),
			);
		}
	};

	const handleReject = async () => {
		if (
			!approval ||
			!actions?.canReject ||
			!rejectionReason.trim() ||
			isPending
		)
			return;

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
			toast.error(
				result.error ||
					t("approvals:approvals.rejectFailed", "Failed to reject"),
			);
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
							<SheetTitle>
								{t("approvals:approvals.detailTitle", "Approval details")}
							</SheetTitle>
							<SheetDescription className="mt-1 line-clamp-2">
								{text(summaryField(panelItem.summary, "detail"))}
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
						<SectionTitle>
							{t("approvals:approvals.requester", "Requester")}
						</SectionTitle>
						<div className="flex items-center gap-3 rounded-xl border bg-card/60 p-4 shadow-sm">
							<UserAvatar
								image={panelItem.requester.image}
								seed={panelItem.requester.id}
								name={panelItem.requester.name}
								size="md"
								clockStatus={presence.getStatus(panelItem.requester.id)}
							/>
							<div className="min-w-0">
								<div className="truncate font-semibold">
									{panelItem.requester.name}
								</div>
								<div className="truncate text-sm text-muted-foreground">
									{panelItem.requester.email}
								</div>
							</div>
						</div>
					</div>

					<TravelExpenseClaimLink item={panelItem} />
					{/* An approved report not yet exported or paid can be reopened from here too (#614). */}
					{panelItem.type === "travel_expense_report" && panelItem.status === "approved" && (
						<ReopenReportPanel reportId={panelItem.entityId} />
					)}
					{sections.length > 0 && <Separator />}

					{sections.map((section) =>
						section.type === "receipt_exception_acceptance" ? (
							<ReceiptExceptionAcceptance
								key="receipt-exception-acceptance"
								section={section}
								accepted={acceptedExceptionIds}
								onChange={(itemIds) =>
									setAcceptedExceptions({ approvalId: approval.id, itemIds })
								}
								disabled={!panelActions.canApprove}
							/>
						) : (
							renderDetailSection(t, text, section, locale)
						),
					)}
				</div>

				<SheetFooter className="border-t bg-muted/95 px-5 py-4 sm:px-6">
					{panelActions.ownRequest ? (
						<p className="text-muted-foreground text-sm">{getOwnRequestNote(t)}</p>
					) : isRejecting ? (
						<div className="w-full space-y-4">
							<div>
								<label
									className="text-sm font-medium"
									htmlFor="rejection-reason"
								>
									{t(
										"approvals:approvals.rejectionReason",
										"Reason for rejection",
									)}
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
									disabled={
										!actions?.canReject || !rejectionReason.trim() || isPending
									}
								>
									{rejectMutation.isPending && (
										<IconLoader2
											className="mr-2 size-4 animate-spin"
											aria-hidden="true"
										/>
									)}
									<IconX className="mr-2 size-4" aria-hidden="true" />
									{t("approvals:approvals.confirmReject", "Confirm Rejection")}
								</Button>
							</div>
						</div>
					) : (
						<div className="flex w-full gap-2">
							{panelItem.type === "travel_expense_report" && (
								<TravelExpenseReportReturnButton
									approvalId={approval.id}
									reportId={panelItem.entityId}
									disabled={!panelActions.canReject || isPending}
									onReturned={() => {
										onOpenChange(false);
										onActioned();
									}}
								/>
							)}
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
								disabled={!panelActions.canApprove || isPending || !exceptionsAccepted}
							>
								{approveMutation.isPending && (
									<IconLoader2
										className="mr-2 size-4 animate-spin"
										aria-hidden="true"
									/>
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
