"use client";

import {
	IconAlertTriangle,
	IconArrowsExchange,
	IconCheck,
	IconClock,
	IconLoader2,
	IconRefresh,
	IconShieldCheck,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	ConfirmedSlackSwitchData,
	ConfirmSlackSwitchActionInput,
} from "@/app/[locale]/(app)/settings/notification-channels/slack-switch-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ChatSwitchImpactPreview } from "@/lib/chat-installations/switch-lifecycle";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

const SLACK_SWITCH_REFUSALS = {
	switch_not_enabled: [
		"settings.slackSwitch.errors.switchNotEnabled",
		"Switching to an organization-owned Slack app is not enabled for this organization yet.",
	],
	migration_blocked: [
		"settings.slackSwitch.errors.migrationBlocked",
		"Resolve the migration blockers above before switching Slack installations.",
	],
	candidate_not_found: [
		"settings.slackSwitch.errors.candidateNotFound",
		"No candidate Slack installation was found. Prepare and verify one first.",
	],
	already_switched: [
		"settings.slackSwitch.errors.alreadySwitched",
		"This Slack installation is already active.",
	],
	candidate_not_ready: [
		"settings.slackSwitch.errors.candidateNotReady",
		"Complete all Slack app verification steps before switching.",
	],
	candidate_verification_expired: [
		"settings.slackSwitch.errors.candidateVerificationExpired",
		"Verification proofs for the candidate Slack app have expired. Re-verify before switching.",
	],
	impact_changed: [
		"settings.slackSwitch.errors.impactChanged",
		"Impact or installation revisions changed since your review. Review the updated summary and confirm again.",
	],
	unready_acknowledgement_required: [
		"settings.slackSwitch.errors.unreadyAckRequired",
		"Acknowledge that some employees still need to connect or verify direct messages before switching.",
	],
} satisfies RefusalMessages<
	| "switch_not_enabled"
	| "migration_blocked"
	| "candidate_not_found"
	| "already_switched"
	| "candidate_not_ready"
	| "candidate_verification_expired"
	| "impact_changed"
	| "unready_acknowledgement_required"
>;

export interface SlackSwitchReviewPanelProps {
	initialPreview: ChatSwitchImpactPreview | null;
	refreshPreviewAction: () => Promise<ServerActionResult<ChatSwitchImpactPreview>>;
	confirmSwitchAction: (
		input: ConfirmSlackSwitchActionInput,
	) => Promise<ServerActionResult<ConfirmedSlackSwitchData>>;
}

function isPreviewPayload(value: unknown): value is ChatSwitchImpactPreview {
	return (
		typeof value === "object" &&
		value !== null &&
		"impactDigest" in value &&
		typeof (value as { impactDigest?: unknown }).impactDigest === "string"
	);
}

function MetricTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
	return (
		<div className="min-w-0 rounded-lg border bg-background p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
			{hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
		</div>
	);
}

export function SlackSwitchReviewPanel({
	initialPreview,
	refreshPreviewAction,
	confirmSwitchAction,
}: SlackSwitchReviewPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const idPrefix = useId();
	const summaryRef = useRef<HTMLDivElement | null>(null);

	const [preview, setPreview] = useState<ChatSwitchImpactPreview | null>(initialPreview);
	const [acknowledgedUnready, setAcknowledgedUnready] = useState(false);
	const [impactChangedNotice, setImpactChangedNotice] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState<string>("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const announce = (message: string) => {
		setAnnouncement(message);
	};

	const refreshMutation = useMutation({
		mutationFn: () => refreshPreviewAction(),
		onSuccess: (result) => {
			if (result.success) {
				setPreview(result.data);
				setErrorMessage(null);
				setImpactChangedNotice(null);
				setAcknowledgedUnready(false);
				announce(
					t("settings.slackSwitch.refreshedAnnouncement", "Slack switch impact preview refreshed."),
				);
			} else {
				const msg = actionErrorMessage(t, result, SLACK_SWITCH_REFUSALS, [
					"settings.slackSwitch.errors.refreshFailed",
					"Could not refresh Slack switch impact preview.",
				]);
				setErrorMessage(msg);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	const confirmMutation = useMutation({
		mutationFn: (input: ConfirmSlackSwitchActionInput) => confirmSwitchAction(input),
		onSuccess: (result) => {
			if (result.success) {
				setPreview(result.data.preview);
				setAcknowledgedUnready(false);
				setImpactChangedNotice(null);
				setErrorMessage(null);
				const msg = t(
					"settings.slackSwitch.switchedAnnouncement",
					"Switched to your organization-owned Slack app. Previous approval cards remain serviced during retirement.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}

			const freshPreview =
				result.details && "preview" in result.details && isPreviewPayload(result.details.preview)
					? result.details.preview
					: null;

			if (freshPreview) {
				setPreview(freshPreview);
				setAcknowledgedUnready(false);
			}

			const msg = actionErrorMessage(t, result, SLACK_SWITCH_REFUSALS, [
				"settings.slackSwitch.errors.confirmFailed",
				"Could not switch Slack installation.",
			]);

			if (result.refusal === "impact_changed") {
				setImpactChangedNotice(msg);
				setErrorMessage(null);
				announce(msg);
				// Move focus directly to the updated impact summary so keyboard & screen-reader users
				// review the changed impact before confirming again.
				queueMicrotask(() => {
					summaryRef.current?.focus();
				});
				return;
			}

			setErrorMessage(msg);
			announce(msg);
			toast.error(msg);
		},
		onError: () => {
			const msg = t(
				"settings.slackSwitch.errors.confirmFailed",
				"Could not switch Slack installation.",
			);
			setErrorMessage(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	if (!preview) {
		return null;
	}

	const candidate = preview.candidateInstallation;
	const hasRetiring = preview.retiringInstallations.length > 0;
	const ackCheckboxId = `${idPrefix}-ack-unready`;
	const summaryHeadingId = `${idPrefix}-impact-summary-heading`;

	const canSubmitSwitch =
		Boolean(candidate) &&
		preview.canConfirm &&
		!confirmMutation.isPending &&
		(!preview.requiresUnreadyAcknowledgement || acknowledgedUnready);

	const handleConfirm = () => {
		if (!candidate) return;
		setErrorMessage(null);
		setImpactChangedNotice(null);
		confirmMutation.mutate({
			candidateInstallationId: candidate.id,
			reviewedCurrentInstallationId: preview.primaryCurrentInstallationId,
			reviewedCurrentCredentialRevisionId: preview.primaryCurrentCredentialRevisionId,
			reviewedCandidateCredentialRevisionId: candidate.activeCredentialRevisionId,
			reviewedImpactDigest: preview.impactDigest,
			acknowledgeUnreadyEmployees: acknowledgedUnready,
		});
	};

	return (
		<div className="min-w-0 space-y-6">
			{/* Accessible live region for switch impact drift & status announcements */}
			<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
				{announcement}
			</div>

			{candidate ? (
				<Card>
					<CardHeader>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 space-y-1">
								<CardTitle className="flex items-center gap-2 text-base">
									<IconArrowsExchange className="size-4 shrink-0" aria-hidden="true" />
									{t("settings.slackSwitch.title", "Review impact & switch Slack app")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.slackSwitch.description",
										"Review employee reachability, open approval cards, and in-flight notifications before activating your verified organization-owned Slack app.",
									)}
								</CardDescription>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Badge
									variant={preview.switchControlEnabled ? "default" : "secondary"}
									className="w-fit shrink-0"
								>
									{preview.switchControlEnabled
										? t("settings.slackSwitch.gate.enabled", "Switch enabled")
										: t("settings.slackSwitch.gate.disabled", "Switch gated")}
								</Badge>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={refreshMutation.isPending}
									onClick={() => refreshMutation.mutate()}
								>
									{refreshMutation.isPending ? (
										<IconLoader2
											className="mr-1.5 size-4 motion-safe:animate-spin"
											aria-hidden="true"
										/>
									) : (
										<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
									)}
									{t("settings.slackSwitch.refresh", "Refresh impact")}
								</Button>
							</div>
						</div>
					</CardHeader>

					<CardContent className="min-w-0 space-y-5">
						{!preview.switchControlEnabled ? (
							<div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
								{t(
									"settings.slackSwitch.gateDisabledNotice",
									"Organization-owned Slack switching is not yet enabled for this organization. You can prepare, verify, and review impact now; activation unlocks once enabled for your organization.",
								)}
							</div>
						) : null}

						<div
							ref={summaryRef}
							tabIndex={-1}
							aria-labelledby={summaryHeadingId}
							className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4 focus:outline-none focus:ring-2 focus:ring-ring"
						>
							<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
								<h3 id={summaryHeadingId} className="text-sm font-semibold">
									{t("settings.slackSwitch.summaryHeading", "Switch impact summary")}
								</h3>
								<span className="text-xs text-muted-foreground">
									{t("settings.slackSwitch.generatedAt", "Snapshot: {timestamp}", {
										timestamp: preview.generatedAt,
									})}
								</span>
							</div>

							{impactChangedNotice ? (
								<div
									role="alert"
									className="flex min-w-0 items-start gap-2 rounded-md border border-warning/60 bg-warning/10 p-3 text-sm"
								>
									<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
									<p className="min-w-0 break-words">{impactChangedNotice}</p>
								</div>
							) : null}

							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								<MetricTile
									label={t("settings.slackSwitch.metrics.verifiedReachable", "Verified reachable")}
									value={preview.employeeImpact.verifiedReachableEmployees}
									hint={t(
										"settings.slackSwitch.metrics.verifiedReachableHint",
										"Direct messages confirmed with replacement app",
									)}
								/>
								<MetricTile
									label={t("settings.slackSwitch.metrics.actionNeeded", "Employee action needed")}
									value={preview.employeeImpact.actionNeededEmployees}
									hint={t(
										"settings.slackSwitch.metrics.actionNeededHint",
										"Must link or reopen DM in Settings → Notifications",
									)}
								/>
								<MetricTile
									label={t(
										"settings.slackSwitch.metrics.unknownReachability",
										"Unknown reachability",
									)}
									value={preview.employeeImpact.unknownReachabilityEmployees}
									hint={
										preview.employeeImpact.carryForwardIdentityEmployees > 0
											? t(
													"settings.slackSwitch.metrics.carryForwardHint",
													"{count} same-workspace identities carry forward; DM reachability verified on first use",
													{
														count: String(preview.employeeImpact.carryForwardIdentityEmployees),
													},
												)
											: t(
													"settings.slackSwitch.metrics.unknownReachabilityHint",
													"Linked identity whose replacement DM has not been verified yet",
												)
									}
								/>
								<MetricTile
									label={t(
										"settings.slackSwitch.metrics.outstandingApprovals",
										"Outstanding approval cards",
									)}
									value={
										preview.approvalImpact.openCanonicalCards +
										preview.approvalImpact.openLegacyOwnerCards +
										preview.approvalImpact.pendingLegacyCards
									}
									hint={t(
										"settings.slackSwitch.metrics.outstandingApprovalsHint",
										"{refresh} refresh jobs queued; old cards keep their Z8 review links",
										{ refresh: String(preview.approvalImpact.outstandingRefreshWork) },
									)}
								/>
								<MetricTile
									label={t(
										"settings.slackSwitch.metrics.inFlightNotifications",
										"In-flight notifications",
									)}
									value={preview.inFlightNotificationImpact.total}
									hint={t(
										"settings.slackSwitch.metrics.inFlightNotificationsHint",
										"Bound to their original installation without duplicate resends",
									)}
								/>
							</div>
						</div>

						{preview.requiresUnreadyAcknowledgement ? (
							<div className="flex min-w-0 items-start gap-3 rounded-lg border bg-background p-3">
								<input
									id={ackCheckboxId}
									type="checkbox"
									checked={acknowledgedUnready}
									onChange={(event) => setAcknowledgedUnready(event.target.checked)}
									disabled={confirmMutation.isPending || !preview.canConfirm}
									className="mt-1 size-4 shrink-0 rounded border-input"
								/>
								<Label
									htmlFor={ackCheckboxId}
									className="min-w-0 cursor-pointer text-sm leading-snug"
								>
									{t(
										"settings.slackSwitch.acknowledgeUnready",
										"I understand that {count} active employees still need to connect or verify direct messages with the replacement Slack app, and I want to switch now.",
										{ count: String(preview.employeeImpact.unreadyEmployees) },
									)}
								</Label>
							</div>
						) : null}

						{errorMessage ? (
							<p role="alert" className="text-sm text-destructive">
								{errorMessage}
							</p>
						) : null}

						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<p className="text-xs text-muted-foreground">
								{preview.candidateReady
									? t(
											"settings.slackSwitch.readyToConfirmHint",
											"New Slack notifications, commands, and digests will use your organization-owned Slack app immediately after switching.",
										)
									: t(
											"settings.slackSwitch.completeVerificationFirst",
											"Complete all candidate verification steps above before confirming the switch.",
										)}
							</p>
							<Button
								type="button"
								disabled={!canSubmitSwitch}
								onClick={handleConfirm}
								className="w-full shrink-0 sm:w-auto"
							>
								{confirmMutation.isPending ? (
									<IconLoader2
										className="mr-2 size-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								) : (
									<IconShieldCheck className="mr-2 size-4" aria-hidden="true" />
								)}
								{t("settings.slackSwitch.confirmButton", "Confirm switch to verified Slack app")}
							</Button>
						</div>
					</CardContent>
				</Card>
			) : null}

			{hasRetiring ? (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<IconClock className="size-4 shrink-0" aria-hidden="true" />
							{t("settings.slackSwitch.retirement.title", "Retiring Slack installations")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.slackSwitch.retirement.description",
								"Retiring installations continue refreshing their existing approval cards until all open cards settle or the 30-day limit is reached. Pending approvals always remain available in the Z8 inbox.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="min-w-0 space-y-3">
						<ul className="space-y-3">
							{preview.retiringInstallations.map((retiring) => (
								<li
									key={retiring.id}
									className="min-w-0 space-y-2 rounded-lg border bg-background p-3"
								>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
										<div className="min-w-0">
											<p className="break-words text-sm font-medium">
												{retiring.externalSpaceName ??
													retiring.externalDisplayName ??
													retiring.externalAppId ??
													t("settings.slackSwitch.retirement.previousApp", "Previous Slack app")}
											</p>
											<p className="text-xs text-muted-foreground">
												{retiring.retirementDeadlineAt
													? t(
															"settings.slackSwitch.retirement.deadline",
															"Automatic retirement deadline: {deadline}",
															{ deadline: retiring.retirementDeadlineAt },
														)
													: t(
															"settings.slackSwitch.retirement.noDeadline",
															"Retiring when open cards settle",
														)}
											</p>
										</div>
										<Badge variant="outline" className="w-fit shrink-0 gap-1">
											{retiring.totalOutstandingCardsAndWork === 0 ? (
												<IconCheck className="size-3.5" aria-hidden="true" />
											) : (
												<IconClock className="size-3.5" aria-hidden="true" />
											)}
											{t(
												"settings.slackSwitch.retirement.outstandingCount",
												"{count} open cards / jobs",
												{ count: String(retiring.totalOutstandingCardsAndWork) },
											)}
										</Badge>
									</div>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
