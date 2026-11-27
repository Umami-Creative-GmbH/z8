"use client";

import {
	IconAlertTriangle,
	IconBrandDiscord,
	IconBrandSlack,
	IconBrandTeams,
	IconBrandTelegram,
	IconCheck,
	IconHelpCircle,
	IconLoader2,
	IconPlugConnectedX,
	IconRefresh,
	IconShieldCheck,
	IconShieldLock,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
	ChatCredentialSource,
	ChatEffectiveSettingField,
	ChatInstallationProvider,
	ChatInstallationSummary,
	ChatMigrationBlocker,
	ChatProviderInventory,
	ChatVerificationState,
	LegacyTeamsTenantInventoryItem,
	TeamsSettingsDisagreement,
} from "@/lib/chat-installations/types";
import type { ServerActionResult } from "@/lib/effect/result";

type TranslateFn = ReturnType<typeof useTranslate>["t"];

export interface ChatInstallationInventoryCardProps {
	provider: ChatInstallationProvider;
	channelName: string;
	initialInventory: ChatProviderInventory | null;
	initialLoadFailed?: boolean;
	retryAction: () => Promise<ServerActionResult<ChatProviderInventory>>;
}

function ProviderIcon({ provider }: { provider: ChatInstallationProvider }) {
	switch (provider) {
		case "slack":
			return <IconBrandSlack className="size-4 shrink-0" aria-hidden="true" />;
		case "teams":
			return <IconBrandTeams className="size-4 shrink-0" aria-hidden="true" />;
		case "telegram":
			return <IconBrandTelegram className="size-4 shrink-0" aria-hidden="true" />;
		case "discord":
			return <IconBrandDiscord className="size-4 shrink-0" aria-hidden="true" />;
	}
}

function credentialSourceLabel(source: ChatCredentialSource, t: TranslateFn): string {
	return source === "organization_owned"
		? t("settings.chatInstallations.credentialSource.organizationOwned", "Organization-owned")
		: t("settings.chatInstallations.credentialSource.deploymentManaged", "Deployment-managed");
}

function verificationStateLabel(
	state: ChatVerificationState,
	isLegacy: boolean,
	t: TranslateFn,
): string {
	switch (state) {
		case "verified":
			return t("settings.chatInstallations.verification.verified", "Verified");
		case "pending":
			return t("settings.chatInstallations.verification.pending", "Verification pending");
		case "failed":
			return t("settings.chatInstallations.verification.failed", "Verification failed");
		case "expired":
			return t("settings.chatInstallations.verification.expired", "Verification expired");
		case "unverified":
			return isLegacy
				? t("settings.chatInstallations.verification.unverifiedLegacy", "Unverified (legacy)")
				: t("settings.chatInstallations.verification.unverified", "Unverified");
	}
}

function settingFieldLabel(field: ChatEffectiveSettingField, t: TranslateFn): string {
	switch (field) {
		case "enableApprovals":
			return t("settings.chatInstallations.teams.fields.enableApprovals", "Approval notifications");
		case "enableCommands":
			return t("settings.chatInstallations.teams.fields.enableCommands", "Commands");
		case "enableDailyDigest":
			return t("settings.chatInstallations.teams.fields.enableDailyDigest", "Daily digest");
		case "enableEscalations":
			return t("settings.chatInstallations.teams.fields.enableEscalations", "Escalations");
		case "digestTime":
			return t("settings.chatInstallations.teams.fields.digestTime", "Digest time");
		case "digestTimezone":
			return t("settings.chatInstallations.teams.fields.digestTimezone", "Digest timezone");
		case "escalationTimeoutHours":
			return t(
				"settings.chatInstallations.teams.fields.escalationTimeoutHours",
				"Escalation timeout",
			);
	}
}

function formatSettingValue(
	field: ChatEffectiveSettingField,
	value: boolean | string | number,
	t: TranslateFn,
): string {
	if (typeof value === "boolean") {
		return value
			? t("settings.chatInstallations.values.enabled", "Enabled")
			: t("settings.chatInstallations.values.disabled", "Disabled");
	}
	if (field === "escalationTimeoutHours") {
		return t("settings.chatInstallations.values.hours", "{hours} h", { hours: String(value) });
	}
	return String(value);
}

function blockerCopy(
	blocker: ChatMigrationBlocker,
	t: TranslateFn,
): { title: string; nextAction: string } {
	switch (blocker.code) {
		case "duplicate_external_identity":
			return {
				title: t(
					"settings.chatInstallations.blockers.duplicateIdentity.title",
					"Duplicate external app or bot identity",
				),
				nextAction: t(
					"settings.chatInstallations.blockers.duplicateIdentity.nextAction",
					"Disconnect or replace the duplicate external bot so only one organization claims this app before switching.",
				),
			};
		case "unknown_bot_identity":
			return {
				title: blocker.missingField
					? t(
							"settings.chatInstallations.blockers.unknownBotIdentityField.title",
							"Unknown bot identity ({field} missing)",
							{ field: blocker.missingField },
						)
					: t(
							"settings.chatInstallations.blockers.unknownBotIdentity.title",
							"Unknown bot identity",
						),
				nextAction: t(
					"settings.chatInstallations.blockers.unknownBotIdentity.nextAction",
					"Verify the external bot credentials and metadata before attempting a replacement or endpoint change.",
				),
			};
		case "unexpected_legacy_status":
			return {
				title: t(
					"settings.chatInstallations.blockers.unexpectedLegacyStatus.title",
					"Unexpected historical status: {status}",
					{ status: blocker.legacyStatus ?? "unknown" },
				),
				nextAction: t(
					"settings.chatInstallations.blockers.unexpectedLegacyStatus.nextAction",
					"Review this historical connection and confirm whether it should be retired or reconnected before switching.",
				),
			};
		case "secret_store_unavailable":
			return {
				title: t(
					"settings.chatInstallations.blockers.secretStoreUnavailable.title",
					"Secret store temporarily unavailable",
				),
				nextAction: t(
					"settings.chatInstallations.blockers.secretStoreUnavailable.nextAction",
					"Retry once the organization secret store is reachable. Existing configuration has not been altered.",
				),
			};
		case "teams_tenant_settings_disagreement":
			return {
				title: t(
					"settings.chatInstallations.blockers.teamsDisagreement.title",
					"Settings disagree across legacy Teams tenants",
				),
				nextAction: t(
					"settings.chatInstallations.blockers.teamsDisagreement.nextAction",
					"Review the differing tenant settings below and confirm the target settings for your organization-owned Teams app.",
				),
			};
	}
}

function InstallationIdentityRow({
	installation,
	t,
}: {
	installation: ChatInstallationSummary;
	t: TranslateFn;
}) {
	const isLegacy = installation.legacyTable !== null;
	const displayLabel =
		installation.externalDisplayName ??
		installation.externalSpaceName ??
		(installation.externalBotUsername ? `@${installation.externalBotUsername}` : null) ??
		installation.externalSpaceId ??
		installation.externalAppId ??
		t("settings.chatInstallations.identity.unidentified", "Unidentified installation");

	const evidenceParts: string[] = [];
	if (installation.lastVerifiedAt) {
		evidenceParts.push(
			t("settings.chatInstallations.evidence.lastVerified", "Last verified: {timestamp}", {
				timestamp: installation.lastVerifiedAt,
			}),
		);
	} else if (installation.verificationEvidence?.configuredAt) {
		evidenceParts.push(
			t("settings.chatInstallations.evidence.configuredAt", "Configured: {timestamp}", {
				timestamp: installation.verificationEvidence.configuredAt,
			}),
		);
	} else {
		evidenceParts.push(
			t(
				"settings.chatInstallations.evidence.noneRecorded",
				"No verification timestamp recorded yet.",
			),
		);
	}

	if (installation.verificationEvidence?.webhookRegistered !== undefined) {
		evidenceParts.push(
			installation.verificationEvidence.webhookRegistered
				? t("settings.chatInstallations.evidence.webhookRegistered", "Webhook registered")
				: t("settings.chatInstallations.evidence.webhookNotRegistered", "Webhook not registered"),
		);
	}
	if (installation.verificationEvidence?.interactionEndpointConfigured !== undefined) {
		evidenceParts.push(
			installation.verificationEvidence.interactionEndpointConfigured
				? t(
						"settings.chatInstallations.evidence.interactionEndpointReady",
						"Interaction endpoint configured",
					)
				: t(
						"settings.chatInstallations.evidence.interactionEndpointPending",
						"Interaction endpoint not confirmed",
					),
		);
	}
	if (installation.verificationEvidence?.serviceUrlRecorded !== undefined) {
		evidenceParts.push(
			installation.verificationEvidence.serviceUrlRecorded
				? t("settings.chatInstallations.evidence.serviceUrlRecorded", "Service URL recorded")
				: t("settings.chatInstallations.evidence.serviceUrlMissing", "No service URL recorded yet"),
		);
	}
	if (installation.verificationEvidence?.secretStoreStatus === "missing") {
		evidenceParts.push(
			t(
				"settings.chatInstallations.evidence.secretMissing",
				"Stored credential missing from secret store",
			),
		);
	} else if (installation.verificationEvidence?.secretStoreStatus === "unavailable") {
		evidenceParts.push(
			t(
				"settings.chatInstallations.evidence.secretStoreUnavailable",
				"Secret store unavailable during check",
			),
		);
	}

	return (
		<div className="min-w-0 space-y-2 rounded-lg border bg-muted/20 p-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-1">
					<p className="break-words text-sm font-medium">{displayLabel}</p>
					<div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
						{installation.externalSpaceId ? (
							<span className="break-all font-mono">
								{t("settings.chatInstallations.identity.spaceId", "Workspace / Tenant: {id}", {
									id: installation.externalSpaceId,
								})}
							</span>
						) : null}
						{installation.externalAppId ? (
							<span className="break-all font-mono">
								{t("settings.chatInstallations.identity.appId", "App ID: {id}", {
									id: installation.externalAppId,
								})}
							</span>
						) : null}
						{installation.externalBotId &&
						installation.externalBotId !== installation.externalAppId ? (
							<span className="break-all font-mono">
								{t("settings.chatInstallations.identity.botId", "Bot ID: {id}", {
									id: installation.externalBotId,
								})}
							</span>
						) : null}
						{installation.externalBotUsername ? (
							<span className="break-all font-mono">@{installation.externalBotUsername}</span>
						) : null}
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant="outline" className="gap-1">
						{installation.credentialSource === "organization_owned" ? (
							<IconShieldCheck className="size-3.5" aria-hidden="true" />
						) : (
							<IconShieldLock className="size-3.5" aria-hidden="true" />
						)}
						{credentialSourceLabel(installation.credentialSource, t)}
					</Badge>
					<Badge variant={installation.verificationState === "verified" ? "default" : "secondary"}>
						{verificationStateLabel(installation.verificationState, isLegacy, t)}
					</Badge>
				</div>
			</div>
			<p className="break-words text-xs text-muted-foreground">{evidenceParts.join(" · ")}</p>
		</div>
	);
}

function TeamsLegacyTenantsSection({
	tenants,
	disagreements,
	t,
}: {
	tenants: LegacyTeamsTenantInventoryItem[];
	disagreements: TeamsSettingsDisagreement[];
	t: TranslateFn;
}) {
	if (tenants.length === 0) return null;

	return (
		<div className="min-w-0 space-y-3 border-t pt-4">
			<div className="space-y-1">
				<h3 className="text-sm font-medium">
					{t(
						"settings.chatInstallations.teams.discoveredTenants",
						"Discovered legacy Teams tenants ({count})",
						{ count: tenants.length },
					)}
				</h3>
				<p className="text-xs text-muted-foreground">
					{t(
						"settings.chatInstallations.teams.discoveredTenantsDescription",
						"Every legacy Microsoft 365 tenant linked to this organization retains its effective settings until an organization-wide switch.",
					)}
				</p>
			</div>

			{disagreements.length > 0 ? (
				<div
					role="region"
					aria-label={t(
						"settings.chatInstallations.teams.disagreementsHeading",
						"Tenant settings disagreements",
					)}
					className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
				>
					<div className="flex items-start gap-2">
						<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
						<div className="min-w-0 space-y-1">
							<p className="font-medium">
								{t(
									"settings.chatInstallations.teams.disagreementsTitle",
									"Settings disagree across legacy Teams tenants",
								)}
							</p>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.chatInstallations.teams.disagreementsHelp",
									"Review these differences so you can confirm one set of replacement settings before switching.",
								)}
							</p>
						</div>
					</div>
					<ul className="space-y-1.5 pl-6 text-xs">
						{disagreements.map((disagreement) => (
							<li key={disagreement.field} className="break-words">
								<span className="font-medium">{settingFieldLabel(disagreement.field, t)}: </span>
								{disagreement.values
									.map(
										(entry) =>
											`${entry.tenantName ?? entry.tenantId}: ${formatSettingValue(disagreement.field, entry.value, t)}`,
									)
									.join(" · ")}
							</li>
						))}
					</ul>
				</div>
			) : null}

			<div className="space-y-2">
				{tenants.map((tenant) => (
					<div key={tenant.id} className="min-w-0 space-y-2 rounded-lg border bg-background p-3">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 space-y-0.5">
								<p className="break-words text-sm font-medium">
									{tenant.tenantName ?? tenant.tenantId}
								</p>
								<p className="break-all font-mono text-xs text-muted-foreground">
									{tenant.tenantId}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-1.5">
								<Badge variant={tenant.isUnexpectedStatus ? "destructive" : "secondary"}>
									{tenant.isUnexpectedStatus
										? t(
												"settings.chatInstallations.teams.unexpectedStatus",
												"Unexpected status: {status}",
												{ status: tenant.setupStatus },
											)
										: tenant.setupStatus}
								</Badge>
								<Badge variant="outline">{credentialSourceLabel(tenant.credentialSource, t)}</Badge>
							</div>
						</div>

						<dl className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
							<div className="min-w-0">
								<dt className="inline font-medium text-foreground">
									{t(
										"settings.chatInstallations.teams.fields.enableApprovals",
										"Approval notifications",
									)}
									:{" "}
								</dt>
								<dd className="inline">
									{formatSettingValue(
										"enableApprovals",
										tenant.effectiveSettings.enableApprovals,
										t,
									)}
								</dd>
							</div>
							<div className="min-w-0">
								<dt className="inline font-medium text-foreground">
									{t("settings.chatInstallations.teams.fields.enableCommands", "Commands")}:{" "}
								</dt>
								<dd className="inline">
									{formatSettingValue("enableCommands", tenant.effectiveSettings.enableCommands, t)}
								</dd>
							</div>
							<div className="min-w-0">
								<dt className="inline font-medium text-foreground">
									{t("settings.chatInstallations.teams.fields.enableDailyDigest", "Daily digest")}
									:{" "}
								</dt>
								<dd className="inline break-words">
									{formatSettingValue(
										"enableDailyDigest",
										tenant.effectiveSettings.enableDailyDigest,
										t,
									)}{" "}
									({tenant.effectiveSettings.digestTime} {tenant.effectiveSettings.digestTimezone})
								</dd>
							</div>
							<div className="min-w-0">
								<dt className="inline font-medium text-foreground">
									{t("settings.chatInstallations.teams.fields.enableEscalations", "Escalations")}
									:{" "}
								</dt>
								<dd className="inline">
									{formatSettingValue(
										"enableEscalations",
										tenant.effectiveSettings.enableEscalations,
										t,
									)}{" "}
									(
									{formatSettingValue(
										"escalationTimeoutHours",
										tenant.effectiveSettings.escalationTimeoutHours,
										t,
									)}
									)
								</dd>
							</div>
						</dl>
					</div>
				))}
			</div>
		</div>
	);
}

export function ChatInstallationInventoryCard({
	provider,
	channelName,
	initialInventory,
	initialLoadFailed = false,
	retryAction,
}: ChatInstallationInventoryCardProps) {
	const { t } = useTranslate();
	const [override, setOverride] = useState<{
		baseInventory: ChatProviderInventory | null;
		baseLoadFailed: boolean;
		inventory: ChatProviderInventory | null;
		loadFailed: boolean;
	} | null>(null);
	const [announcement, setAnnouncement] = useState<string>("");

	const matchesBase =
		override !== null &&
		override.baseInventory === initialInventory &&
		override.baseLoadFailed === initialLoadFailed;
	const inventory = matchesBase ? override.inventory : initialInventory;
	const loadFailed = matchesBase ? override.loadFailed : initialLoadFailed;

	const retryMutation = useMutation({
		mutationFn: () => retryAction(),
		onMutate: () => {
			setAnnouncement(
				t("settings.chatInstallations.retrying", "Reloading {channelName} installation status…", {
					channelName,
				}),
			);
		},
		onSuccess: (result) => {
			if (result.success) {
				setOverride({
					baseInventory: initialInventory,
					baseLoadFailed: initialLoadFailed,
					inventory: result.data,
					loadFailed: false,
				});
				setAnnouncement(
					t("settings.chatInstallations.reloaded", "{channelName} installation status updated.", {
						channelName,
					}),
				);
			} else {
				setOverride({
					baseInventory: initialInventory,
					baseLoadFailed: initialLoadFailed,
					inventory,
					loadFailed: true,
				});
				setAnnouncement(
					t(
						"settings.chatInstallations.loadErrorTitle",
						"Could not load {channelName} installation",
						{ channelName },
					),
				);
			}
		},
		onError: () => {
			setOverride({
				baseInventory: initialInventory,
				baseLoadFailed: initialLoadFailed,
				inventory,
				loadFailed: true,
			});
			setAnnouncement(
				t(
					"settings.chatInstallations.loadErrorTitle",
					"Could not load {channelName} installation",
					{ channelName },
				),
			);
		},
	});

	if (loadFailed || !inventory) {
		return (
			<Card className="border-destructive/50">
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0 space-y-1">
							<CardTitle className="flex items-center gap-2 text-base">
								<IconAlertTriangle
									className="size-4 shrink-0 text-destructive"
									aria-hidden="true"
								/>
								{t(
									"settings.chatInstallations.loadErrorTitle",
									"Could not load {channelName} installation",
									{ channelName },
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.chatInstallations.loadErrorDescription",
									"The current installation status could not be loaded. Existing delivery is unchanged.",
								)}
							</CardDescription>
						</div>
						<Badge variant="destructive" className="w-fit shrink-0">
							{t("settings.chatInstallations.state.loadFailed", "Load failed")}
						</Badge>
					</div>
				</CardHeader>
				<CardContent className="space-y-3">
					<p role="alert" className="text-sm text-destructive">
						{t(
							"settings.chatInstallations.loadErrorActionHint",
							"Retry loading to inspect credential ownership, verification evidence, and migration blockers.",
						)}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={retryMutation.isPending}
						onClick={() => retryMutation.mutate()}
					>
						{retryMutation.isPending ? (
							<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("settings.chatInstallations.retry", "Retry")}
					</Button>
					<p className="sr-only" aria-live="polite" aria-atomic="true">
						{announcement}
					</p>
				</CardContent>
			</Card>
		);
	}

	const {
		connectionState,
		blockers,
		currentInstallations,
		teamsTenants,
		teamsSettingsDisagreements,
	} = inventory;

	const hardBlockers = blockers.filter((b) => b.blocksSwitchAndEndpointMutation);

	const stateBadge = (() => {
		switch (connectionState) {
			case "remediation_required":
				return (
					<Badge variant="destructive" className="w-fit shrink-0 gap-1">
						<IconAlertTriangle className="size-3.5" aria-hidden="true" />
						{t("settings.chatInstallations.state.remediationRequired", "Remediation required")}
					</Badge>
				);
			case "unknown_readiness":
				return (
					<Badge variant="outline" className="w-fit shrink-0 gap-1 border-warning/60 text-warning">
						<IconHelpCircle className="size-3.5" aria-hidden="true" />
						{t("settings.chatInstallations.state.unknownReadiness", "Readiness unknown")}
					</Badge>
				);
			case "disconnected":
				return (
					<Badge variant="secondary" className="w-fit shrink-0 gap-1">
						<IconPlugConnectedX className="size-3.5" aria-hidden="true" />
						{t("settings.chatInstallations.state.disconnected", "Disconnected")}
					</Badge>
				);
			case "connected":
				return (
					<Badge variant="default" className="w-fit shrink-0 gap-1">
						<IconCheck className="size-3.5" aria-hidden="true" />
						{t("settings.chatInstallations.state.connected", "Connected")}
					</Badge>
				);
		}
	})();

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<CardTitle className="flex items-center gap-2 text-base">
							<ProviderIcon provider={provider} />
							{t("settings.chatInstallations.title", "Current {channelName} installation", {
								channelName,
							})}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.chatInstallations.description",
								"Inspect external app identity, credential ownership, verification evidence, and migration readiness before changing live delivery.",
							)}
						</CardDescription>
					</div>
					{stateBadge}
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{connectionState === "disconnected" ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.chatInstallations.disconnectedDescription",
							"No active {channelName} installation is connected for this organization.",
							{ channelName },
						)}
					</p>
				) : (
					<div className="space-y-3">
						{currentInstallations.map((installation) => (
							<InstallationIdentityRow key={installation.id} installation={installation} t={t} />
						))}
					</div>
				)}

				{connectionState === "unknown_readiness" ? (
					<div
						role="status"
						className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 sm:flex-row sm:items-center sm:justify-between"
					>
						<div className="min-w-0 space-y-1">
							<p className="text-sm font-medium">
								{t(
									"settings.chatInstallations.unknownReadinessTitle",
									"Verification and credential readiness could not be confirmed",
								)}
							</p>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.chatInstallations.unknownReadinessDescription",
									"Check the organization secret store or deployment credentials and retry before replacing this installation.",
								)}
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="w-fit shrink-0"
							disabled={retryMutation.isPending}
							onClick={() => retryMutation.mutate()}
						>
							{retryMutation.isPending ? (
								<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
							) : (
								<IconRefresh className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("settings.chatInstallations.retry", "Retry")}
						</Button>
					</div>
				) : null}

				{hardBlockers.length > 0 ? (
					<div
						role="region"
						aria-label={t("settings.chatInstallations.blockers.heading", "Migration blockers")}
						className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
					>
						<div className="space-y-1">
							<p className="text-sm font-medium text-destructive">
								{t("settings.chatInstallations.blockers.heading", "Migration blockers")}
							</p>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.chatInstallations.blockers.trafficPreserved",
									"Replacement and endpoint changes are blocked until resolved. Current traffic continues on its existing route.",
								)}
							</p>
						</div>
						<ul className="space-y-2">
							{hardBlockers.map((blocker, index) => {
								const copy = blockerCopy(blocker, t);
								return (
									<li
										key={`${blocker.code}-${blocker.installationId ?? index}`}
										className="min-w-0 space-y-1 rounded-md border bg-background p-2.5 text-xs"
									>
										<p className="break-words font-medium text-foreground">
											{copy.title}
											{blocker.externalLabel ? ` — ${blocker.externalLabel}` : ""}
										</p>
										<p className="break-words text-muted-foreground">
											<span className="font-medium text-foreground">
												{t(
													"settings.chatInstallations.blockers.nextActionLabel",
													"Next action:",
												)}{" "}
											</span>
											{copy.nextAction}
										</p>
									</li>
								);
							})}
						</ul>
					</div>
				) : null}

				{provider === "teams" ? (
					<TeamsLegacyTenantsSection
						tenants={teamsTenants}
						disagreements={teamsSettingsDisagreements}
						t={t}
					/>
				) : null}

				<p className="sr-only" aria-live="polite" aria-atomic="true">
					{announcement}
				</p>
			</CardContent>
		</Card>
	);
}
