"use client";

import {
	IconArrowRight,
	IconCheck,
	IconExternalLink,
	IconPlayerSkipForward,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type {
	ApprovalInboxItem,
	ApprovalInboxPriority,
	ApprovalInboxRiskLevel,
} from "@/lib/approvals/inbox/types";

interface ApprovalSprintCardProps {
	item: ApprovalInboxItem;
	isBusy: boolean;
	onApprove: () => void;
	onReject: () => void;
	onSkip: () => void;
	onOpenDetails: () => void;
}

const RISK_BADGE_VARIANTS: Record<ApprovalInboxRiskLevel, "secondary" | "outline" | "destructive"> = {
	low: "secondary",
	medium: "outline",
	high: "destructive",
};

const PRIORITY_BADGE_VARIANTS: Record<ApprovalInboxPriority, "secondary" | "outline" | "destructive"> = {
	low: "secondary",
	normal: "outline",
	high: "outline",
	urgent: "destructive",
};

export function ApprovalSprintCard({
	item,
	isBusy,
	onApprove,
	onReject,
	onSkip,
	onOpenDetails,
}: ApprovalSprintCardProps) {
	const { t } = useTranslate();
	const canApprove = item.capabilities.canApprove;
	const canReject = item.capabilities.canReject;

	return (
		<Card className="border-primary/10 bg-card/95 shadow-xs">
			<CardHeader className="gap-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0 space-y-1">
						<p className="break-words font-medium text-muted-foreground text-sm">
							{item.requester.name}
						</p>
						<CardTitle className="break-words text-xl tracking-tight">
							{item.summary.title}
						</CardTitle>
						<CardDescription className="break-words">{item.summary.subtitle}</CardDescription>
					</div>
					<Badge variant={RISK_BADGE_VARIANTS[item.triage.riskLevel]}>
						{getRiskLabel(t, item.triage.riskLevel)}
					</Badge>
				</div>
			</CardHeader>

			<CardContent className="space-y-5">
				<div className="rounded-lg border bg-muted/30 p-4">
					<div className="text-muted-foreground text-xs uppercase tracking-wide">
						{getTypeLabel(t, item.type)}
					</div>
					<p className="mt-2 break-words text-sm leading-6">{item.summary.detail}</p>
				</div>

				<div className="space-y-2 rounded-lg border bg-background p-4">
					<div className="font-medium text-sm">{t("approvals:sprint.triage", "Triage")}</div>
					<p className="break-words text-muted-foreground text-sm leading-6">
						{item.triage.explanation}
					</p>
					<div className="flex flex-wrap gap-2">
						<Badge variant={PRIORITY_BADGE_VARIANTS[item.triage.priority]}>
							{getPriorityLabel(t, item.triage.priority)}
						</Badge>
						<Badge variant="outline">
							{t("approvals:sprint.age", `${item.timing.ageDays}d old`, {
								count: item.timing.ageDays,
							})}
						</Badge>
						{item.capabilities.canBulkApprove ? (
							<Badge variant="secondary">
								{t("approvals:sprint.capabilities.bulkApprove", "Bulk eligible")}
							</Badge>
						) : null}
					</div>
				</div>

				<div className="flex flex-wrap gap-2">
					{item.triage.riskReasons.map((reason) => (
						<Badge key={reason} variant="outline">
							{getRiskReasonLabel(t, reason)}
						</Badge>
					))}
					{canApprove ? null : (
						<Badge variant="outline">
							{t("approvals:sprint.capabilities.approveUnavailable", "Approval unavailable")}
						</Badge>
					)}
					{canReject ? null : (
						<Badge variant="outline">
							{t("approvals:sprint.capabilities.rejectUnavailable", "Rejection unavailable")}
						</Badge>
					)}
				</div>
			</CardContent>

			<CardFooter className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-between">
				<Button type="button" variant="ghost" onClick={onOpenDetails} disabled={isBusy}>
					<IconExternalLink aria-hidden="true" />
					{t("approvals:sprint.openDetails", "Open details")}
				</Button>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						onClick={onApprove}
						disabled={isBusy || !canApprove}
						aria-label={t("approvals:sprint.approveCurrentApproval", "Approve current approval")}
					>
						<IconCheck aria-hidden="true" />
						{t("approvals:sprint.approve", "Approve")}
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={onReject}
						disabled={isBusy || !canReject}
						aria-label={t("approvals:sprint.rejectCurrentApproval", "Reject current approval")}
					>
						<IconX aria-hidden="true" />
						{t("approvals:sprint.reject", "Reject")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={onSkip}
						disabled={isBusy}
						aria-label={t("approvals:sprint.skipCurrentApproval", "Skip current approval")}
					>
						<IconPlayerSkipForward aria-hidden="true" />
						{t("approvals:sprint.skip", "Skip")}
						<IconArrowRight aria-hidden="true" />
					</Button>
				</div>
			</CardFooter>
		</Card>
	);
}

function getRiskLabel(t: ReturnType<typeof useTranslate>["t"], riskLevel: ApprovalInboxRiskLevel) {
	switch (riskLevel) {
		case "low":
			return t("approvals:sprint.risk.low", "Low risk");
		case "medium":
			return t("approvals:sprint.risk.medium", "Medium risk");
		case "high":
			return t("approvals:sprint.risk.high", "High risk");
	}
}

function getPriorityLabel(t: ReturnType<typeof useTranslate>["t"], priority: ApprovalInboxPriority) {
	switch (priority) {
		case "urgent":
			return t("approvals:sprint.priority.urgent", "Urgent priority");
		case "high":
			return t("approvals:sprint.priority.high", "High priority");
		case "normal":
			return t("approvals:sprint.priority.normal", "Normal priority");
		case "low":
			return t("approvals:sprint.priority.low", "Low priority");
	}
}

function getRiskReasonLabel(t: ReturnType<typeof useTranslate>["t"], reason: string) {
	switch (reason) {
		case "no_conflicts_detected":
			return t("approvals:sprint.riskReasons.noConflictsDetected", "No conflicts detected");
		case "small_time_delta":
			return t("approvals:sprint.riskReasons.smallTimeDelta", "Small time delta");
		case "stale_pending":
			return t("approvals:sprint.riskReasons.stalePending", "Stale pending");
		case "payroll_relevant":
			return t("approvals:sprint.riskReasons.payrollRelevant", "Payroll relevant");
		case "needs_review":
			return t("approvals:sprint.riskReasons.needsReview", "Needs review");
		default:
			return reason;
	}
}

function getTypeLabel(t: ReturnType<typeof useTranslate>["t"], type: ApprovalInboxItem["type"]) {
	switch (type) {
		case "absence_entry":
			return t("approvals:sprint.types.absenceEntry", "Absence request");
		case "time_entry":
			return t("approvals:sprint.types.timeEntry", "Time entry");
		case "travel_expense_claim":
			return t("approvals:sprint.types.travelExpenseClaim", "Travel expense claim");
	}
}
