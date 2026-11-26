"use client";

import {
	IconCheck,
	IconExternalLink,
	IconHelpCircle,
	IconInfoCircle,
	IconShieldCheck,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
	ApprovalKindDisclosure,
	ApprovalKindSupportMode,
	ChatFeatureCapabilityKind,
	ProviderCapabilityDisclosure,
} from "@/lib/chat-installations/capability-disclosure";
import type { PilotWorkflowType } from "@/lib/approvals/pilot/readiness";

export interface ChatCapabilityDisclosureCardProps {
	channelName: string;
	disclosure: ProviderCapabilityDisclosure | null;
}

function getCapabilityLabel(
	capability: ChatFeatureCapabilityKind,
	t: ReturnType<typeof useTranslate>["t"],
): string {
	switch (capability) {
		case "notifications":
			return t("settings.capabilities.feature.notifications", "Notifications");
		case "commands":
			return t("settings.capabilities.feature.commands", "Commands");
		case "daily_digest":
			return t("settings.capabilities.feature.dailyDigest", "Daily digest");
		case "escalations":
			return t("settings.capabilities.feature.escalations", "Escalations");
		case "approvals":
			return t("settings.capabilities.feature.approvals", "Approvals");
	}
}

function getWorkflowLabel(
	workflowType: PilotWorkflowType,
	t: ReturnType<typeof useTranslate>["t"],
): string {
	switch (workflowType) {
		case "absence":
			return t("settings.capabilities.approvalKind.absence", "Absences");
		case "travel_expense":
			return t("settings.capabilities.approvalKind.travelExpense", "Travel expenses");
		case "manual_time_submission":
			return t(
				"settings.capabilities.approvalKind.manualTimeSubmission",
				"Manual time submissions",
			);
		case "policy_clock_out":
			return t("settings.capabilities.approvalKind.policyClockOut", "Automatic clock-outs");
		case "time_correction":
			return t("settings.capabilities.approvalKind.timeCorrection", "Time corrections");
	}
}

function ApprovalSupportBadge({
	mode,
	t,
}: {
	mode: ApprovalKindSupportMode;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	switch (mode) {
		case "in_chat_decision":
			return (
				<Badge variant="default" className="w-fit shrink-0 gap-1">
					<IconCheck className="size-3.5" aria-hidden="true" />
					{t("settings.capabilities.mode.inChatDecision", "In-chat decision")}
				</Badge>
			);
		case "review_in_z8":
			return (
				<Badge variant="secondary" className="w-fit shrink-0 gap-1">
					<IconExternalLink className="size-3.5" aria-hidden="true" />
					{t("settings.capabilities.mode.reviewInZ8", "Review in Z8")}
				</Badge>
			);
		case "unverified":
			return (
				<Badge variant="outline" className="w-fit shrink-0 gap-1">
					<IconHelpCircle className="size-3.5" aria-hidden="true" />
					{t("settings.capabilities.mode.unverified", "Unverified")}
				</Badge>
			);
	}
}

function ApprovalKindRow({
	item,
	t,
}: {
	item: ApprovalKindDisclosure;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<li className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0 space-y-0.5">
				<p className="break-words text-sm font-medium">{getWorkflowLabel(item.workflowType, t)}</p>
				<p className="text-xs text-muted-foreground">
					{item.deliveryActive
						? t("settings.capabilities.delivery.active", "Delivery enabled for this approval kind")
						: t(
								"settings.capabilities.delivery.inactive",
								"Handled in the Z8 inbox unless delivery is enabled",
							)}
				</p>
			</div>
			<ApprovalSupportBadge mode={item.supportMode} t={t} />
		</li>
	);
}

export function ChatCapabilityDisclosureCard({
	channelName,
	disclosure,
}: ChatCapabilityDisclosureCardProps) {
	const { t } = useTranslate();

	if (!disclosure) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					<IconShieldCheck className="size-4 shrink-0" aria-hidden="true" />
					{t("settings.capabilities.title", "{channelName} capabilities & approval support", {
						channelName,
					})}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.capabilities.description",
						"Feature availability and approval card behavior are shown separately from connection readiness.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="min-w-0 space-y-5">
				{disclosure.escalationPolicy.channelControlsDeliveryOnly ? (
					<div
						role="note"
						className="flex min-w-0 items-start gap-2.5 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground"
					>
						<IconInfoCircle className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
						<p className="min-w-0 break-words">
							{t(
								"settings.capabilities.escalationPolicyOwnsTiming",
								"Your organization's approval escalation policy owns escalation timing ({hours} h response window). The {channelName} escalation setting controls delivery over this channel only.",
								{
									hours: String(disclosure.escalationPolicy.responseWindowHours ?? 24),
									channelName,
								},
							)}
						</p>
					</div>
				) : null}

				<section className="min-w-0 space-y-2">
					<h3 className="text-sm font-semibold">
						{t("settings.capabilities.featuresHeading", "Channel features")}
					</h3>
					<ul className="grid gap-2 sm:grid-cols-2">
						{disclosure.capabilities.map((cap) => (
							<li
								key={cap.capability}
								className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-background p-3"
							>
								<div className="flex items-center justify-between gap-2">
									<span className="text-sm font-medium">
										{getCapabilityLabel(cap.capability, t)}
									</span>
									<Badge variant={cap.enabled ? "default" : "secondary"} className="shrink-0">
										{cap.enabled
											? t("settings.capabilities.state.enabled", "Enabled")
											: t("settings.capabilities.state.disabled", "Disabled")}
									</Badge>
								</div>
								{cap.noteCode === "slack_review_in_z8" ? (
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.capabilities.slackReviewNote",
											"Slack approval cards link to Z8 for authenticated review and decisions.",
										)}
									</p>
								) : null}
								{cap.noteCode === "escalation_policy_owns_timing" ? (
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.capabilities.escalationDeliveryOnlyNote",
											"Controls channel delivery only; timeout is managed by escalation policy.",
										)}
									</p>
								) : null}
							</li>
						))}
					</ul>
				</section>

				<section className="min-w-0 space-y-2">
					<h3 className="text-sm font-semibold">
						{t("settings.capabilities.approvalKindsHeading", "Support by approval kind")}
					</h3>
					<ul className="space-y-2">
						{disclosure.approvalKinds.map((kind) => (
							<ApprovalKindRow key={kind.workflowType} item={kind} t={t} />
						))}
					</ul>
				</section>
			</CardContent>
		</Card>
	);
}
