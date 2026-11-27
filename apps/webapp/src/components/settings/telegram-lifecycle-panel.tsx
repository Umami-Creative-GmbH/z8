"use client";

import {
	IconAlertTriangle,
	IconArrowsExchange,
	IconBrandTelegram,
	IconCheck,
	IconClock,
	IconKey,
	IconLoader2,
	IconRefresh,
	IconRotateClockwise,
	IconSend,
	IconShieldCheck,
	IconShieldOff,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { chatInstallationQueries } from "@/lib/query/chat-installation-queries";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import type {
	ConfirmTelegramSwitchActionInput,
	RevokeTelegramInstallationActionInput,
	SaveTelegramCredentialsActionInput,
	SendTelegramPrivateTestActionInput,
	TelegramLifecycleState,
} from "@/app/[locale]/(app)/settings/notification-channels/telegram-lifecycle-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import type { ChatSwitchImpactPreview } from "@/lib/chat-installations/switch-lifecycle";
import type { TelegramVerificationStepStatus } from "@/lib/chat-installations/telegram-setup";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

const TELEGRAM_LIFECYCLE_REFUSALS = {
	impact_changed: [
		"settings.telegramLifecycle.errors.impactChanged",
		"Switch impact or installation revisions changed since you reviewed them. Review the updated summary and confirm again.",
	],
	invalid_bot_token_format: [
		"settings.telegramLifecycle.errors.invalidTokenFormat",
		"Enter a valid BotFather token (for example, 123456789:ABCdef...).",
	],
	invalid_bot_token: [
		"settings.telegramLifecycle.errors.invalidToken",
		"Telegram rejected the bot token. Check your BotFather token and try again.",
	],
	bot_claimed_by_other_org: [
		"settings.telegramLifecycle.errors.botClaimedByOtherOrg",
		"This Telegram bot is already claimed by another Z8 organization.",
	],
	switch_not_enabled: [
		"settings.telegramLifecycle.errors.switchNotEnabled",
		"Telegram switching is currently gated off for this organization.",
	],
	migration_blocked: [
		"settings.telegramLifecycle.errors.migrationBlocked",
		"Resolve migration blockers before switching Telegram bots.",
	],
	candidate_not_ready: [
		"settings.telegramLifecycle.errors.candidateNotReady",
		"Complete bot identity, webhook receipt, and private delivery checks before switching.",
	],
	candidate_verification_expired: [
		"settings.telegramLifecycle.errors.candidateVerificationExpired",
		"Candidate verification proofs have expired. Re-verify before switching.",
	],
	unready_acknowledgement_required: [
		"settings.telegramLifecycle.errors.unreadyAckRequired",
		"Acknowledge that some employees still need to link the replacement Telegram bot before switching.",
	],
	external_identity_mismatch: [
		"settings.telegramLifecycle.errors.rotationIdentityMismatch",
		"The provided token belongs to a different Telegram bot. Token rotation requires the exact same bot identity.",
	],
	secret_store_unavailable: [
		"settings.telegramLifecycle.errors.secretStoreUnavailable",
		"The organization secret store is temporarily unavailable. Try again shortly.",
	],
	invalid_chat_id: [
		"settings.telegramLifecycle.errors.invalidChatId",
		"Enter a valid numeric Telegram chat ID or link your candidate bot first.",
	],
	candidate_chat_required: [
		"settings.telegramLifecycle.errors.candidateChatRequired",
		"Send /start to your candidate bot on Telegram or provide your Telegram chat ID first.",
	],
} satisfies RefusalMessages<
	| "impact_changed"
	| "invalid_bot_token_format"
	| "invalid_bot_token"
	| "bot_claimed_by_other_org"
	| "switch_not_enabled"
	| "migration_blocked"
	| "candidate_not_ready"
	| "candidate_verification_expired"
	| "unready_acknowledgement_required"
	| "external_identity_mismatch"
	| "secret_store_unavailable"
	| "invalid_chat_id"
	| "candidate_chat_required"
>;

export interface TelegramLifecyclePanelProps {
	initialState: TelegramLifecycleState | null;
	refreshAction: () => Promise<ServerActionResult<TelegramLifecycleState>>;
	prepareAction: () => Promise<ServerActionResult<TelegramLifecycleState>>;
	saveCredentialsAction: (
		input: SaveTelegramCredentialsActionInput,
	) => Promise<ServerActionResult<TelegramLifecycleState>>;
	retryWebhookAction: (input: {
		installationId: string;
	}) => Promise<ServerActionResult<TelegramLifecycleState>>;
	retryCommandsAction: (input: {
		installationId: string;
	}) => Promise<ServerActionResult<TelegramLifecycleState>>;
	sendPrivateTestAction: (
		input: SendTelegramPrivateTestActionInput,
	) => Promise<ServerActionResult<TelegramLifecycleState>>;
	confirmSwitchAction: (
		input: ConfirmTelegramSwitchActionInput,
	) => Promise<ServerActionResult<TelegramLifecycleState>>;
	rotateCredentialsAction: (
		input: SaveTelegramCredentialsActionInput,
	) => Promise<ServerActionResult<TelegramLifecycleState>>;
	revokeAction: (
		input: RevokeTelegramInstallationActionInput,
	) => Promise<ServerActionResult<TelegramLifecycleState>>;
	prepareRestoreAction: (input: {
		installationId: string;
	}) => Promise<ServerActionResult<TelegramLifecycleState>>;
	confirmRestoreAction: (
		input: ConfirmTelegramSwitchActionInput,
	) => Promise<ServerActionResult<TelegramLifecycleState>>;
}

function isPreviewPayload(value: unknown): value is ChatSwitchImpactPreview {
	return (
		typeof value === "object" &&
		value !== null &&
		"impactDigest" in value &&
		typeof (value as { impactDigest?: unknown }).impactDigest === "string"
	);
}

function StepBadge({ status }: { status: TelegramVerificationStepStatus }) {
	const { t } = useTranslate();
	switch (status) {
		case "passed":
			return (
				<Badge variant="secondary">
					<IconCheck className="size-3.5" aria-hidden="true" />
					{t("settings.telegramLifecycle.step.passed", "Verified")}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive">
					<IconAlertTriangle className="size-3.5" aria-hidden="true" />
					{t("settings.telegramLifecycle.step.failed", "Needs attention")}
				</Badge>
			);
		case "expired":
			return (
				<Badge variant="outline">
					<IconClock className="size-3.5" aria-hidden="true" />
					{t("settings.telegramLifecycle.step.expired", "Expired")}
				</Badge>
			);
		default:
			return (
				<Badge variant="outline">{t("settings.telegramLifecycle.step.pending", "Pending")}</Badge>
			);
	}
}

function MetricTile({ label, value }: { label: string; value: number }) {
	return (
		<div className="min-w-0 rounded-lg border bg-background p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
		</div>
	);
}

function useTelegramLifecyclePanel({
	initialState,
	refreshAction,
	prepareAction,
	saveCredentialsAction,
	retryWebhookAction,
	retryCommandsAction,
	sendPrivateTestAction,
	confirmSwitchAction,
	rotateCredentialsAction,
	revokeAction,
	prepareRestoreAction,
	confirmRestoreAction,
}: TelegramLifecyclePanelProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const router = useRouter();
	const idPrefix = useId();
	const summaryRef = useRef<HTMLDivElement | null>(null);

	const [state, setState] = useState<TelegramLifecycleState | null>(initialState);
	const [testChatId, setTestChatId] = useState("");
	const [acknowledgedUnready, setAcknowledgedUnready] = useState(false);
	const [impactChangedNotice, setImpactChangedNotice] = useState<string | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const announce = (message: string) => setAnnouncement(message);

	const applySuccess = (next: TelegramLifecycleState, message: string, shouldRefresh = false) => {
		setState(next);
		setErrorMessage(null);
		setImpactChangedNotice(null);
		announce(message);
		toast.success(message);
		if (shouldRefresh) {
			router.refresh();
		}
	};

	const applyError = (result: {
		code?: string;
		refusal?: string;
		details?: Record<string, unknown>;
	}) => {
		const freshPreview =
			result.details && "preview" in result.details && isPreviewPayload(result.details.preview)
				? result.details.preview
				: null;

		if (freshPreview && state) {
			setState({ ...state, switchPreview: freshPreview });
			setAcknowledgedUnready(false);
		}

		const message = actionErrorMessage(t, result, TELEGRAM_LIFECYCLE_REFUSALS, [
			"settings.telegramLifecycle.errors.actionFailed",
			"Could not complete the Telegram bot action. Try again.",
		]);

		// Branch on refusal ONLY for flow (focusing refreshed impact summary), never wording.
		if (result.refusal === "impact_changed") {
			setImpactChangedNotice(message);
			setErrorMessage(null);
			announce(message);
			queueMicrotask(() => {
				summaryRef.current?.focus();
			});
			return;
		}

		setErrorMessage(message);
		announce(message);
		toast.error(message);
	};

	// react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation -- Read-only refresh replaces the panel snapshot.
	const refreshMutation = useMutation({
		mutationFn: () => refreshAction(),
		onSuccess: (res) => {
			if (res.success) {
				setState(res.data);
				setErrorMessage(null);
				setImpactChangedNotice(null);
				announce(
					t("settings.telegramLifecycle.refreshed", "Telegram installation status refreshed."),
				);
			} else {
				applyError(res);
			}
		},
	});

	const prepareMutation = useMutation({
		mutationFn: () => prepareAction(),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.prepared",
						"Prepared a staged replacement Telegram bot installation.",
					),
				);
			} else {
				applyError(res);
			}
		},
	});

	const saveCredentialsMutation = useMutation({
		mutationFn: (input: SaveTelegramCredentialsActionInput) => saveCredentialsAction(input),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				candidateCredentialsForm.reset();
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.credentialsSaved",
						"Verified Telegram bot identity and stored a new credential revision.",
					),
				);
			} else {
				applyError(res);
			}
		},
	});

	const candidateCredentialsForm = useForm({
		defaultValues: {
			botToken: "",
		},
		onSubmit: async ({ value }) => {
			const installationId = state?.candidateSetup?.installationId;
			const trimmed = value.botToken.trim();
			if (!installationId || !trimmed) return;
			saveCredentialsMutation.mutate({
				installationId,
				botToken: trimmed,
			});
		},
	});

	const retryWebhookMutation = useMutation({
		mutationFn: (installationId: string) => retryWebhookAction({ installationId }),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.webhookRetried",
						"Telegram webhook registered. Send a private message to the new bot to confirm authenticated receipt.",
					),
				);
			} else {
				applyError(res);
			}
		},
	});

	const retryCommandsMutation = useMutation({
		mutationFn: (installationId: string) => retryCommandsAction({ installationId }),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.commandsRetried",
						"Registered the 11 Telegram bot commands.",
					),
				);
			} else {
				applyError(res);
			}
		},
	});

	const sendTestMutation = useMutation({
		mutationFn: (input: SendTelegramPrivateTestActionInput) => sendPrivateTestAction(input),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.privateTestSent",
						"Synthetic private test message delivered to Telegram.",
					),
				);
			} else {
				applyError(res);
			}
		},
	});

	const confirmSwitchMutation = useMutation({
		mutationFn: (input: ConfirmTelegramSwitchActionInput) => confirmSwitchAction(input),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				setAcknowledgedUnready(false);
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.switched",
						"Switched to the verified organization-owned Telegram bot. Existing open approval cards remain serviceable during retirement.",
					),
					true,
				);
			} else {
				applyError(res);
			}
		},
	});

	const rotateMutation = useMutation({
		mutationFn: (input: SaveTelegramCredentialsActionInput) => rotateCredentialsAction(input),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				rotateTokenForm.reset();
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.rotated",
						"Rotated Telegram bot token while preserving installation, conversations, and webhook route.",
					),
					true,
				);
			} else {
				applyError(res);
			}
		},
	});

	const rotateTokenForm = useForm({
		defaultValues: {
			botToken: "",
		},
		onSubmit: async ({ value }) => {
			const installationId = state?.recoveryState.activeInstallation?.id;
			const trimmed = value.botToken.trim();
			if (!installationId || !trimmed) return;
			rotateMutation.mutate({
				installationId,
				botToken: trimmed,
			});
		},
	});

	const revokeMutation = useMutation({
		mutationFn: (input: RevokeTelegramInstallationActionInput) => revokeAction(input),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.revoked",
						"Revoked Telegram installation immediately. Pending approvals remain available in Z8.",
					),
					true,
				);
			} else {
				applyError(res);
			}
		},
	});

	const prepareRestoreMutation = useMutation({
		mutationFn: (installationId: string) => prepareRestoreAction({ installationId }),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				applySuccess(
					res.data,
					t(
						"settings.telegramLifecycle.restoreStarted",
						"Restore prepared. Complete fresh verification and impact review before reactivating.",
					),
					true,
				);
			} else {
				applyError(res);
			}
		},
	});

	const confirmRestoreMutation = useMutation({
		mutationFn: (input: ConfirmTelegramSwitchActionInput) => confirmRestoreAction(input),
		onSuccess: (res) => {
			if (res.success) {
				void queryClient.invalidateQueries(
					chatInstallationQueries(res.data.switchPreview.organizationId),
				);
				setAcknowledgedUnready(false);
				applySuccess(
					res.data,
					t("settings.telegramLifecycle.restored", "Restored verified Telegram bot installation."),
					true,
				);
			} else {
				applyError(res);
			}
		},
	});

	if (!state) {
		return null;
	}

	const { candidateSetup, switchPreview, recoveryState } = state;
	const candidate = switchPreview.candidateInstallation;
	const isRestoringCandidate = Boolean(
		candidateSetup &&
		candidateSetup.endpointGeneration > 0 &&
		recoveryState.restoreCandidatePreview,
	);
	const testChatInputId = `${idPrefix}-test-chat-id`;
	const ackCheckboxId = `${idPrefix}-ack-unready`;

	const canSubmitSwitch =
		Boolean(candidate) &&
		switchPreview.canConfirm &&
		!confirmSwitchMutation.isPending &&
		!confirmRestoreMutation.isPending &&
		(!switchPreview.requiresUnreadyAcknowledgement || acknowledgedUnready);

	const handleConfirmSwitch = () => {
		if (!candidate) return;
		const payload: ConfirmTelegramSwitchActionInput = {
			candidateInstallationId: candidate.id,
			reviewedCurrentInstallationId: switchPreview.primaryCurrentInstallationId,
			reviewedCurrentCredentialRevisionId: switchPreview.primaryCurrentCredentialRevisionId,
			reviewedCandidateCredentialRevisionId: candidate.activeCredentialRevisionId,
			reviewedImpactDigest: switchPreview.impactDigest,
			acknowledgeUnreadyEmployees: acknowledgedUnready,
		};
		if (isRestoringCandidate) {
			confirmRestoreMutation.mutate(payload);
		} else {
			confirmSwitchMutation.mutate(payload);
		}
	};

	return {
		t,
		summaryRef,
		testChatId,
		setTestChatId,
		acknowledgedUnready,
		setAcknowledgedUnready,
		impactChangedNotice,
		announcement,
		errorMessage,
		refreshMutation,
		prepareMutation,
		saveCredentialsMutation,
		candidateCredentialsForm,
		retryWebhookMutation,
		retryCommandsMutation,
		sendTestMutation,
		confirmSwitchMutation,
		rotateMutation,
		rotateTokenForm,
		revokeMutation,
		prepareRestoreMutation,
		confirmRestoreMutation,
		candidateSetup,
		switchPreview,
		recoveryState,
		candidate,
		isRestoringCandidate,
		testChatInputId,
		ackCheckboxId,
		canSubmitSwitch,
		handleConfirmSwitch,
	};
}

type PanelState = NonNullable<ReturnType<typeof useTelegramLifecyclePanel>>;

function VerificationSteps(
	props: PanelState & { candidateSetup: NonNullable<PanelState["candidateSetup"]> },
) {
	const {
		t,
		testChatId,
		setTestChatId,
		retryWebhookMutation,
		retryCommandsMutation,
		sendTestMutation,
		testChatInputId,
		candidateSetup,
	} = props;
	return (
		<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
			{/* Step 1: Bot Identity */}
			<div className="min-w-0 space-y-2 rounded-lg border p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-sm font-medium">
						{t("settings.telegramLifecycle.steps.identityTitle", "1. Bot identity")}
					</p>
					<StepBadge status={candidateSetup.steps.identity.status} />
				</div>
				<p className="break-words text-xs text-muted-foreground">
					{candidateSetup.steps.identity.detail ??
						t(
							"settings.telegramLifecycle.steps.identityHint",
							"Verifies the numeric Telegram bot ID and claims ownership before changing webhook settings.",
						)}
				</p>
			</div>

			{/* Step 2: Authenticated Webhook Receipt */}
			<div className="min-w-0 space-y-2 rounded-lg border p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-sm font-medium">
						{t(
							"settings.telegramLifecycle.steps.webhookReceiptTitle",
							"2. Authenticated webhook receipt",
						)}
					</p>
					<StepBadge status={candidateSetup.steps.webhookReceipt.status} />
				</div>
				<p className="break-words text-xs text-muted-foreground">
					{candidateSetup.steps.webhookReceipt.status === "passed"
						? t(
								"settings.telegramLifecycle.steps.webhookReceiptPassed",
								"Confirmed via authenticated inbound Telegram webhook matching this installation and secret.",
							)
						: candidateSetup.webhookRegistered
							? t(
									"settings.telegramLifecycle.steps.webhookReceiptAwaiting",
									"Webhook registered. Send /start to your new bot on Telegram to confirm authenticated inbound receipt.",
								)
							: t(
									"settings.telegramLifecycle.steps.webhookReceiptPending",
									"Registers the installation-scoped webhook and waits for an authenticated Telegram update.",
								)}
				</p>
				{candidateSetup.hasStoredCredentials && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={retryWebhookMutation.isPending}
						onClick={() => retryWebhookMutation.mutate(candidateSetup.installationId)}
					>
						{retryWebhookMutation.isPending && (
							<IconLoader2 className="mr-1.5 size-4 motion-safe:animate-spin" aria-hidden="true" />
						)}
						{t("settings.telegramLifecycle.retryWebhookButton", "Retry webhook registration")}
					</Button>
				)}
			</div>

			{/* Step 3: Command Registration */}
			<div className="min-w-0 space-y-2 rounded-lg border p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-sm font-medium">
						{t("settings.telegramLifecycle.steps.commandsTitle", "3. Command registration")}
					</p>
					<StepBadge status={candidateSetup.steps.commandRegistration.status} />
				</div>
				<p className="break-words text-xs text-muted-foreground">
					{candidateSetup.steps.commandRegistration.status === "passed"
						? t(
								"settings.telegramLifecycle.steps.commandsPassed",
								"Registered all 11 Z8 commands in the Telegram bot menu.",
							)
						: t(
								"settings.telegramLifecycle.steps.commandsHint",
								"Registers the 11 Z8 slash commands independently so failures can be retried without changing credentials.",
							)}
				</p>
				{candidateSetup.hasStoredCredentials && (
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={retryCommandsMutation.isPending}
						onClick={() => retryCommandsMutation.mutate(candidateSetup.installationId)}
					>
						{retryCommandsMutation.isPending && (
							<IconLoader2 className="mr-1.5 size-4 motion-safe:animate-spin" aria-hidden="true" />
						)}
						{t("settings.telegramLifecycle.retryCommandsButton", "Retry command registration")}
					</Button>
				)}
			</div>

			{/* Step 4: Synthetic Private Delivery */}
			<div className="min-w-0 space-y-2 rounded-lg border p-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-sm font-medium">
						{t("settings.telegramLifecycle.steps.privateDeliveryTitle", "4. Private delivery")}
					</p>
					<StepBadge status={candidateSetup.steps.privateDelivery.status} />
				</div>
				<p className="break-words text-xs text-muted-foreground">
					{t(
						"settings.telegramLifecycle.steps.privateDeliveryHint",
						"Sends a synthetic private test message to your candidate Telegram chat (never production notifications or approvals).",
					)}
				</p>
				{candidateSetup.hasStoredCredentials && (
					<div className="flex flex-col gap-2 sm:flex-row">
						<Label htmlFor={testChatInputId} className="sr-only">
							{t(
								"settings.telegramLifecycle.testChatIdLabel",
								"Candidate Telegram chat ID (optional if enrolled)",
							)}
						</Label>
						<Input
							id={testChatInputId}
							value={testChatId}
							onChange={(event) => setTestChatId(event.target.value)}
							placeholder={t(
								"settings.telegramLifecycle.testChatIdPlaceholder",
								"Chat ID (optional if linked)",
							)}
							className="min-w-0 flex-1 font-mono text-xs"
						/>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={sendTestMutation.isPending}
							onClick={() =>
								sendTestMutation.mutate({
									installationId: candidateSetup.installationId,
									chatId: testChatId.trim() || undefined,
								})
							}
						>
							{sendTestMutation.isPending ? (
								<IconLoader2
									className="mr-1.5 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : (
								<IconSend className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.telegramLifecycle.sendPrivateTestButton", "Send private test")}
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}

function PreparationCard(props: PanelState) {
	const {
		t,
		refreshMutation,
		prepareMutation,
		saveCredentialsMutation,
		candidateCredentialsForm,
		candidateSetup,
	} = props;
	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<CardTitle className="flex items-center gap-2 text-base">
							<IconBrandTelegram className="size-4 shrink-0" aria-hidden="true" />
							{t(
								"settings.telegramLifecycle.prepareTitle",
								"Prepare & verify replacement Telegram bot",
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.telegramLifecycle.prepareDescription",
								"Stage an organization-owned Telegram bot and verify bot identity, authenticated webhook receipt, command registration, and private delivery while your current bot continues serving open approvals.",
							)}
						</CardDescription>
					</div>
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={refreshMutation.isPending}
							onClick={() => refreshMutation.mutate()}
						>
							<IconRefresh
								className={
									refreshMutation.isPending
										? "mr-1.5 size-4 motion-safe:animate-spin"
										: "mr-1.5 size-4"
								}
								aria-hidden="true"
							/>
							{t("settings.telegramLifecycle.refresh", "Refresh")}
						</Button>
						{!candidateSetup && (
							<Button
								type="button"
								size="sm"
								disabled={prepareMutation.isPending}
								onClick={() => prepareMutation.mutate()}
							>
								{prepareMutation.isPending && (
									<IconLoader2
										className="mr-1.5 size-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								)}
								{t("settings.telegramLifecycle.prepareButton", "Prepare replacement Telegram bot")}
							</Button>
						)}
					</div>
				</div>
			</CardHeader>

			{candidateSetup && (
				<CardContent className="space-y-4">
					{/* Write-only BotFather token form */}
					<form
						className="space-y-3 rounded-lg border bg-muted/30 p-3"
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void candidateCredentialsForm.handleSubmit();
						}}
					>
						<candidateCredentialsForm.Field name="botToken">
							{(field) => (
								<TFormItem className="space-y-1.5">
									<TFormLabel>
										{t("settings.telegramLifecycle.botTokenLabel", "BotFather Token (write-only)")}
									</TFormLabel>
									<div className="flex flex-col gap-2 sm:flex-row">
										<TFormControl>
											<Input
												type="password"
												autoComplete="off"
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) => field.handleChange(event.target.value)}
												placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
												className="min-w-0 flex-1 font-mono text-sm"
											/>
										</TFormControl>
										<Button
											type="submit"
											size="sm"
											disabled={saveCredentialsMutation.isPending || !field.state.value.trim()}
										>
											{saveCredentialsMutation.isPending && (
												<IconLoader2
													className="mr-1.5 size-4 motion-safe:animate-spin"
													aria-hidden="true"
												/>
											)}
											{t(
												"settings.telegramLifecycle.verifyTokenButton",
												"Verify bot & configure webhook",
											)}
										</Button>
									</div>
									<p className="break-all text-xs text-muted-foreground">
										{t(
											"settings.telegramLifecycle.webhookEndpointLabel",
											"Dedicated webhook route:",
										)}{" "}
										<code className="font-mono">{candidateSetup.webhookUrl}</code>
									</p>
								</TFormItem>
							)}
						</candidateCredentialsForm.Field>
					</form>

					{/* 4 Separate, Independently Tracked Verification Steps */}
					<VerificationSteps {...props} candidateSetup={candidateSetup} />
				</CardContent>
			)}
		</Card>
	);
}

function SwitchReviewCard(props: PanelState) {
	const {
		t,
		summaryRef,
		acknowledgedUnready,
		setAcknowledgedUnready,
		impactChangedNotice,
		confirmSwitchMutation,
		confirmRestoreMutation,
		switchPreview,
		candidate,
		isRestoringCandidate,
		ackCheckboxId,
		canSubmitSwitch,
		handleConfirmSwitch,
	} = props;
	return (
		candidate && (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<IconArrowsExchange className="size-4 shrink-0" aria-hidden="true" />
						{t("settings.telegramLifecycle.switchTitle", "Review impact & switch Telegram bot")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.telegramLifecycle.switchDescription",
							"Review employee reachability, open approval cards, and in-flight work before switching. Existing open cards stay serviceable on the retiring bot during the 30-day retirement window.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{impactChangedNotice && (
						<div
							role="alert"
							className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
						>
							{impactChangedNotice}
						</div>
					)}

					<div
						ref={summaryRef}
						tabIndex={-1}
						className="space-y-3 rounded-lg border bg-muted/20 p-3 focus:outline-none focus:ring-2 focus:ring-ring"
					>
						<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
							<MetricTile
								label={t("settings.telegramLifecycle.metrics.reachable", "Verified reachable")}
								value={switchPreview.employeeImpact.verifiedReachableEmployees}
							/>
							<MetricTile
								label={t("settings.telegramLifecycle.metrics.actionNeeded", "Action needed")}
								value={switchPreview.employeeImpact.actionNeededEmployees}
							/>
							<MetricTile
								label={t("settings.telegramLifecycle.metrics.unknown", "Unknown reachability")}
								value={switchPreview.employeeImpact.unknownReachabilityEmployees}
							/>
							<MetricTile
								label={t("settings.telegramLifecycle.metrics.openCards", "Open approval cards")}
								value={
									switchPreview.approvalImpact.openCanonicalCards +
									switchPreview.approvalImpact.openLegacyOwnerCards +
									switchPreview.approvalImpact.pendingLegacyCards
								}
							/>
							<MetricTile
								label={t("settings.telegramLifecycle.metrics.inFlight", "In-flight work")}
								value={
									switchPreview.approvalImpact.outstandingDeliveryWork +
									switchPreview.inFlightNotificationImpact.intentRecorded
								}
							/>
							<MetricTile
								label={t("settings.telegramLifecycle.metrics.uncertain", "Needs reconciliation")}
								value={
									switchPreview.approvalImpact.uncertainApprovalWork +
									switchPreview.inFlightNotificationImpact.reconciliationRequired
								}
							/>
						</div>
					</div>

					{!switchPreview.switchControlEnabled && (
						<p className="text-xs text-muted-foreground">
							{t(
								"settings.telegramLifecycle.switchGateDisabled",
								"Telegram switching is currently gated off for this organization. Complete verification above so you are ready when enabled.",
							)}
						</p>
					)}

					{switchPreview.requiresUnreadyAcknowledgement && (
						<div className="flex items-start gap-2 rounded-lg border p-3">
							<input
								id={ackCheckboxId}
								type="checkbox"
								className="mt-1 size-4"
								checked={acknowledgedUnready}
								onChange={(event) => setAcknowledgedUnready(event.target.checked)}
							/>
							<Label htmlFor={ackCheckboxId} className="text-sm font-normal">
								{t(
									"settings.telegramLifecycle.acknowledgeUnready",
									"I acknowledge that {count} employees still need to start and link the new Telegram bot in Settings -> Notifications.",
									{ count: String(switchPreview.employeeImpact.unreadyEmployees) },
								)}
							</Label>
						</div>
					)}

					<div className="flex flex-wrap items-center gap-2">
						<Button type="button" disabled={!canSubmitSwitch} onClick={handleConfirmSwitch}>
							{(confirmSwitchMutation.isPending || confirmRestoreMutation.isPending) && (
								<IconLoader2
									className="mr-1.5 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							)}
							<IconShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
							{isRestoringCandidate
								? t("settings.telegramLifecycle.confirmRestoreButton", "Confirm restore")
								: t("settings.telegramLifecycle.confirmSwitchButton", "Confirm switch")}
						</Button>
					</div>
				</CardContent>
			</Card>
		)
	);
}

function RetiringInstallationsCard(props: PanelState) {
	const { t, switchPreview } = props;
	return (
		switchPreview.retiringInstallations.length > 0 && (
			<Card>
				<CardHeader>
					<CardTitle className="text-base">
						{t("settings.telegramLifecycle.retiringTitle", "Retiring Telegram bots")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.telegramLifecycle.retiringDescription",
							"Retiring bots keep servicing open approval cards they already sent until all open cards settle or the 30-day retirement deadline is reached.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					{switchPreview.retiringInstallations.map((retiring) => (
						<div
							key={retiring.id}
							className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0 space-y-1">
								<p className="truncate text-sm font-medium">
									{retiring.externalDisplayName ?? retiring.id}
								</p>
								<p className="text-xs text-muted-foreground">
									{t(
										"settings.telegramLifecycle.retiringStats",
										"Outstanding cards/work: {count}",
										{ count: String(retiring.totalOutstandingCardsAndWork) },
									)}
									{retiring.retirementDeadlineAt
										? ` · ${t("settings.telegramLifecycle.retiringDeadline", "Deadline: {date}", {
												date: retiring.retirementDeadlineAt.slice(0, 10),
											})}`
										: ""}
								</p>
							</div>
							<Badge variant="outline">
								{t("settings.telegramLifecycle.retiringBadge", "Retiring")}
							</Badge>
						</div>
					))}
				</CardContent>
			</Card>
		)
	);
}

function RecoveryCard(props: PanelState) {
	const {
		t,
		rotateMutation,
		rotateTokenForm,
		revokeMutation,
		prepareRestoreMutation,
		recoveryState,
	} = props;
	return (
		(recoveryState.activeInstallation || recoveryState.restorableInstallations.length > 0) && (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-base">
						<IconKey className="size-4 shrink-0" aria-hidden="true" />
						{t(
							"settings.telegramLifecycle.recoveryTitle",
							"Credential rotation, revocation & recovery",
						)}
					</CardTitle>
					<CardDescription>{recoveryState.rotationGuidance.summary}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{recoveryState.activeInstallation?.canRotate && (
						<form
							className="space-y-3 rounded-lg border p-3"
							onSubmit={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void rotateTokenForm.handleSubmit();
							}}
						>
							<p className="text-sm font-medium">
								{t(
									"settings.telegramLifecycle.rotateTitle",
									"Rotate BotFather token (same bot identity)",
								)}
							</p>
							<p className="text-xs text-muted-foreground">
								{recoveryState.rotationGuidance.interruptionDetails}
							</p>
							<rotateTokenForm.Field name="botToken">
								{(field) => (
									<TFormItem>
										<TFormLabel className="sr-only">
											{t("settings.telegramLifecycle.rotateTokenLabel", "New BotFather token")}
										</TFormLabel>
										<div className="flex flex-col gap-2 sm:flex-row">
											<TFormControl>
												<Input
													type="password"
													autoComplete="off"
													value={field.state.value}
													onBlur={field.handleBlur}
													onChange={(event) => field.handleChange(event.target.value)}
													placeholder="123456789:NEWrotatedBotToken..."
													className="min-w-0 flex-1 font-mono text-sm"
												/>
											</TFormControl>
											<Button
												type="submit"
												variant="outline"
												size="sm"
												disabled={rotateMutation.isPending || !field.state.value.trim()}
											>
												{rotateMutation.isPending && (
													<IconLoader2
														className="mr-1.5 size-4 motion-safe:animate-spin"
														aria-hidden="true"
													/>
												)}
												{t("settings.telegramLifecycle.rotateButton", "Rotate token")}
											</Button>
										</div>
									</TFormItem>
								)}
							</rotateTokenForm.Field>
						</form>
					)}

					{recoveryState.activeInstallation?.canRevoke && (
						<div className="flex flex-col gap-2 rounded-lg border border-destructive/30 p-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 space-y-0.5">
								<p className="text-sm font-medium">
									{t("settings.telegramLifecycle.revokeTitle", "Revoke active Telegram bot")}
								</p>
								<p className="text-xs text-muted-foreground">
									{t(
										"settings.telegramLifecycle.revokeDescription",
										"Immediately stops local authorization and queues generation-fenced webhook cleanup. Open approvals stay accessible in Z8.",
									)}
								</p>
							</div>
							<Button
								type="button"
								variant="destructive"
								size="sm"
								disabled={revokeMutation.isPending}
								onClick={() =>
									revokeMutation.mutate({
										installationId: recoveryState.activeInstallation!.id,
									})
								}
							>
								<IconShieldOff className="mr-1.5 size-4" aria-hidden="true" />
								{t("settings.telegramLifecycle.revokeButton", "Revoke access")}
							</Button>
						</div>
					)}

					{recoveryState.restorableInstallations.length > 0 && (
						<div className="space-y-2">
							<p className="text-sm font-medium">
								{t(
									"settings.telegramLifecycle.restoreListTitle",
									"Previous organization-owned Telegram bots",
								)}
							</p>
							{recoveryState.restorableInstallations.map((inst) => (
								<div
									key={inst.id}
									className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0 space-y-0.5">
										<p className="truncate text-sm font-medium">
											{inst.externalBotUsername
												? `@${inst.externalBotUsername.replace(/^@/, "")}`
												: (inst.externalDisplayName ?? inst.id)}
										</p>
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.telegramLifecycle.restoreMeta",
												"Status: {status} · Endpoint: {endpointState} · Gen {generation}",
												{
													status: inst.status,
													endpointState: inst.endpointState,
													generation: String(inst.endpointGeneration),
												},
											)}
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={prepareRestoreMutation.isPending}
										onClick={() => prepareRestoreMutation.mutate(inst.id)}
									>
										<IconRotateClockwise className="mr-1.5 size-4" aria-hidden="true" />
										{t("settings.telegramLifecycle.restoreButton", "Begin verified restore")}
									</Button>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		)
	);
}

export function TelegramLifecyclePanel(props: TelegramLifecyclePanelProps) {
	const model = useTelegramLifecyclePanel(props);
	if (!model) return null;
	const { announcement, errorMessage } = model;
	return (
		<div className="min-w-0 space-y-6">
			<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
				{announcement}
			</div>

			{errorMessage && (
				<div
					role="alert"
					className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
				>
					{errorMessage}
				</div>
			)}

			{/* 1. Prepare & Verify Replacement Telegram Bot */}
			<PreparationCard {...model} />

			{/* 2. Switch Impact Review & Confirmation */}
			<SwitchReviewCard {...model} />

			{/* 3. Retiring Installations */}
			<RetiringInstallationsCard {...model} />

			{/* 4. Recovery: Same-Bot Token Rotation, Revoke, & Restore */}
			<RecoveryCard {...model} />
		</div>
	);
}
