"use client";

import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import type {
	ApprovalInboxFastLaneGroup,
	ApprovalInboxItem,
	ApprovalInboxRiskLevel,
} from "@/lib/approvals/inbox/types";

type ApprovalFastLaneGroupView = {
	key: ApprovalInboxFastLaneGroup;
	items: ApprovalInboxItem[];
};

interface ApprovalFastLanesProps {
	groups: ApprovalFastLaneGroupView[];
	isBusy: boolean;
	onBulkApprove: (approvalIds: string[]) => void;
	onBulkReject: (approvalIds: string[], reason: string) => void;
}

const RISK_RANK: Record<ApprovalInboxRiskLevel, number> = {
	low: 1,
	medium: 2,
	high: 3,
};

const RISK_BADGE_VARIANTS: Record<ApprovalInboxRiskLevel, "secondary" | "outline" | "destructive"> =
	{
		low: "secondary",
		medium: "outline",
		high: "destructive",
	};

export function ApprovalFastLanes({
	groups,
	isBusy,
	onBulkApprove,
	onBulkReject,
}: ApprovalFastLanesProps) {
	const { t } = useTranslate();
	const [rejectingGroupKey, setRejectingGroupKey] = useState<string | null>(null);
	const [rejectReason, setRejectReason] = useState("");

	if (groups.length === 0) {
		return null;
	}

	return (
		<section className="space-y-4" aria-labelledby="approval-fast-lanes-title">
			<div className="space-y-1 px-1">
				<h2
					id="approval-fast-lanes-title"
					className="text-lg font-semibold tracking-tight text-balance"
				>
					{t("approvals:fastLanes.title", "Fast lanes")}
				</h2>
				<p className="text-sm text-muted-foreground">
					{t("approvals:fastLanes.description", "Review similar low-friction requests in batches.")}
				</p>
			</div>

			<div className="grid gap-4 lg:grid-cols-2">
				{groups.map((group) => {
					const label = getGroupLabel(t, group.key);
					const actionLabel = label.toLowerCase();
					const approvableIds = group.items
						.filter((item) => item.capabilities.canBulkApprove && item.capabilities.canApprove)
						.map((item) => item.id);
					const rejectableIds = group.items
						.filter((item) => item.capabilities.canReject)
						.map((item) => item.id);
					const notApprovableCount = group.items.length - approvableIds.length;
					const notRejectableCount = group.items.length - rejectableIds.length;
					const explanations = Array.from(
						new Set(group.items.map((item) => item.triage.explanation)),
					);
					const riskLevel = getHighestRiskLevel(group);
					const isRejecting = rejectingGroupKey === group.key;
					const trimmedReason = rejectReason.trim();

					return (
						<article key={group.key}>
							<Card className="h-full gap-4 border-primary/10 bg-card/95 shadow-xs">
								<CardHeader className="gap-3">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 space-y-1">
											<CardTitle className="text-base">{label}</CardTitle>
											<CardDescription>{getGroupDescription(t, group.key)}</CardDescription>
										</div>
										<Badge variant={RISK_BADGE_VARIANTS[riskLevel]}>
											{getRiskLabel(t, riskLevel)}
										</Badge>
									</div>
									<div className="text-sm font-medium text-muted-foreground">
										{t(
											"approvals:fastLanes.requestCount",
											group.items.length === 1 ? "1 request" : `${group.items.length} requests`,
											{ count: group.items.length },
										)}
									</div>
								</CardHeader>

								<CardContent className="space-y-4">
									<div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
										{explanations.map((explanation) => (
											<p key={explanation} className="break-words text-muted-foreground">
												{explanation}
											</p>
										))}
										{notApprovableCount > 0 ? (
											<p className="break-words text-muted-foreground text-xs">
												{t(
													"approvals:fastLanes.notEligibleApprove",
													`${notApprovableCount} not eligible for bulk approve`,
													{ notApprovableCount },
												)}
											</p>
										) : null}
										{notRejectableCount > 0 ? (
											<p className="break-words text-muted-foreground text-xs">
												{t(
													"approvals:fastLanes.notEligibleReject",
													`${notRejectableCount} not eligible for bulk reject`,
													{ notRejectableCount },
												)}
											</p>
										) : null}
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											size="sm"
											onClick={() => onBulkApprove(approvableIds)}
											disabled={isBusy || approvableIds.length === 0}
											aria-label={t("approvals:fastLanes.approveGroup", `Approve ${actionLabel}`, {
												label: actionLabel,
											})}
										>
											<IconCheck aria-hidden="true" />
											{t("approvals:fastLanes.approve", "Approve")}
										</Button>
										<Button
											size="sm"
											variant="outline"
											onClick={() => {
												if (rejectableIds.length === 0) return;
												setRejectingGroupKey(group.key);
												setRejectReason("");
											}}
											disabled={isBusy || rejectableIds.length === 0}
											aria-label={t("approvals:fastLanes.rejectGroup", `Reject ${actionLabel}`, {
												label: actionLabel,
											})}
										>
											<IconX aria-hidden="true" />
											{t("approvals:fastLanes.reject", "Reject")}
										</Button>
									</div>

									{isRejecting ? (
										<div className="space-y-2 rounded-lg border bg-muted/30 p-3">
											<label className="text-sm font-medium" htmlFor={`reject-${group.key}`}>
												{t("approvals:fastLanes.rejectReason", "Bulk reject reason")}
											</label>
											<Textarea
												id={`reject-${group.key}`}
												name={`bulk-reject-reason-${group.key}`}
												autoComplete="off"
												value={rejectReason}
												onChange={(event) => setRejectReason(event.target.value)}
												disabled={isBusy}
											/>
											<Button
												size="sm"
												variant="destructive"
												onClick={() => onBulkReject(rejectableIds, trimmedReason)}
												disabled={isBusy || trimmedReason.length === 0}
												aria-label={t(
													"approvals:fastLanes.confirmRejectGroup",
													`Confirm reject ${actionLabel}`,
													{
														label: actionLabel,
													},
												)}
											>
												{t("approvals:fastLanes.confirmReject", "Confirm reject")}
											</Button>
										</div>
									) : null}

									<Collapsible>
										<CollapsibleTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												className="px-0 text-muted-foreground"
												aria-label={t("approvals:fastLanes.expandGroup", `Expand ${label}`, {
													label,
												})}
											>
												<IconChevronDown aria-hidden="true" />
												{t("approvals:fastLanes.showGroup", `Show ${label}`, { label })}
											</Button>
										</CollapsibleTrigger>
										<CollapsibleContent className="space-y-2 pt-2">
											{group.items.map((item) => (
												<div key={item.id} className="rounded-lg border bg-background px-3 py-2">
													<div className="break-words font-medium text-sm">
														{item.requester.name}
													</div>
													<div className="break-words text-sm text-muted-foreground">
														{item.summary.detail}
													</div>
												</div>
											))}
										</CollapsibleContent>
									</Collapsible>
								</CardContent>
							</Card>
						</article>
					);
				})}
			</div>
		</section>
	);
}

function getHighestRiskLevel(group: ApprovalFastLaneGroupView): ApprovalInboxRiskLevel {
	return group.items.reduce<ApprovalInboxRiskLevel>((highest, item) => {
		return RISK_RANK[item.triage.riskLevel] > RISK_RANK[highest] ? item.triage.riskLevel : highest;
	}, "low");
}

function getGroupLabel(t: ReturnType<typeof useTranslate>["t"], key: ApprovalInboxFastLaneGroup) {
	switch (key) {
		case "low_risk_absence":
			return t("approvals:fastLanes.groups.lowRiskAbsence.label", "Low-risk absences");
		case "small_time_correction":
			return t("approvals:fastLanes.groups.smallTimeCorrection.label", "Small time corrections");
		case "stale_pending":
			return t("approvals:fastLanes.groups.stalePending.label", "Stale requests");
		case "payroll_blocker":
			return t("approvals:fastLanes.groups.payrollBlocker.label", "Payroll blockers");
	}
}

function getGroupDescription(
	t: ReturnType<typeof useTranslate>["t"],
	key: ApprovalInboxFastLaneGroup,
) {
	switch (key) {
		case "low_risk_absence":
			return t(
				"approvals:fastLanes.groups.lowRiskAbsence.description",
				"Absences with no detected conflicts.",
			);
		case "small_time_correction":
			return t(
				"approvals:fastLanes.groups.smallTimeCorrection.description",
				"Small time-entry corrections within policy tolerance.",
			);
		case "stale_pending":
			return t(
				"approvals:fastLanes.groups.stalePending.description",
				"Pending requests waiting longer than the review target.",
			);
		case "payroll_blocker":
			return t(
				"approvals:fastLanes.groups.payrollBlocker.description",
				"Payroll-relevant requests that need priority review.",
			);
	}
}

function getRiskLabel(t: ReturnType<typeof useTranslate>["t"], riskLevel: ApprovalInboxRiskLevel) {
	switch (riskLevel) {
		case "low":
			return t("approvals:fastLanes.risk.low", "Low risk");
		case "medium":
			return t("approvals:fastLanes.risk.medium", "Medium risk");
		case "high":
			return t("approvals:fastLanes.risk.high", "High risk");
	}
}
