"use client";

import {
	IconAlertTriangle,
	IconArrowsExchange,
	IconCheck,
	IconClock,
	IconHistory,
	IconKey,
	IconLoader2,
	IconRefresh,
	IconRotateClockwise,
	IconShieldCheck,
	IconShieldOff,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	ConfirmedTeamsSwitchData,
	ConfirmTeamsSwitchActionInput,
	PreparedTeamsRestoreData,
	PrepareTeamsRestoreActionInput,
	RevokedTeamsTenantData,
	RevokeTeamsTenantActionInput,
	RotatedTeamsCredentialsData,
	RotateTeamsCredentialsActionInput,
	VerifiedTeamsRestoreData,
	VerifyTeamsRestoreActionInput,
} from "@/app/[locale]/(app)/settings/notification-channels/teams-switch-actions";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TimeInput } from "@/components/ui/time-input";
import type { TeamsSwitchImpactPreview } from "@/lib/chat-installations/teams-switch";
import type {
	ChatEffectiveSettingField,
	ChatEffectiveSettings,
} from "@/lib/chat-installations/types";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

const TEAMS_SWITCH_REFUSALS = {
	switch_not_enabled: [
		"settings.teamsSwitch.errors.switchNotEnabled",
		"Switching to an organization-owned Microsoft Teams app is not enabled for this organization yet.",
	],
	migration_blocked: [
		"settings.teamsSwitch.errors.migrationBlocked",
		"Resolve Microsoft Teams migration blockers before switching.",
	],
	candidate_not_found: [
		"settings.teamsSwitch.errors.candidateNotFound",
		"No candidate Microsoft Teams installation was found. Prepare and verify one first.",
	],
	already_switched: [
		"settings.teamsSwitch.errors.alreadySwitched",
		"This Microsoft Teams installation is already active.",
	],
	candidate_not_ready: [
		"settings.teamsSwitch.errors.candidateNotReady",
		"Complete all single-tenant Microsoft Teams verification steps before switching.",
	],
	candidate_verification_expired: [
		"settings.teamsSwitch.errors.candidateVerificationExpired",
		"Verification proofs for the candidate Teams app have expired. Re-verify before switching.",
	],
	impact_changed: [
		"settings.teamsSwitch.errors.impactChanged",
		"Affected Teams tenants, settings, revisions, or counts changed since your review. Review the updated summary and confirm again.",
	],
	unready_acknowledgement_required: [
		"settings.teamsSwitch.errors.unreadyAckRequired",
		"Acknowledge that some employees still need to connect or verify direct messages before switching.",
	],
	settings_confirmation_required: [
		"settings.teamsSwitch.errors.settingsConfirmationRequired",
		"Your legacy Teams tenants disagree on settings. Explicitly confirm the replacement settings below before switching.",
	],
	invalid_replacement_settings: [
		"settings.teamsSwitch.errors.invalidReplacementSettings",
		"Check the replacement Teams settings (time, timezone, and escalation timeout) and try again.",
	],
	endpoint_reconciliation_required: [
		"settings.teamsSwitch.errors.endpointReconciliationRequired",
		"Endpoint state is uncertain after cleanup timeout. Reconcile before activating.",
	],
	external_identity_mismatch: [
		"settings.teamsSwitch.errors.externalIdentityMismatch",
		"The provided Microsoft App ID or Entra Tenant ID does not match this Teams installation.",
	],
	invalid_credentials: [
		"settings.teamsSwitch.errors.invalidCredentials",
		"Check your Microsoft App ID, Entra Tenant ID, and Client Secret and try again.",
	],
	secret_store_unavailable: [
		"settings.teamsSwitch.errors.secretStoreUnavailable",
		"The organization secret store is currently unavailable. Existing connections remain unchanged.",
	],
	installation_not_found: [
		"settings.teamsSwitch.errors.installationNotFound",
		"The selected Microsoft Teams installation could not be found.",
	],
	missing_private_reachability: [
		"settings.teamsSwitch.errors.missingPrivateReachability",
		"Send a 1:1 personal message to this Teams bot first so Z8 can capture reachability before testing.",
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
	| "settings_confirmation_required"
	| "invalid_replacement_settings"
	| "endpoint_reconciliation_required"
	| "external_identity_mismatch"
	| "invalid_credentials"
	| "secret_store_unavailable"
	| "installation_not_found"
	| "missing_private_reachability"
>;

export interface TeamsSwitchReviewPanelProps {
	initialPreview: TeamsSwitchImpactPreview | null;
	refreshPreviewAction: () => Promise<ServerActionResult<TeamsSwitchImpactPreview>>;
	confirmSwitchAction: (
		input: ConfirmTeamsSwitchActionInput,
	) => Promise<ServerActionResult<ConfirmedTeamsSwitchData>>;
	revokeTenantAction: (
		input: RevokeTeamsTenantActionInput,
	) => Promise<ServerActionResult<RevokedTeamsTenantData>>;
	rotateCredentialsAction: (
		input: RotateTeamsCredentialsActionInput,
	) => Promise<ServerActionResult<RotatedTeamsCredentialsData>>;
	prepareRestoreAction: (
		input: PrepareTeamsRestoreActionInput,
	) => Promise<ServerActionResult<PreparedTeamsRestoreData>>;
	verifyRestoreAction: (
		input: VerifyTeamsRestoreActionInput,
	) => Promise<ServerActionResult<VerifiedTeamsRestoreData>>;
	confirmRestoreAction: (
		input: ConfirmTeamsSwitchActionInput,
	) => Promise<ServerActionResult<ConfirmedTeamsSwitchData>>;
}

function isTeamsPreviewPayload(value: unknown): value is TeamsSwitchImpactPreview {
	return (
		typeof value === "object" &&
		value !== null &&
		"impactDigest" in value &&
		"affectedTenants" in value &&
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

function formatSettingFieldLabel(
	field: ChatEffectiveSettingField,
	t: ReturnType<typeof useTranslate>["t"],
): string {
	switch (field) {
		case "enableApprovals":
			return t("settings.teamsSwitch.settingsField.enableApprovals", "Approvals");
		case "enableCommands":
			return t("settings.teamsSwitch.settingsField.enableCommands", "Bot commands");
		case "enableDailyDigest":
			return t("settings.teamsSwitch.settingsField.enableDailyDigest", "Daily digest");
		case "enableEscalations":
			return t("settings.teamsSwitch.settingsField.enableEscalations", "Escalations");
		case "digestTime":
			return t("settings.teamsSwitch.settingsField.digestTime", "Digest time");
		case "digestTimezone":
			return t("settings.teamsSwitch.settingsField.digestTimezone", "Digest timezone");
		case "escalationTimeoutHours":
			return t(
				"settings.teamsSwitch.settingsField.escalationTimeoutHours",
				"Escalation timeout (hours)",
			);
	}
}

export function TeamsSwitchReviewPanel({
	initialPreview,
	refreshPreviewAction,
	confirmSwitchAction,
	revokeTenantAction,
	rotateCredentialsAction,
	prepareRestoreAction,
	verifyRestoreAction,
	confirmRestoreAction,
}: TeamsSwitchReviewPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const idPrefix = useId();
	const summaryRef = useRef<HTMLDivElement | null>(null);

	const [preview, setPreview] = useState<TeamsSwitchImpactPreview | null>(initialPreview);
	const [acknowledgedUnready, setAcknowledgedUnready] = useState(false);
	const [confirmedDisagreements, setConfirmedDisagreements] = useState(false);
	const [impactChangedNotice, setImpactChangedNotice] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState<string>("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Per-tenant or active revocation confirmation dialog state
	const [revokeTarget, setRevokeTarget] = useState<{
		installationId: string;
		label: string;
		isOrgOwned: boolean;
	} | null>(null);

	// Rotation dialog state
	const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
	const [postRotationRevision, setPostRotationRevision] = useState<number | null>(null);

	// Restore verification state
	const [restorePassword, setRestorePassword] = useState("");

	const settingsForm = useForm({
		defaultValues: (initialPreview?.proposedReplacementSettings ?? {
			enableApprovals: true,
			enableCommands: true,
			enableDailyDigest: true,
			enableEscalations: true,
			digestTime: "08:00",
			digestTimezone: "UTC",
			escalationTimeoutHours: 24,
		}) satisfies ChatEffectiveSettings,
	});

	const currentFormSettings = useStore(settingsForm.store, (state) => state.values);

	const rotateForm = useForm({
		defaultValues: {
			microsoftAppId: initialPreview?.activeOrgOwnedInstallation?.externalAppId ?? "",
			microsoftTenantId: initialPreview?.activeOrgOwnedInstallation?.externalSpaceId ?? "",
			microsoftAppPassword: "",
		},
		onSubmit: async ({ value }) => {
			const active = preview?.activeOrgOwnedInstallation;
			if (!active) return;
			rotateMutation.mutate({
				installationId: active.id,
				microsoftAppId: value.microsoftAppId,
				microsoftTenantId: value.microsoftTenantId,
				microsoftAppPassword: value.microsoftAppPassword,
			});
		},
	});

	const announce = (message: string) => {
		setAnnouncement(message);
	};

	const syncPreviewSettings = (next: TeamsSwitchImpactPreview) => {
		setPreview(next);
		settingsForm.reset(next.proposedReplacementSettings);
		setAcknowledgedUnready(false);
		setConfirmedDisagreements(false);
	};

	const refreshMutation = useMutation({
		mutationFn: () => refreshPreviewAction(),
		onSuccess: (result) => {
			if (result.success) {
				syncPreviewSettings(result.data);
				setErrorMessage(null);
				setImpactChangedNotice(null);
				announce(
					t(
						"settings.teamsSwitch.refreshedAnnouncement",
						"Microsoft Teams switch impact refreshed.",
					),
				);
			} else {
				const msg = actionErrorMessage(t, result, TEAMS_SWITCH_REFUSALS, [
					"settings.teamsSwitch.errors.refreshFailed",
					"Could not refresh Microsoft Teams switch preview.",
				]);
				setErrorMessage(msg);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	const confirmMutation = useMutation({
		mutationFn: (input: { isRestore: boolean; payload: ConfirmTeamsSwitchActionInput }) =>
			input.isRestore ? confirmRestoreAction(input.payload) : confirmSwitchAction(input.payload),
		onSuccess: (result, variables) => {
			if (result.success) {
				syncPreviewSettings(result.data.preview);
				setImpactChangedNotice(null);
				setErrorMessage(null);
				const msg = variables.isRestore
					? t(
							"settings.teamsSwitch.restoredAnnouncement",
							"Verified Microsoft Teams app restored as active.",
						)
					: t(
							"settings.teamsSwitch.switchedAnnouncement",
							"Switched to your organization-owned Microsoft Teams app. All reviewed legacy tenants are now retiring.",
						);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}

			const freshPreview =
				result.details &&
				"preview" in result.details &&
				isTeamsPreviewPayload(result.details.preview)
					? result.details.preview
					: null;

			if (freshPreview) {
				syncPreviewSettings(freshPreview);
			}

			const msg = actionErrorMessage(t, result, TEAMS_SWITCH_REFUSALS, [
				"settings.teamsSwitch.errors.confirmFailed",
				"Could not switch Microsoft Teams installation.",
			]);

			if (result.refusal === "impact_changed") {
				setImpactChangedNotice(msg);
				setErrorMessage(null);
				announce(msg);
				queueMicrotask(() => {
					summaryRef.current?.focus();
				});
				return;
			}

			setErrorMessage(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const revokeMutation = useMutation({
		mutationFn: (input: RevokeTeamsTenantActionInput) => revokeTenantAction(input),
		onSuccess: (result) => {
			if (result.success) {
				syncPreviewSettings(result.data.preview);
				setRevokeTarget(null);
				setErrorMessage(null);
				const msg = t(
					"settings.teamsSwitch.revokedAnnouncement",
					"Selected Microsoft Teams installation revoked immediately. Other tenants and Z8 inbox approvals remain unaffected.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, TEAMS_SWITCH_REFUSALS, [
					"settings.teamsSwitch.errors.revokeFailed",
					"Could not revoke Microsoft Teams installation.",
				]);
				setErrorMessage(msg);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	const rotateMutation = useMutation({
		mutationFn: (input: RotateTeamsCredentialsActionInput) => rotateCredentialsAction(input),
		onSuccess: (result) => {
			if (result.success) {
				syncPreviewSettings(result.data.preview);
				setRotateDialogOpen(false);
				setPostRotationRevision(result.data.newRevisionNumber);
				rotateForm.setFieldValue("microsoftAppPassword", "");
				const msg = t(
					"settings.teamsSwitch.rotatedAnnouncement",
					"Microsoft Teams credentials rotated to revision v{revision}.",
					{ revision: String(result.data.newRevisionNumber) },
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, TEAMS_SWITCH_REFUSALS, [
					"settings.teamsSwitch.errors.rotateFailed",
					"Could not rotate Microsoft Teams credentials.",
				]);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	const prepareRestoreMutation = useMutation({
		mutationFn: (input: PrepareTeamsRestoreActionInput) => prepareRestoreAction(input),
		onSuccess: (result) => {
			if (result.success) {
				syncPreviewSettings(result.data.preview);
				setErrorMessage(null);
				const msg = t(
					"settings.teamsSwitch.restoreStartedAnnouncement",
					"Restore started. Verify credentials, inbound activity, and proactive private delivery before confirming.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, TEAMS_SWITCH_REFUSALS, [
					"settings.teamsSwitch.errors.prepareRestoreFailed",
					"Could not start restoring this Microsoft Teams installation.",
				]);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	const verifyRestoreMutation = useMutation({
		mutationFn: (input: VerifyTeamsRestoreActionInput) => verifyRestoreAction(input),
		onSuccess: (result) => {
			if (result.success) {
				syncPreviewSettings(result.data.preview);
				setRestorePassword("");
				const msg = result.data.readyForSwitch
					? t(
							"settings.teamsSwitch.restoreVerifiedReadyAnnouncement",
							"Restore verification passed. Review impact and confirm switch-back.",
						)
					: t(
							"settings.teamsSwitch.restoreVerifiedStepAnnouncement",
							"Restore credentials verified. Send a 1:1 message to the Teams bot and run the proactive test to complete verification.",
						);
				announce(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, TEAMS_SWITCH_REFUSALS, [
					"settings.teamsSwitch.errors.verifyRestoreFailed",
					"Could not verify Microsoft Teams restore.",
				]);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	if (!preview) {
		return null;
	}

	const candidate = preview.candidateInstallation;
	const isRestoreCandidate = Boolean(
		candidate &&
		preview.activeOrgOwnedInstallation === null &&
		preview.restorableInstallations.length === 0 &&
		candidate.status === "candidate",
	);
	const hasAffectedTenants = preview.affectedTenants.length > 0;
	const hasRetiringTenants = preview.retiringTenants.length > 0;
	const activeOrgOwned = preview.activeOrgOwnedInstallation;
	const hasRestorable = preview.restorableInstallations.length > 0;

	const ackCheckboxId = `${idPrefix}-ack-unready`;
	const confirmSettingsCheckboxId = `${idPrefix}-confirm-settings`;
	const summaryHeadingId = `${idPrefix}-teams-impact-heading`;

	const canSubmitSwitch =
		Boolean(candidate) &&
		preview.canConfirm &&
		!confirmMutation.isPending &&
		(!preview.requiresUnreadyAcknowledgement || acknowledgedUnready) &&
		(!preview.hasSettingsDisagreements || confirmedDisagreements);

	const handleConfirmSwitch = () => {
		if (!candidate) return;
		setErrorMessage(null);
		setImpactChangedNotice(null);
		confirmMutation.mutate({
			isRestore: isRestoreCandidate,
			payload: {
				candidateInstallationId: candidate.id,
				reviewedAffectedInstallationIds: preview.affectedTenants.map((t) => t.installationId),
				reviewedCandidateCredentialRevisionId: candidate.activeCredentialRevisionId,
				reviewedImpactDigest: preview.impactDigest,
				acknowledgeUnreadyEmployees: acknowledgedUnready,
				confirmedReplacementSettings: preview.hasSettingsDisagreements
					? currentFormSettings
					: currentFormSettings,
			},
		});
	};

	return (
		<div className="min-w-0 space-y-6">
			{/* Accessible live region for drift, revocation, rotation & restore updates */}
			<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
				{announcement}
			</div>

			{/* 1. Multi-Tenant Switch Impact Review & Atomic Cutover */}
			{candidate || hasAffectedTenants ? (
				<Card>
					<CardHeader>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 space-y-1">
								<CardTitle className="flex items-center gap-2 text-base">
									<IconArrowsExchange className="size-4 shrink-0" aria-hidden="true" />
									{t(
										"settings.teamsSwitch.title",
										"Review legacy Teams tenants & switch organization",
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.teamsSwitch.description",
										"Review every affected Microsoft Teams tenant, resolve any settings differences, and switch the organization in one atomic transaction while retiring tenants keep servicing their open approval cards.",
									)}
								</CardDescription>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Badge
									variant={preview.switchControlEnabled ? "default" : "secondary"}
									className="w-fit shrink-0"
								>
									{preview.switchControlEnabled
										? t("settings.teamsSwitch.gate.enabled", "Switch enabled")
										: t("settings.teamsSwitch.gate.disabled", "Switch gated")}
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
									{t("settings.teamsSwitch.refresh", "Refresh impact")}
								</Button>
							</div>
						</div>
					</CardHeader>

					<CardContent className="min-w-0 space-y-5">
						{!preview.switchControlEnabled ? (
							<div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
								{t(
									"settings.teamsSwitch.gateDisabledNotice",
									"Organization-owned Microsoft Teams switching is not yet enabled for this organization. You can review all affected tenants and verify your single-tenant app now; activation unlocks once enabled.",
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
									{t("settings.teamsSwitch.summaryHeading", "Multi-tenant switch impact summary")}
								</h3>
								<span className="text-xs text-muted-foreground">
									{t("settings.teamsSwitch.generatedAt", "Snapshot: {timestamp}", {
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

							{/* Enumerated Affected Live Teams Tenants with per-tenant Revoke */}
							<div className="space-y-2">
								<h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
									{t(
										"settings.teamsSwitch.affectedTenantsHeading",
										"Affected live Teams tenants ({count})",
										{
											count: String(preview.affectedTenants.length),
										},
									)}
								</h4>
								{preview.affectedTenants.length === 0 ? (
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.teamsSwitch.noLiveTenants",
											"No live legacy Teams tenants will be retired by this switch.",
										)}
									</p>
								) : (
									<ul className="space-y-2">
										{preview.affectedTenants.map((tenant) => (
											<li
												key={tenant.installationId}
												className="min-w-0 space-y-2 rounded-lg border bg-background p-3"
											>
												<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
													<div className="min-w-0 space-y-1">
														<div className="flex flex-wrap items-center gap-2">
															<p className="break-words text-sm font-medium">
																{tenant.tenantName ?? tenant.tenantId}
															</p>
															<Badge variant="outline" className="text-xs">
																{tenant.installationStatus}
															</Badge>
															<Badge variant="secondary" className="text-xs">
																{t(
																	"settings.teamsSwitch.tenantOpenCards",
																	"{count} open cards / jobs",
																	{ count: String(tenant.totalOutstandingCardsAndWork) },
																)}
															</Badge>
														</div>
														<p className="break-all font-mono text-xs text-muted-foreground">
															{tenant.tenantId}
														</p>
														<p className="text-xs text-muted-foreground">
															{t(
																"settings.teamsSwitch.tenantSettingsSummary",
																"Approvals: {approvals} · Commands: {commands} · Digest: {digest} ({time} {tz}) · Escalations: {escalations} ({hours}h)",
																{
																	approvals: tenant.effectiveSettings.enableApprovals
																		? "On"
																		: "Off",
																	commands: tenant.effectiveSettings.enableCommands ? "On" : "Off",
																	digest: tenant.effectiveSettings.enableDailyDigest ? "On" : "Off",
																	time: tenant.effectiveSettings.digestTime,
																	tz: tenant.effectiveSettings.digestTimezone,
																	escalations: tenant.effectiveSettings.enableEscalations
																		? "On"
																		: "Off",
																	hours: String(tenant.effectiveSettings.escalationTimeoutHours),
																},
															)}
														</p>
													</div>
													<Button
														type="button"
														variant="outline"
														size="sm"
														className="w-full shrink-0 text-destructive hover:text-destructive sm:w-auto"
														onClick={() =>
															setRevokeTarget({
																installationId: tenant.installationId,
																label: tenant.tenantName ?? tenant.tenantId,
																isOrgOwned: tenant.credentialSource === "organization_owned",
															})
														}
													>
														<IconShieldOff className="mr-1.5 size-4" aria-hidden="true" />
														{t("settings.teamsSwitch.revokeTenantButton", "Revoke tenant")}
													</Button>
												</div>
											</li>
										))}
									</ul>
								)}
							</div>

							{/* Reachability, Approvals, and In-Flight Metrics */}
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								<MetricTile
									label={t("settings.teamsSwitch.metrics.verifiedReachable", "Verified reachable")}
									value={preview.employeeImpact.verifiedReachableEmployees}
									hint={t(
										"settings.teamsSwitch.metrics.verifiedReachableHint",
										"Personal chats confirmed with new Teams app",
									)}
								/>
								<MetricTile
									label={t("settings.teamsSwitch.metrics.actionNeeded", "Employee action needed")}
									value={preview.employeeImpact.actionNeededEmployees}
									hint={t(
										"settings.teamsSwitch.metrics.actionNeededHint",
										"Must message bot or link in Settings → Notifications",
									)}
								/>
								<MetricTile
									label={t(
										"settings.teamsSwitch.metrics.unknownReachability",
										"Unknown reachability",
									)}
									value={preview.employeeImpact.unknownReachabilityEmployees}
									hint={
										preview.employeeImpact.carryForwardIdentityEmployees > 0
											? t(
													"settings.teamsSwitch.metrics.carryForwardHint",
													"{count} same-tenant Entra identities carry forward",
													{ count: String(preview.employeeImpact.carryForwardIdentityEmployees) },
												)
											: t(
													"settings.teamsSwitch.metrics.unknownReachabilityHint",
													"Linked identity whose personal chat is not yet verified",
												)
									}
								/>
								<MetricTile
									label={t(
										"settings.teamsSwitch.metrics.outstandingApprovals",
										"Total open approval cards",
									)}
									value={
										preview.approvalImpact.openCanonicalCards +
										preview.approvalImpact.openLegacyOwnerCards +
										preview.approvalImpact.pendingLegacyCards
									}
									hint={t(
										"settings.teamsSwitch.metrics.outstandingApprovalsHint",
										"Across all affected tenants; each retiring tenant services its own cards",
									)}
								/>
								<MetricTile
									label={t(
										"settings.teamsSwitch.metrics.inFlightNotifications",
										"In-flight notifications",
									)}
									value={preview.inFlightNotificationImpact.total}
									hint={t(
										"settings.teamsSwitch.metrics.inFlightNotificationsHint",
										"Bound to original installation without duplicate resends",
									)}
								/>
							</div>
						</div>

						{/* Settings Disagreements & Explicit Replacement Settings Confirmation (TanStack Form) */}
						{candidate && preview.hasSettingsDisagreements ? (
							<div className="min-w-0 space-y-4 rounded-lg border border-warning/60 bg-warning/5 p-4">
								<div className="flex items-start gap-2">
									<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
									<div className="min-w-0 space-y-1">
										<h4 className="text-sm font-semibold">
											{t(
												"settings.teamsSwitch.disagreements.heading",
												"Legacy Teams tenants have differing settings",
											)}
										</h4>
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.teamsSwitch.disagreements.description",
												"Review the differences below and confirm the single set of settings for your organization-owned Teams app.",
											)}
										</p>
									</div>
								</div>

								<ul className="space-y-2 text-xs">
									{preview.settingsDisagreements.map((disagreement) => (
										<li key={disagreement.field} className="rounded border bg-background p-2.5">
											<p className="font-medium">
												{formatSettingFieldLabel(disagreement.field, t)}
											</p>
											<div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
												{disagreement.values.map((entry) => (
													<span
														key={`${disagreement.field}-${entry.tenantId}`}
														className="break-words"
													>
														{entry.tenantName ?? entry.tenantId}:{" "}
														<strong className="text-foreground">{String(entry.value)}</strong>
													</span>
												))}
											</div>
										</li>
									))}
								</ul>

								<div className="grid gap-3 sm:grid-cols-2">
									<settingsForm.Field name="enableApprovals">
										{(field) => (
											<div className="flex items-center justify-between gap-2 rounded-md border bg-background p-3">
												<Label htmlFor={`${idPrefix}-rep-approvals`} className="text-sm">
													{t("settings.teamsSwitch.settingsField.enableApprovals", "Approvals")}
												</Label>
												<Switch
													id={`${idPrefix}-rep-approvals`}
													checked={field.state.value}
													onCheckedChange={(checked) => field.handleChange(checked)}
												/>
											</div>
										)}
									</settingsForm.Field>
									<settingsForm.Field name="enableCommands">
										{(field) => (
											<div className="flex items-center justify-between gap-2 rounded-md border bg-background p-3">
												<Label htmlFor={`${idPrefix}-rep-commands`} className="text-sm">
													{t("settings.teamsSwitch.settingsField.enableCommands", "Bot commands")}
												</Label>
												<Switch
													id={`${idPrefix}-rep-commands`}
													checked={field.state.value}
													onCheckedChange={(checked) => field.handleChange(checked)}
												/>
											</div>
										)}
									</settingsForm.Field>
									<settingsForm.Field name="enableDailyDigest">
										{(field) => (
											<div className="flex items-center justify-between gap-2 rounded-md border bg-background p-3">
												<Label htmlFor={`${idPrefix}-rep-digest`} className="text-sm">
													{t(
														"settings.teamsSwitch.settingsField.enableDailyDigest",
														"Daily digest",
													)}
												</Label>
												<Switch
													id={`${idPrefix}-rep-digest`}
													checked={field.state.value}
													onCheckedChange={(checked) => field.handleChange(checked)}
												/>
											</div>
										)}
									</settingsForm.Field>
									<settingsForm.Field name="enableEscalations">
										{(field) => (
											<div className="flex items-center justify-between gap-2 rounded-md border bg-background p-3">
												<Label htmlFor={`${idPrefix}-rep-escalations`} className="text-sm">
													{t("settings.teamsSwitch.settingsField.enableEscalations", "Escalations")}
												</Label>
												<Switch
													id={`${idPrefix}-rep-escalations`}
													checked={field.state.value}
													onCheckedChange={(checked) => field.handleChange(checked)}
												/>
											</div>
										)}
									</settingsForm.Field>
									<settingsForm.Field name="digestTime">
										{(field) => (
											<div className="space-y-1.5 rounded-md border bg-background p-3">
												<Label htmlFor={`${idPrefix}-rep-digest-time`} className="text-xs">
													{t("settings.teamsSwitch.settingsField.digestTime", "Digest time")}
												</Label>
												<TimeInput
													id={`${idPrefix}-rep-digest-time`}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
												/>
											</div>
										)}
									</settingsForm.Field>
									<settingsForm.Field name="digestTimezone">
										{(field) => (
											<div className="space-y-1.5 rounded-md border bg-background p-3">
												<Label htmlFor={`${idPrefix}-rep-digest-tz`} className="text-xs">
													{t(
														"settings.teamsSwitch.settingsField.digestTimezone",
														"Digest timezone",
													)}
												</Label>
												<TimezonePicker
													id={`${idPrefix}-rep-digest-tz`}
													value={field.state.value}
													onChange={(val) => field.handleChange(val)}
												/>
											</div>
										)}
									</settingsForm.Field>
									<settingsForm.Field name="escalationTimeoutHours">
										{(field) => (
											<div className="space-y-1.5 rounded-md border bg-background p-3 sm:col-span-2">
												<Label htmlFor={`${idPrefix}-rep-esc-hours`} className="text-xs">
													{t(
														"settings.teamsSwitch.settingsField.escalationTimeoutHours",
														"Escalation timeout (hours)",
													)}
												</Label>
												<Input
													id={`${idPrefix}-rep-esc-hours`}
													type="number"
													min={1}
													value={field.state.value}
													onChange={(e) =>
														field.handleChange(
															Math.max(1, Number.parseInt(e.target.value || "1", 10)),
														)
													}
												/>
											</div>
										)}
									</settingsForm.Field>
								</div>

								<div className="flex min-w-0 items-start gap-3 rounded-md border bg-background p-3">
									<input
										id={confirmSettingsCheckboxId}
										type="checkbox"
										checked={confirmedDisagreements}
										onChange={(event) => setConfirmedDisagreements(event.target.checked)}
										disabled={confirmMutation.isPending || !preview.canConfirm}
										className="mt-1 size-4 shrink-0 rounded border-input"
									/>
									<Label
										htmlFor={confirmSettingsCheckboxId}
										className="min-w-0 cursor-pointer text-sm leading-snug"
									>
										{t(
											"settings.teamsSwitch.disagreements.confirmCheckbox",
											"I confirm these replacement settings should become authoritative for Microsoft Teams across this organization.",
										)}
									</Label>
								</div>
							</div>
						) : null}

						{/* Unready employee acknowledgment */}
						{candidate && preview.requiresUnreadyAcknowledgement ? (
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
										"settings.teamsSwitch.acknowledgeUnready",
										"I understand that {count} active employees still need to connect or verify direct messages with the new Teams app, and I want to switch now.",
										{ count: String(preview.employeeImpact.unreadyEmployees) },
									)}
								</Label>
							</div>
						) : null}

						{/* Restore re-verification helper when candidate needs fresh verification */}
						{candidate && !preview.candidateReady && candidate.externalAppId ? (
							<div className="min-w-0 space-y-3 rounded-lg border bg-muted/30 p-3">
								<p className="text-xs text-muted-foreground">
									{t(
										"settings.teamsSwitch.restoreVerifyHint",
										"Need to re-verify credentials or trigger a fresh proactive private test for this candidate Teams app?",
									)}
								</p>
								<div className="flex flex-col gap-2 sm:flex-row">
									<Input
										type="password"
										autoComplete="new-password"
										placeholder={t(
											"settings.teamsSwitch.optionalAppPasswordPlaceholder",
											"Optional new Microsoft App Password (leave blank to reuse stored)",
										)}
										value={restorePassword}
										onChange={(e) => setRestorePassword(e.target.value)}
										className="min-w-0 flex-1"
									/>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={verifyRestoreMutation.isPending}
										onClick={() =>
											verifyRestoreMutation.mutate({
												installationId: candidate.id,
												microsoftAppId: candidate.externalAppId ?? undefined,
												microsoftTenantId: candidate.externalSpaceId ?? undefined,
												microsoftAppPassword: restorePassword.trim() || undefined,
												sendProactiveTest: true,
											})
										}
									>
										{verifyRestoreMutation.isPending ? (
											<IconLoader2
												className="mr-1.5 size-4 motion-safe:animate-spin"
												aria-hidden="true"
											/>
										) : (
											<IconRotateClockwise className="mr-1.5 size-4" aria-hidden="true" />
										)}
										{t("settings.teamsSwitch.verifyRestoreButton", "Re-verify & send test")}
									</Button>
								</div>
							</div>
						) : null}

						{errorMessage ? (
							<p role="alert" className="text-sm text-destructive">
								{errorMessage}
							</p>
						) : null}

						{candidate ? (
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<p className="text-xs text-muted-foreground">
									{preview.candidateReady
										? t(
												"settings.teamsSwitch.readyToConfirmHint",
												"New Teams notifications, approvals, commands, digests, and escalations will use your organization-owned Teams app immediately after switching.",
											)
										: t(
												"settings.teamsSwitch.completeVerificationFirst",
												"Complete all single-tenant Teams verification steps above before confirming the switch.",
											)}
								</p>
								<Button
									type="button"
									disabled={!canSubmitSwitch}
									onClick={handleConfirmSwitch}
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
									{t(
										"settings.teamsSwitch.confirmButton",
										"Switch all reviewed Teams tenants together",
									)}
								</Button>
							</div>
						) : null}
					</CardContent>
				</Card>
			) : null}

			{/* 2. Retiring Teams Tenants (per-tenant card counts, deadlines & revoke) */}
			{hasRetiringTenants ? (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<IconClock className="size-4 shrink-0" aria-hidden="true" />
							{t("settings.teamsSwitch.retirement.title", "Retiring Microsoft Teams tenants")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.teamsSwitch.retirement.description",
								"Each retiring Teams tenant continues servicing its own open approval cards until all cards settle or its 30-day deadline is reached. You can revoke any individual tenant immediately without affecting other tenants or your active Teams app.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="min-w-0 space-y-3">
						<ul className="space-y-3">
							{preview.retiringTenants.map((retiring) => (
								<li
									key={retiring.installationId}
									className="min-w-0 space-y-2 rounded-lg border bg-background p-3"
								>
									<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
										<div className="min-w-0 space-y-0.5">
											<p className="break-words text-sm font-medium">
												{retiring.tenantName ??
													retiring.tenantId ??
													t(
														"settings.teamsSwitch.retirement.previousTenant",
														"Previous Teams tenant",
													)}
											</p>
											{retiring.tenantId ? (
												<p className="break-all font-mono text-xs text-muted-foreground">
													{retiring.tenantId}
												</p>
											) : null}
											<p className="text-xs text-muted-foreground">
												{retiring.retirementDeadlineAt
													? t(
															"settings.teamsSwitch.retirement.deadline",
															"Automatic retirement deadline: {deadline}",
															{ deadline: retiring.retirementDeadlineAt },
														)
													: t(
															"settings.teamsSwitch.retirement.noDeadline",
															"Retiring when open cards settle",
														)}
											</p>
										</div>
										<div className="flex flex-wrap items-center gap-2">
											<Badge variant="outline" className="w-fit shrink-0 gap-1">
												{retiring.totalOutstandingCardsAndWork === 0 ? (
													<IconCheck className="size-3.5" aria-hidden="true" />
												) : (
													<IconClock className="size-3.5" aria-hidden="true" />
												)}
												{t(
													"settings.teamsSwitch.retirement.outstandingCount",
													"{count} open cards / jobs",
													{ count: String(retiring.totalOutstandingCardsAndWork) },
												)}
											</Badge>
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="text-destructive hover:text-destructive"
												onClick={() =>
													setRevokeTarget({
														installationId: retiring.installationId,
														label:
															retiring.tenantName ?? retiring.tenantId ?? retiring.installationId,
														isOrgOwned: retiring.credentialSource === "organization_owned",
													})
												}
											>
												<IconShieldOff className="mr-1.5 size-4" aria-hidden="true" />
												{t("settings.teamsSwitch.revokeTenantButton", "Revoke tenant")}
											</Button>
										</div>
									</div>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
			) : null}

			{/* 3. Active Org-Owned Teams Rotation, Revocation & Restore */}
			{activeOrgOwned || hasRestorable ? (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<IconKey className="size-4 shrink-0" aria-hidden="true" />
							{t(
								"settings.teamsSwitch.recovery.title",
								"Microsoft Teams credential rotation, revocation & restore",
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.teamsSwitch.recovery.description",
								"Rotate your single-tenant Entra client secret without downtime, revoke access immediately, or re-verify and restore a previous organization-owned Teams installation.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="min-w-0 space-y-5">
						{activeOrgOwned ? (
							<div className="min-w-0 space-y-3 rounded-lg border bg-background p-4">
								<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
									<div className="min-w-0 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<p className="break-words text-sm font-semibold">
												{activeOrgOwned.externalSpaceName ??
													activeOrgOwned.externalDisplayName ??
													activeOrgOwned.externalAppId}
											</p>
											<Badge variant="default">
												{t("settings.teamsSwitch.recovery.activeBadge", "Active org-owned")}
											</Badge>
										</div>
										<p className="break-all font-mono text-xs text-muted-foreground">
											App: {activeOrgOwned.externalAppId} · Tenant: {activeOrgOwned.externalSpaceId}
										</p>
									</div>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => {
												rotateForm.reset({
													microsoftAppId: activeOrgOwned.externalAppId ?? "",
													microsoftTenantId: activeOrgOwned.externalSpaceId ?? "",
													microsoftAppPassword: "",
												});
												setRotateDialogOpen(true);
											}}
										>
											<IconKey className="mr-1.5 size-4" aria-hidden="true" />
											{t("settings.teamsSwitch.recovery.rotateButton", "Rotate credentials")}
										</Button>
										<Button
											type="button"
											variant="destructive"
											size="sm"
											onClick={() =>
												setRevokeTarget({
													installationId: activeOrgOwned.id,
													label:
														activeOrgOwned.externalSpaceName ??
														activeOrgOwned.externalAppId ??
														"Microsoft Teams",
													isOrgOwned: true,
												})
											}
										>
											<IconShieldOff className="mr-1.5 size-4" aria-hidden="true" />
											{t("settings.teamsSwitch.recovery.revokeButton", "Revoke access immediately")}
										</Button>
									</div>
								</div>

								{postRotationRevision ? (
									<div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs">
										<p className="font-medium">
											{t(
												"settings.teamsSwitch.recovery.rotatedBanner",
												"Credentials rotated to revision v{revision}. Cached Teams adapters were evicted immediately.",
												{ revision: String(postRotationRevision) },
											)}
										</p>
									</div>
								) : null}

								<div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
									<p className="font-medium text-foreground">{preview.rotationGuidance.summary}</p>
									<p className="mt-1">{preview.rotationGuidance.interruptionDetails}</p>
								</div>
							</div>
						) : null}

						{hasRestorable ? (
							<div className="min-w-0 space-y-2">
								<h4 className="flex items-center gap-1.5 text-sm font-medium">
									<IconHistory className="size-4 shrink-0" aria-hidden="true" />
									{t(
										"settings.teamsSwitch.recovery.restorableHeading",
										"Previous organization-owned Teams installations",
									)}
								</h4>
								<ul className="space-y-2">
									{preview.restorableInstallations.map((inst) => (
										<li
											key={inst.id}
											className="flex flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
										>
											<div className="min-w-0 space-y-0.5">
												<div className="flex flex-wrap items-center gap-2">
													<p className="break-words text-sm font-medium">
														{inst.externalSpaceName ?? inst.externalAppId ?? inst.id}
													</p>
													<Badge variant="outline" className="text-xs">
														{inst.status}
													</Badge>
												</div>
												<p className="break-all font-mono text-xs text-muted-foreground">
													App: {inst.externalAppId} · Tenant: {inst.externalSpaceId}
												</p>
											</div>
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={prepareRestoreMutation.isPending}
												onClick={() => prepareRestoreMutation.mutate({ installationId: inst.id })}
											>
												{prepareRestoreMutation.isPending ? (
													<IconLoader2
														className="mr-1.5 size-4 motion-safe:animate-spin"
														aria-hidden="true"
													/>
												) : (
													<IconRotateClockwise className="mr-1.5 size-4" aria-hidden="true" />
												)}
												{t(
													"settings.teamsSwitch.recovery.startRestoreButton",
													"Start restore & verify",
												)}
											</Button>
										</li>
									))}
								</ul>
							</div>
						) : null}
					</CardContent>
				</Card>
			) : null}

			{/* Per-Tenant / Installation Revoke Confirmation Dialog */}
			<Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => !open && setRevokeTarget(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t("settings.teamsSwitch.revokeDialog.title", "Revoke Microsoft Teams installation?")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.teamsSwitch.revokeDialog.description",
								"Revoking {label} immediately ends local authorization for this installation only. Sibling retiring tenants, your active Teams app, shared deployment credentials, and pending approvals in the Z8 inbox remain untouched.",
								{ label: revokeTarget?.label ?? "" },
							)}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => setRevokeTarget(null)}
							disabled={revokeMutation.isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={!revokeTarget || revokeMutation.isPending}
							onClick={() => {
								if (!revokeTarget) return;
								revokeMutation.mutate({ installationId: revokeTarget.installationId });
							}}
						>
							{revokeMutation.isPending ? (
								<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
							) : (
								<IconShieldOff className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("settings.teamsSwitch.revokeDialog.confirm", "Confirm immediate revocation")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Same-App Credential Rotation Dialog */}
			<Dialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{t("settings.teamsSwitch.rotateDialog.title", "Rotate Microsoft Teams credentials")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.teamsSwitch.rotateDialog.description",
								"Enter the new Microsoft Entra client secret for the exact same Microsoft App ID and Entra Tenant ID. Conversations, employee links, and open approval cards are preserved.",
							)}
						</DialogDescription>
					</DialogHeader>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							rotateForm.handleSubmit();
						}}
						className="space-y-4"
					>
						<rotateForm.Field name="microsoftAppId">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor={`${idPrefix}-rot-app-id`}>
										{t("settings.teamsSwitch.rotateDialog.appId", "Microsoft App ID (GUID)")}
									</Label>
									<Input
										id={`${idPrefix}-rot-app-id`}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</rotateForm.Field>
						<rotateForm.Field name="microsoftTenantId">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor={`${idPrefix}-rot-tenant-id`}>
										{t(
											"settings.teamsSwitch.rotateDialog.tenantId",
											"Microsoft Entra Tenant ID (GUID)",
										)}
									</Label>
									<Input
										id={`${idPrefix}-rot-tenant-id`}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</rotateForm.Field>
						<rotateForm.Field name="microsoftAppPassword">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor={`${idPrefix}-rot-app-password`}>
										{t(
											"settings.teamsSwitch.rotateDialog.appPassword",
											"New Microsoft App Password (write-only)",
										)}
									</Label>
									<Input
										id={`${idPrefix}-rot-app-password`}
										type="password"
										autoComplete="new-password"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</rotateForm.Field>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setRotateDialogOpen(false)}
								disabled={rotateMutation.isPending}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={rotateMutation.isPending}>
								{rotateMutation.isPending ? (
									<IconLoader2
										className="mr-2 size-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								) : (
									<IconKey className="mr-2 size-4" aria-hidden="true" />
								)}
								{t("settings.teamsSwitch.rotateDialog.submit", "Verify identity & rotate")}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
