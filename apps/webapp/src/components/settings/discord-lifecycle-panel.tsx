"use client";

import {
	IconAlertTriangle,
	IconArrowsExchange,
	IconBrandDiscord,
	IconCheck,
	IconClock,
	IconCopy,
	IconKey,
	IconLoader2,
	IconPlugConnected,
	IconRefresh,
	IconRestore,
	IconSend,
	IconShieldCheck,
	IconShieldOff,
	IconTerminal2,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	ConfirmDiscordSwitchActionInput,
	ConfirmedDiscordSwitchData,
	DiscordLifecycleState,
	PreparedDiscordRestoreData,
	RevokeDiscordInstallationActionInput,
	RevokedDiscordInstallationData,
	RotateDiscordCredentialsActionInput,
	RotatedDiscordInstallationData,
	SaveDiscordCandidateCredentialsInput,
	SendDiscordPrivateTestInput,
} from "@/app/[locale]/(app)/settings/notification-channels/discord-lifecycle-actions";
import {
	ConfirmActionDialog,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";
import { describeFailure } from "@/components/settings/confirm-action-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
	DiscordVerificationStepStatus,
	DiscordVerificationStepView,
} from "@/lib/chat-installations/discord-setup";
import type { ChatSwitchImpactPreview } from "@/lib/chat-installations/switch-lifecycle";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

const DISCORD_LIFECYCLE_REFUSALS = {
	invalid_bot_token_format: [
		"settings.discordLifecycle.errors.invalidBotTokenFormat",
		"Enter a valid Discord bot token with no whitespace.",
	],
	invalid_application_id_format: [
		"settings.discordLifecycle.errors.invalidApplicationIdFormat",
		"Application ID must be a numeric Discord snowflake ID.",
	],
	invalid_public_key_format: [
		"settings.discordLifecycle.errors.invalidPublicKeyFormat",
		"Public key must be a 64-character hexadecimal Ed25519 key.",
	],
	invalid_bot_token: [
		"settings.discordLifecycle.errors.invalidBotToken",
		"Discord rejected the bot token. Check your bot credentials in the Discord Developer Portal.",
	],
	application_id_mismatch: [
		"settings.discordLifecycle.errors.applicationIdMismatch",
		"Application ID does not match the provided bot token.",
	],
	public_key_mismatch: [
		"settings.discordLifecycle.errors.publicKeyMismatch",
		"Public key does not match the Discord application.",
	],
	app_claimed_by_other_org: [
		"settings.discordLifecycle.errors.appClaimedByOtherOrg",
		"This Discord application is already claimed by another Z8 organization.",
	],
	discord_dm_blocked_50007: [
		"settings.discordLifecycle.errors.dmBlocked50007",
		"Discord blocked this direct message (error 50007). Share a server with the bot, unblock the bot, and enable server Direct Messages in Discord Privacy Settings, then retry.",
	],
	discord_missing_access: [
		"settings.discordLifecycle.errors.missingAccess50001",
		"The bot does not share a server with this Discord user (error 50001). Invite the bot to a shared server and retry.",
	],
	discord_unknown_user: [
		"settings.discordLifecycle.errors.unknownUser10013",
		"Discord could not find that user ID (error 10013). Copy your numeric User ID with Discord Developer Mode enabled.",
	],
	invalid_discord_user_id: [
		"settings.discordLifecycle.errors.invalidDiscordUserId",
		"Enter a valid numeric Discord user ID.",
	],
	switch_not_enabled: [
		"settings.discordLifecycle.errors.switchNotEnabled",
		"Switching to an organization-owned Discord bot is not yet enabled for this organization.",
	],
	migration_blocked: [
		"settings.discordLifecycle.errors.migrationBlocked",
		"Resolve migration blockers above before switching Discord bots.",
	],
	candidate_not_ready: [
		"settings.discordLifecycle.errors.candidateNotReady",
		"Complete application identity, signed interaction PING, and private DM verification before switching.",
	],
	candidate_verification_expired: [
		"settings.discordLifecycle.errors.candidateVerificationExpired",
		"Candidate verification proofs have expired. Re-verify before switching.",
	],
	impact_changed: [
		"settings.discordLifecycle.errors.impactChanged",
		"Switch impact or installation revisions changed since you reviewed them. Review the updated summary and confirm again.",
	],
	unready_acknowledgement_required: [
		"settings.discordLifecycle.errors.unreadyAckRequired",
		"Acknowledge that some employees still need to connect or verify Discord DMs before switching.",
	],
	external_identity_mismatch: [
		"settings.discordLifecycle.errors.rotationIdentityMismatch",
		"The provided token belongs to a different Discord application. Credential rotation requires the exact same Discord application.",
	],
} satisfies RefusalMessages<
	| "invalid_bot_token_format"
	| "invalid_application_id_format"
	| "invalid_public_key_format"
	| "invalid_bot_token"
	| "application_id_mismatch"
	| "public_key_mismatch"
	| "app_claimed_by_other_org"
	| "discord_dm_blocked_50007"
	| "discord_missing_access"
	| "discord_unknown_user"
	| "invalid_discord_user_id"
	| "switch_not_enabled"
	| "migration_blocked"
	| "candidate_not_ready"
	| "candidate_verification_expired"
	| "impact_changed"
	| "unready_acknowledgement_required"
	| "external_identity_mismatch"
>;

export interface DiscordLifecyclePanelProps {
	initialState: DiscordLifecycleState | null;
	refreshAction: () => Promise<ServerActionResult<DiscordLifecycleState>>;
	prepareAction: () => Promise<ServerActionResult<DiscordLifecycleState>>;
	saveCredentialsAction: (
		input: SaveDiscordCandidateCredentialsInput,
	) => Promise<
		ServerActionResult<{ commandsRegistered: boolean; lifecycle: DiscordLifecycleState }>
	>;
	retryCommandsAction: (input: {
		installationId: string;
	}) => Promise<ServerActionResult<DiscordLifecycleState>>;
	sendPrivateTestAction: (
		input: SendDiscordPrivateTestInput,
	) => Promise<ServerActionResult<DiscordLifecycleState>>;
	confirmSwitchAction: (
		input: ConfirmDiscordSwitchActionInput,
	) => Promise<ServerActionResult<ConfirmedDiscordSwitchData>>;
	rotateCredentialsAction: (
		input: RotateDiscordCredentialsActionInput,
	) => Promise<ServerActionResult<RotatedDiscordInstallationData>>;
	revokeInstallationAction: (
		input: RevokeDiscordInstallationActionInput,
	) => Promise<ServerActionResult<RevokedDiscordInstallationData>>;
	prepareRestoreAction: (input: {
		installationId: string;
	}) => Promise<ServerActionResult<PreparedDiscordRestoreData>>;
	confirmRestoreAction: (
		input: ConfirmDiscordSwitchActionInput,
	) => Promise<ServerActionResult<ConfirmedDiscordSwitchData>>;
}

function isPreviewPayload(value: unknown): value is ChatSwitchImpactPreview {
	return (
		typeof value === "object" &&
		value !== null &&
		"impactDigest" in value &&
		typeof (value as { impactDigest?: unknown }).impactDigest === "string"
	);
}

function isLifecyclePayload(value: unknown): value is DiscordLifecycleState {
	return (
		typeof value === "object" &&
		value !== null &&
		"switchPreview" in value &&
		"recoveryState" in value
	);
}

function stepBadgeVariant(
	status: DiscordVerificationStepStatus,
): "default" | "secondary" | "destructive" | "outline" {
	switch (status) {
		case "passed":
			return "default";
		case "failed":
			return "destructive";
		case "expired":
			return "outline";
		case "pending":
			return "secondary";
	}
}

function StepRow({
	title,
	description,
	step,
	action,
	recoveryNotice,
}: {
	title: string;
	description: string;
	step: DiscordVerificationStepView;
	action?: React.ReactNode;
	recoveryNotice?: string | null;
}) {
	const { t } = useTranslate();
	const statusLabels: Record<DiscordVerificationStepStatus, string> = {
		passed: t("settings.discordLifecycle.stepStatus.passed", "Verified"),
		pending: t("settings.discordLifecycle.stepStatus.pending", "Pending"),
		failed: t("settings.discordLifecycle.stepStatus.failed", "Needs attention"),
		expired: t("settings.discordLifecycle.stepStatus.expired", "Expired"),
	};

	return (
		<div className="space-y-2 rounded-lg border bg-background p-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm font-medium">{title}</span>
						<Badge variant={stepBadgeVariant(step.status)}>{statusLabels[step.status]}</Badge>
					</div>
					<p className="text-xs text-muted-foreground">{description}</p>
					{step.detail ? (
						<p className="break-all font-mono text-xs text-muted-foreground">{step.detail}</p>
					) : null}
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>
			{recoveryNotice ? (
				<div
					role="alert"
					className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive"
				>
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
					<span>{recoveryNotice}</span>
				</div>
			) : null}
		</div>
	);
}

function MetricTile({ label, value }: { label: string; value: number }) {
	return (
		<div className="min-w-0 rounded-lg border bg-background p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
		</div>
	);
}

export function DiscordLifecyclePanel({
	initialState,
	refreshAction,
	prepareAction,
	saveCredentialsAction,
	retryCommandsAction,
	sendPrivateTestAction,
	confirmSwitchAction,
	rotateCredentialsAction,
	revokeInstallationAction,
	prepareRestoreAction,
	confirmRestoreAction,
}: DiscordLifecyclePanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const idPrefix = useId();
	const summaryRef = useRef<HTMLDivElement | null>(null);

	const [state, setState] = useState<DiscordLifecycleState | null>(initialState);
	const [announcement, setAnnouncement] = useState("");
	const [copiedUrl, setCopiedUrl] = useState(false);

	// Candidate credential form state (write-only)
	const [botToken, setBotToken] = useState("");
	const [applicationId, setApplicationId] = useState("");
	const [publicKey, setPublicKey] = useState("");
	const [credError, setCredError] = useState<string | null>(null);

	// Private DM test form state
	const [discordUserId, setDiscordUserId] = useState("");
	const [dmError, setDmError] = useState<string | null>(null);

	// Switch impact state
	const [acknowledgedUnready, setAcknowledgedUnready] = useState(false);
	const [impactChangedNotice, setImpactChangedNotice] = useState<string | null>(null);
	const [switchError, setSwitchError] = useState<string | null>(null);

	// Rotation form state (write-only)
	const [rotateToken, setRotateToken] = useState("");
	const [rotateError, setRotateError] = useState<string | null>(null);

	const revokeDialog = useConfirmedAction<{ id: string; label: string }>();

	const announce = (msg: string) => setAnnouncement(msg);

	const refreshMutation = useMutation({
		mutationFn: () => refreshAction(),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data);
				setImpactChangedNotice(null);
				setSwitchError(null);
				announce(
					t(
						"settings.discordLifecycle.refreshedAnnouncement",
						"Discord lifecycle status refreshed.",
					),
				);
			} else {
				toast.error(
					actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
						"settings.discordLifecycle.errors.refreshFailed",
						"Could not refresh Discord lifecycle status.",
					]),
				);
			}
		},
	});

	const prepareMutation = useMutation({
		mutationFn: () => prepareAction(),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data);
				const msg = t(
					"settings.discordLifecycle.preparedAnnouncement",
					"Replacement Discord bot staged. Copy the Interaction Endpoint URL and save your bot credentials.",
				);
				announce(msg);
				toast.success(msg);
			} else {
				toast.error(
					actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
						"settings.discordLifecycle.errors.prepareFailed",
						"Could not prepare a replacement Discord bot.",
					]),
				);
			}
		},
	});

	const saveCredentialsMutation = useMutation({
		mutationFn: (input: SaveDiscordCandidateCredentialsInput) => saveCredentialsAction(input),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data.lifecycle);
				setBotToken("");
				setCredError(null);
				const msg = res.data.commandsRegistered
					? t(
							"settings.discordLifecycle.credentialsSaved",
							"Discord credentials verified and slash commands registered. Configure the Interaction Endpoint URL and run a private DM test next.",
						)
					: t(
							"settings.discordLifecycle.credentialsSavedCommandsFailed",
							"Discord credentials verified, but slash command registration failed. Retry command registration below without re-entering credentials.",
						);
				announce(msg);
				if (res.data.commandsRegistered) {
					toast.success(msg);
				} else {
					toast.warning(msg);
				}
				router.refresh();
				return;
			}
			const msg = actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
				"settings.discordLifecycle.errors.saveCredentialsFailed",
				"Could not verify Discord credentials.",
			]);
			setCredError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const retryCommandsMutation = useMutation({
		mutationFn: (installationId: string) => retryCommandsAction({ installationId }),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data);
				const msg = t(
					"settings.discordLifecycle.commandsRetriedSuccess",
					"Discord slash commands registered successfully.",
				);
				announce(msg);
				toast.success(msg);
				return;
			}
			const msg = actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
				"settings.discordLifecycle.errors.retryCommandsFailed",
				"Slash command registration failed again. Verify your bot token and permissions, then retry.",
			]);
			announce(msg);
			toast.error(msg);
		},
	});

	const privateTestMutation = useMutation({
		mutationFn: (input: SendDiscordPrivateTestInput) => sendPrivateTestAction(input),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data);
				setDmError(null);
				const msg = t(
					"settings.discordLifecycle.privateTestSucceeded",
					"Synthetic private DM delivered and verified.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}
			if (res.details && "lifecycle" in res.details && isLifecyclePayload(res.details.lifecycle)) {
				setState(res.details.lifecycle);
			}
			const msg = actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
				"settings.discordLifecycle.errors.privateTestFailed",
				"Private Discord DM test failed.",
			]);
			setDmError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const switchMutation = useMutation({
		mutationFn: ({
			input,
			isRestore,
		}: {
			input: ConfirmDiscordSwitchActionInput;
			isRestore: boolean;
		}) => (isRestore ? confirmRestoreAction(input) : confirmSwitchAction(input)),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data.lifecycle);
				setAcknowledgedUnready(false);
				setImpactChangedNotice(null);
				setSwitchError(null);
				const msg = t(
					"settings.discordLifecycle.switchedAnnouncement",
					"Switched to the verified organization-owned Discord bot. Previous approval cards remain serviced during retirement.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}
			if (res.details && "preview" in res.details && isPreviewPayload(res.details.preview)) {
				const freshPreview = res.details.preview;
				setState((prev) => (prev ? { ...prev, switchPreview: freshPreview } : prev));
				setAcknowledgedUnready(false);
			}
			const msg = actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
				"settings.discordLifecycle.errors.confirmSwitchFailed",
				"Could not switch Discord installation.",
			]);
			if (res.refusal === "impact_changed") {
				setImpactChangedNotice(msg);
				setSwitchError(null);
				announce(msg);
				queueMicrotask(() => {
					summaryRef.current?.focus();
				});
				return;
			}
			setSwitchError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const rotateMutation = useMutation({
		mutationFn: (input: RotateDiscordCredentialsActionInput) => rotateCredentialsAction(input),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data.lifecycle);
				setRotateToken("");
				setRotateError(null);
				const msg = t(
					"settings.discordLifecycle.rotatedAnnouncement",
					"Discord bot token rotated cleanly while preserving conversations and approval card ownership.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}
			const msg = actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
				"settings.discordLifecycle.errors.rotateFailed",
				"Could not rotate Discord credentials.",
			]);
			setRotateError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const revokeMutation = useMutation({
		mutationFn: async (input: RevokeDiscordInstallationActionInput) => {
			const res = await revokeInstallationAction(input);
			if (!res.success) {
				throw new Error(
					actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
						"settings.discordLifecycle.errors.revokeFailed",
						"Could not revoke Discord installation.",
					]),
				);
			}
			return res.data;
		},
		onSuccess: (data) => {
			setState(data.lifecycle);
			const msg = t(
				"settings.discordLifecycle.revokedAnnouncement",
				"Discord installation revoked immediately. Pending approvals remain accessible in the Z8 inbox.",
			);
			announce(msg);
			toast.success(msg);
			router.refresh();
		},
	});

	const prepareRestoreMutation = useMutation({
		mutationFn: (installationId: string) => prepareRestoreAction({ installationId }),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data.lifecycle);
				const msg = t(
					"settings.discordLifecycle.restoreStartedAnnouncement",
					"Restore started. Complete fresh signed endpoint and private DM verification before confirming switch-back.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}
			toast.error(
				actionErrorMessage(t, res, DISCORD_LIFECYCLE_REFUSALS, [
					"settings.discordLifecycle.errors.prepareRestoreFailed",
					"Could not start restoring this Discord installation.",
				]),
			);
		},
	});

	const candidate = state?.candidateSetup ?? null;
	const preview = state?.switchPreview ?? null;
	const recovery = state?.recoveryState ?? null;
	const isRestoreCandidate = Boolean(
		candidate &&
		recovery?.restoreCandidatePreview?.candidateInstallation?.id === candidate.installationId,
	);

	const endpointUrlId = `${idPrefix}-endpoint-url`;
	const botTokenId = `${idPrefix}-bot-token`;
	const appIdFieldId = `${idPrefix}-app-id`;
	const publicKeyId = `${idPrefix}-public-key`;
	const dmUserFieldId = `${idPrefix}-dm-user-id`;
	const ackCheckboxId = `${idPrefix}-ack-unready`;
	const summaryHeadingId = `${idPrefix}-impact-summary`;
	const rotateTokenId = `${idPrefix}-rotate-token`;

	const handleCopyEndpoint = async (url: string) => {
		try {
			await navigator.clipboard.writeText(url);
			setCopiedUrl(true);
			toast.success(
				t("settings.discordLifecycle.endpointCopied", "Interaction Endpoint URL copied."),
			);
			setTimeout(() => setCopiedUrl(false), 2000);
		} catch {
			toast.error(
				t(
					"settings.discordLifecycle.endpointCopyFailed",
					"Could not copy URL. Select and copy it manually.",
				),
			);
		}
	};

	const canSubmitSwitch = Boolean(
		preview?.candidateInstallation &&
		preview.canConfirm &&
		!switchMutation.isPending &&
		(!preview.requiresUnreadyAcknowledgement || acknowledgedUnready),
	);

	const dmRecoveryText =
		dmError ??
		(candidate?.steps.privateDmDelivery.failureCode === "discord_dm_blocked_50007"
			? t(
					"settings.discordLifecycle.errors.dmBlocked50007",
					"Discord blocked this direct message (error 50007). Share a server with the bot, unblock the bot, and enable server Direct Messages in Discord Privacy Settings, then retry.",
				)
			: candidate?.steps.privateDmDelivery.failureCode === "discord_missing_access"
				? t(
						"settings.discordLifecycle.errors.missingAccess50001",
						"The bot does not share a server with this Discord user (error 50001). Invite the bot to a shared server and retry.",
					)
				: null);

	return (
		<div className="min-w-0 space-y-6">
			<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
				{announcement}
			</div>

			{/* 1. Prepare & Verify Replacement Discord Bot */}
			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0 space-y-1">
							<CardTitle className="flex items-center gap-2 text-base">
								<IconBrandDiscord className="size-4 shrink-0" aria-hidden="true" />
								{t(
									"settings.discordLifecycle.prepareTitle",
									"Prepare & verify replacement Discord bot",
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.discordLifecycle.prepareDescription",
									"Verify application identity, signed interactions, slash commands, and private DM delivery while your current Discord bot keeps serving employees.",
								)}
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-2">
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
								{t("settings.discordLifecycle.refresh", "Refresh status")}
							</Button>
							{!candidate ? (
								<Button
									type="button"
									size="sm"
									disabled={prepareMutation.isPending}
									onClick={() => prepareMutation.mutate()}
								>
									{prepareMutation.isPending ? (
										<IconLoader2
											className="mr-1.5 size-4 motion-safe:animate-spin"
											aria-hidden="true"
										/>
									) : (
										<IconPlugConnected className="mr-1.5 size-4" aria-hidden="true" />
									)}
									{t("settings.discordLifecycle.prepareButton", "Prepare replacement bot")}
								</Button>
							) : null}
						</div>
					</div>
				</CardHeader>

				{candidate ? (
					<CardContent className="min-w-0 space-y-5">
						<div className="space-y-2 rounded-lg border bg-muted/30 p-3">
							<Label htmlFor={endpointUrlId}>
								{t(
									"settings.discordLifecycle.interactionEndpointUrl",
									"Candidate Interaction Endpoint URL",
								)}
							</Label>
							<div className="flex flex-col gap-2 sm:flex-row">
								<Input
									id={endpointUrlId}
									value={candidate.interactionEndpointUrl}
									readOnly
									className="font-mono text-xs"
									onFocus={(e) => e.target.select()}
								/>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="shrink-0"
									onClick={() => void handleCopyEndpoint(candidate.interactionEndpointUrl)}
								>
									{copiedUrl ? (
										<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
									) : (
										<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
									)}
									{copiedUrl
										? t("settings.discordLifecycle.copied", "Copied")
										: t("settings.discordLifecycle.copy", "Copy")}
								</Button>
							</div>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.discordLifecycle.endpointHelp",
									"Save credentials below first, then paste this URL into the Discord Developer Portal so Discord sends a signed PING.",
								)}
							</p>
						</div>

						{/* 4 Separate Verification Steps */}
						<div className="space-y-2.5">
							<StepRow
								title={t(
									"settings.discordLifecycle.steps.identityTitle",
									"1. Application identity & credentials",
								)}
								description={t(
									"settings.discordLifecycle.steps.identityDesc",
									"Verifies bot token, Application ID, and Ed25519 Public Key via Discord API and stores an immutable revision.",
								)}
								step={candidate.steps.applicationIdentity}
							/>
							<StepRow
								title={t(
									"settings.discordLifecycle.steps.signedEndpointTitle",
									"2. Signed interaction endpoint (PING)",
								)}
								description={t(
									"settings.discordLifecycle.steps.signedEndpointDesc",
									"Confirms Ed25519-signed traffic for this application ID. A signed PING alone does not confirm private DM reachability.",
								)}
								step={candidate.steps.signedInteractionEndpoint}
							/>
							<StepRow
								title={t(
									"settings.discordLifecycle.steps.commandsTitle",
									"3. Slash command registration",
								)}
								description={t(
									"settings.discordLifecycle.steps.commandsDesc",
									"Tracked independently so registration errors can be retried without re-entering credentials.",
								)}
								step={candidate.steps.commandRegistration}
								action={
									candidate.steps.commandRegistration.canRetry ? (
										<Button
											type="button"
											variant="outline"
											size="sm"
											disabled={retryCommandsMutation.isPending}
											onClick={() => retryCommandsMutation.mutate(candidate.installationId)}
										>
											{retryCommandsMutation.isPending ? (
												<IconLoader2
													className="mr-1.5 size-4 motion-safe:animate-spin"
													aria-hidden="true"
												/>
											) : (
												<IconTerminal2 className="mr-1.5 size-4" aria-hidden="true" />
											)}
											{t("settings.discordLifecycle.retryCommands", "Retry commands")}
										</Button>
									) : null
								}
							/>
							<StepRow
								title={t(
									"settings.discordLifecycle.steps.privateDmTitle",
									"4. Private DM delivery check (required)",
								)}
								description={t(
									"settings.discordLifecycle.steps.privateDmDesc",
									"Sends a synthetic private DM to your Discord user ID to confirm real direct-message reachability.",
								)}
								step={candidate.steps.privateDmDelivery}
								recoveryNotice={dmRecoveryText}
							/>
						</div>

						{/* Write-only Credentials Form */}
						<form
							className="space-y-3 rounded-lg border p-3"
							onSubmit={(event) => {
								event.preventDefault();
								setCredError(null);
								saveCredentialsMutation.mutate({
									installationId: candidate.installationId,
									botToken,
									applicationId,
									publicKey,
								});
							}}
						>
							<p className="text-sm font-medium">
								{t(
									"settings.discordLifecycle.credentialsFormTitle",
									"Save & verify candidate bot credentials",
								)}
							</p>
							<div className="space-y-2">
								<Label htmlFor={botTokenId}>
									{t("settings.discordLifecycle.botTokenLabel", "Bot Token (write-only)")}
								</Label>
								<Input
									id={botTokenId}
									type="password"
									value={botToken}
									onChange={(e) => setBotToken(e.target.value)}
									autoComplete="off"
									spellCheck={false}
									disabled={saveCredentialsMutation.isPending}
									required
								/>
							</div>
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor={appIdFieldId}>
										{t("settings.discordLifecycle.applicationIdLabel", "Application ID")}
									</Label>
									<Input
										id={appIdFieldId}
										inputMode="numeric"
										value={applicationId}
										onChange={(e) => setApplicationId(e.target.value)}
										autoComplete="off"
										spellCheck={false}
										disabled={saveCredentialsMutation.isPending}
										required
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor={publicKeyId}>
										{t("settings.discordLifecycle.publicKeyLabel", "Ed25519 Public Key")}
									</Label>
									<Input
										id={publicKeyId}
										value={publicKey}
										onChange={(e) => setPublicKey(e.target.value)}
										autoComplete="off"
										spellCheck={false}
										disabled={saveCredentialsMutation.isPending}
										required
									/>
								</div>
							</div>
							{credError ? (
								<p role="alert" className="text-xs text-destructive">
									{credError}
								</p>
							) : null}
							<Button type="submit" size="sm" disabled={saveCredentialsMutation.isPending}>
								{saveCredentialsMutation.isPending ? (
									<IconLoader2
										className="mr-1.5 size-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								) : (
									<IconShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
								)}
								{t("settings.discordLifecycle.saveCredentialsButton", "Verify & save credentials")}
							</Button>
						</form>

						{/* Private DM Verification Form */}
						{candidate.hasStoredCredentials ? (
							<form
								className="space-y-3 rounded-lg border p-3"
								onSubmit={(event) => {
									event.preventDefault();
									setDmError(null);
									privateTestMutation.mutate({
										installationId: candidate.installationId,
										discordUserId,
									});
								}}
							>
								<div className="space-y-1">
									<Label htmlFor={dmUserFieldId}>
										{t(
											"settings.discordLifecycle.dmTestLabel",
											"Test private DM delivery (Discord User ID)",
										)}
									</Label>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.discordLifecycle.dmTestHelp",
											"Enter your numeric Discord User ID. If Discord returns error 50007, ensure you share a server with the bot and enable server Direct Messages.",
										)}
									</p>
								</div>
								<div className="flex flex-col gap-2 sm:flex-row">
									<Input
										id={dmUserFieldId}
										inputMode="numeric"
										placeholder="123456789012345678"
										value={discordUserId}
										onChange={(e) => setDiscordUserId(e.target.value)}
										disabled={privateTestMutation.isPending}
										required
									/>
									<Button
										type="submit"
										size="sm"
										className="shrink-0"
										disabled={privateTestMutation.isPending}
									>
										{privateTestMutation.isPending ? (
											<IconLoader2
												className="mr-1.5 size-4 motion-safe:animate-spin"
												aria-hidden="true"
											/>
										) : (
											<IconSend className="mr-1.5 size-4" aria-hidden="true" />
										)}
										{t("settings.discordLifecycle.sendTestDmButton", "Send test DM")}
									</Button>
								</div>
							</form>
						) : null}
					</CardContent>
				) : null}
			</Card>

			{/* 2. Review Impact & Switch */}
			{preview && preview.candidateInstallation ? (
				<Card>
					<CardHeader>
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="min-w-0 space-y-1">
								<CardTitle className="flex items-center gap-2 text-base">
									<IconArrowsExchange className="size-4 shrink-0" aria-hidden="true" />
									{t("settings.discordLifecycle.switchTitle", "Review impact & switch Discord bot")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.discordLifecycle.switchDescription",
										"Review verified Discord DM reachability, open approval cards, and in-flight notifications before switching.",
									)}
								</CardDescription>
							</div>
							<Badge
								variant={preview.switchControlEnabled ? "default" : "secondary"}
								className="w-fit shrink-0"
							>
								{preview.switchControlEnabled
									? t("settings.discordLifecycle.gate.enabled", "Switch enabled")
									: t("settings.discordLifecycle.gate.disabled", "Switch gated")}
							</Badge>
						</div>
					</CardHeader>
					<CardContent className="min-w-0 space-y-4">
						{!preview.switchControlEnabled ? (
							<div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
								{t(
									"settings.discordLifecycle.gateDisabledNotice",
									"Organization-owned Discord switching is not yet enabled for this organization. You can prepare, test, and review impact now.",
								)}
							</div>
						) : null}

						<div
							ref={summaryRef}
							tabIndex={-1}
							aria-labelledby={summaryHeadingId}
							className="space-y-3 rounded-lg border bg-muted/20 p-3 focus:outline-none focus:ring-2 focus:ring-ring"
						>
							<h3 id={summaryHeadingId} className="text-sm font-medium">
								{t("settings.discordLifecycle.impactSummaryHeading", "Switch impact summary")}
							</h3>

							{impactChangedNotice ? (
								<div
									role="alert"
									className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-2.5 text-xs"
								>
									<IconAlertTriangle
										className="mt-0.5 size-4 shrink-0 text-warning"
										aria-hidden="true"
									/>
									<span>{impactChangedNotice}</span>
								</div>
							) : null}

							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
								<MetricTile
									label={t("settings.discordLifecycle.metrics.reachable", "Verified DM reachable")}
									value={preview.employeeImpact.verifiedReachableEmployees}
								/>
								<MetricTile
									label={t("settings.discordLifecycle.metrics.actionNeeded", "Action needed")}
									value={preview.employeeImpact.actionNeededEmployees}
								/>
								<MetricTile
									label={t("settings.discordLifecycle.metrics.unknown", "Unknown reachability")}
									value={preview.employeeImpact.unknownReachabilityEmployees}
								/>
								<MetricTile
									label={t(
										"settings.discordLifecycle.metrics.openCards",
										"Open approval cards & work",
									)}
									value={preview.approvalImpact.totalOutstanding}
								/>
							</div>
						</div>

						{preview.requiresUnreadyAcknowledgement ? (
							<div className="flex items-start gap-2 rounded-lg border p-3">
								<input
									id={ackCheckboxId}
									type="checkbox"
									className="mt-1 size-4 shrink-0"
									checked={acknowledgedUnready}
									onChange={(e) => setAcknowledgedUnready(e.target.checked)}
								/>
								<Label htmlFor={ackCheckboxId} className="text-xs font-normal leading-relaxed">
									{t(
										"settings.discordLifecycle.ackUnreadyLabel",
										"I acknowledge that {count} employees still need to link or verify Discord direct messages on the replacement bot.",
										{ count: String(preview.employeeImpact.unreadyEmployees) },
									)}
								</Label>
							</div>
						) : null}

						{switchError ? (
							<p role="alert" className="text-xs text-destructive">
								{switchError}
							</p>
						) : null}

						<Button
							type="button"
							disabled={!canSubmitSwitch}
							onClick={() => {
								if (!preview.candidateInstallation) return;
								switchMutation.mutate({
									isRestore: isRestoreCandidate,
									input: {
										candidateInstallationId: preview.candidateInstallation.id,
										reviewedCurrentInstallationId: preview.primaryCurrentInstallationId,
										reviewedCurrentCredentialRevisionId: preview.primaryCurrentCredentialRevisionId,
										reviewedCandidateCredentialRevisionId:
											preview.candidateInstallation.activeCredentialRevisionId,
										reviewedImpactDigest: preview.impactDigest,
										acknowledgeUnreadyEmployees: acknowledgedUnready,
									},
								});
							}}
						>
							{switchMutation.isPending ? (
								<IconLoader2
									className="mr-1.5 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : (
								<IconArrowsExchange className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{isRestoreCandidate
								? t("settings.discordLifecycle.confirmRestoreButton", "Confirm Discord restore")
								: t("settings.discordLifecycle.confirmSwitchButton", "Confirm Discord switch")}
						</Button>
					</CardContent>
				</Card>
			) : null}

			{/* 3. Retiring Installations */}
			{preview && preview.retiringInstallations.length > 0 ? (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<IconClock className="size-4 shrink-0" aria-hidden="true" />
							{t("settings.discordLifecycle.retiringTitle", "Retiring Discord bots")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.discordLifecycle.retiringDescription",
								"Retiring bots continue servicing eligible approval cards they originally sent until work settles or the 30-day deadline.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{preview.retiringInstallations.map((ret) => (
							<div
								key={ret.id}
								className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0 space-y-1">
									<p className="truncate text-sm font-medium">
										{ret.externalDisplayName ?? ret.externalAppId ?? ret.id}
									</p>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.discordLifecycle.retiringMeta",
											"Outstanding cards & work: {count} · Deadline: {deadline}",
											{
												count: String(ret.totalOutstandingCardsAndWork),
												deadline: ret.retirementDeadlineAt ?? "—",
											},
										)}
									</p>
								</div>
							</div>
						))}
					</CardContent>
				</Card>
			) : null}

			{/* 4. Same-App Rotation, Revoke, & Restore */}
			{recovery && (recovery.activeInstallation || recovery.restorableInstallations.length > 0) ? (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-base">
							<IconKey className="size-4 shrink-0" aria-hidden="true" />
							{t(
								"settings.discordLifecycle.recoveryTitle",
								"Credential rotation, revoke & restore",
							)}
						</CardTitle>
						<CardDescription>{recovery.rotationGuidance.summary}</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5">
						{recovery.activeInstallation?.canRotate ? (
							<form
								className="space-y-3 rounded-lg border p-3"
								onSubmit={(event) => {
									event.preventDefault();
									setRotateError(null);
									rotateMutation.mutate({
										installationId: recovery.activeInstallation!.id,
										botToken: rotateToken,
									});
								}}
							>
								<div className="space-y-1">
									<p className="text-sm font-medium">
										{t("settings.discordLifecycle.rotateHeading", "Rotate Discord bot token")}
									</p>
									<p className="text-xs text-muted-foreground">
										{recovery.rotationGuidance.interruptionDetails}
									</p>
								</div>
								<div className="space-y-2">
									<Label htmlFor={rotateTokenId}>
										{t(
											"settings.discordLifecycle.rotateTokenLabel",
											"New Bot Token (same application)",
										)}
									</Label>
									<div className="flex flex-col gap-2 sm:flex-row">
										<Input
											id={rotateTokenId}
											type="password"
											value={rotateToken}
											onChange={(e) => setRotateToken(e.target.value)}
											autoComplete="off"
											spellCheck={false}
											disabled={rotateMutation.isPending}
											required
										/>
										<Button
											type="submit"
											size="sm"
											className="shrink-0"
											disabled={rotateMutation.isPending}
										>
											{rotateMutation.isPending ? (
												<IconLoader2
													className="mr-1.5 size-4 motion-safe:animate-spin"
													aria-hidden="true"
												/>
											) : (
												<IconKey className="mr-1.5 size-4" aria-hidden="true" />
											)}
											{t("settings.discordLifecycle.rotateButton", "Rotate token")}
										</Button>
									</div>
								</div>
								{rotateError ? (
									<p role="alert" className="text-xs text-destructive">
										{rotateError}
									</p>
								) : null}
							</form>
						) : null}

						{recovery.activeInstallation?.canRevoke ? (
							<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3 sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0 space-y-1">
									<p className="text-sm font-medium">
										{t("settings.discordLifecycle.revokeHeading", "Revoke active Discord bot")}
									</p>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.discordLifecycle.revokeHelp",
											"Immediately stops Discord authorization while keeping pending approvals available in the Z8 inbox.",
										)}
									</p>
								</div>
								<Button
									type="button"
									variant="destructive"
									size="sm"
									className="shrink-0"
									disabled={revokeDialog.isPending}
									onClick={() =>
										revokeDialog.request({
											id: recovery.activeInstallation!.id,
											label:
												recovery.activeInstallation!.externalDisplayName ??
												recovery.activeInstallation!.externalAppId ??
												recovery.activeInstallation!.id,
										})
									}
								>
									<IconShieldOff className="mr-1.5 size-4" aria-hidden="true" />
									{t("settings.discordLifecycle.revokeButton", "Revoke bot")}
								</Button>
							</div>
						) : null}

						{recovery.restorableInstallations.length > 0 ? (
							<div className="space-y-2">
								<p className="text-sm font-medium">
									{t("settings.discordLifecycle.restoreHeading", "Restore a previous Discord bot")}
								</p>
								{recovery.restorableInstallations.map((inst) => (
									<div
										key={inst.id}
										className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
									>
										<div className="min-w-0 space-y-0.5">
											<p className="truncate text-sm font-medium">
												{inst.externalDisplayName ?? inst.externalAppId ?? inst.id}
											</p>
											<p className="text-xs text-muted-foreground">
												{t("settings.discordLifecycle.restoreMeta", "Status: {status}", {
													status: inst.status,
												})}
											</p>
										</div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="shrink-0"
											disabled={prepareRestoreMutation.isPending}
											onClick={() => prepareRestoreMutation.mutate(inst.id)}
										>
											{prepareRestoreMutation.isPending ? (
												<IconLoader2
													className="mr-1.5 size-4 motion-safe:animate-spin"
													aria-hidden="true"
												/>
											) : (
												<IconRestore className="mr-1.5 size-4" aria-hidden="true" />
											)}
											{t("settings.discordLifecycle.restoreButton", "Begin verified restore")}
										</Button>
									</div>
								))}
							</div>
						) : null}
					</CardContent>
				</Card>
			) : null}

			<ConfirmActionDialog
				open={revokeDialog.open}
				onOpenChange={revokeDialog.onOpenChange}
				title={t("settings.discordLifecycle.revokeConfirm.title", "Revoke Discord bot?")}
				description={t(
					"settings.discordLifecycle.revokeConfirm.description",
					"This immediately stops Discord delivery and callbacks for this installation. Pending approvals remain accessible in Z8.",
				)}
				confirmLabel={t("settings.discordLifecycle.revokeButton", "Revoke bot")}
				isPending={revokeDialog.isPending}
				error={revokeDialog.error}
				onConfirm={() => {
					const target = revokeDialog.target;
					if (!target) return;
					void revokeDialog.confirm(
						async () => {
							await revokeMutation.mutateAsync({ installationId: target.id });
						},
						(failure) =>
							describeFailure(
								failure,
								t(
									"settings.discordLifecycle.errors.revokeFailed",
									"Could not revoke Discord installation.",
								),
							),
					);
				}}
			/>
		</div>
	);
}
