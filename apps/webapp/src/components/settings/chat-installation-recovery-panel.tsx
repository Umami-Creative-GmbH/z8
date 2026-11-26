"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconHistory,
	IconInfoCircle,
	IconKey,
	IconLoader2,
	IconRefresh,
	IconRotateClockwise,
	IconSend,
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
	ConfirmedSlackRestoreData,
	ConfirmSlackRestoreActionInput,
	PreparedSlackRestoreData,
	PrepareSlackRestoreActionInput,
	RevokedSlackInstallationData,
	RevokeSlackInstallationActionInput,
	RotatedSlackInstallationData,
	RotateSlackCredentialsActionInput,
	VerifiedSlackRestoreData,
	VerifySlackRestoreActionInput,
} from "@/app/[locale]/(app)/settings/notification-channels/recovery-actions";
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
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { ChatInstallationRecoveryState } from "@/lib/chat-installations/recovery-lifecycle";
import type { ChatSwitchImpactPreview } from "@/lib/chat-installations/switch-lifecycle";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

const RECOVERY_REFUSALS = {
	installation_not_found: [
		"settings.recovery.errors.installationNotFound",
		"The selected chat installation could not be found.",
	],
	deployment_managed_not_rotatable: [
		"settings.recovery.errors.deploymentManagedNotRotatable",
		"Deployment-managed connections cannot rotate credentials here. Prepare and switch to an organization-owned app instead.",
	],
	installation_not_rotatable: [
		"settings.recovery.errors.installationNotRotatable",
		"This installation cannot rotate credentials in its current state.",
	],
	invalid_bot_token_format: [
		"settings.recovery.errors.invalidBotTokenFormat",
		"Bot token must start with xoxb-.",
	],
	invalid_signing_secret_format: [
		"settings.recovery.errors.invalidSigningSecretFormat",
		"Signing secret must be at least 16 characters with no spaces.",
	],
	invalid_bot_token: [
		"settings.recovery.errors.invalidBotToken",
		"Slack rejected the bot token. Check your Bot User OAuth Token and try again.",
	],
	missing_slack_scope: [
		"settings.recovery.errors.missingSlackScope",
		"The bot token is missing required Slack scopes (including users:read).",
	],
	external_identity_mismatch: [
		"settings.recovery.errors.externalIdentityMismatch",
		"The credentials belong to a different app or workspace. Rotation requires the exact same external identity; use app replacement to switch apps.",
	],
	provider_unavailable: [
		"settings.recovery.errors.providerUnavailable",
		"The chat provider API is temporarily unavailable. Please retry.",
	],
	secret_store_unavailable: [
		"settings.recovery.errors.secretStoreUnavailable",
		"The organization secret store is currently unavailable. Existing credentials remain active.",
	],
	credential_write_failed: [
		"settings.recovery.errors.credentialWriteFailed",
		"Failed to store credentials securely. Existing credentials remain unchanged.",
	],
	deployment_managed_not_restorable: [
		"settings.recovery.errors.deploymentManagedNotRestorable",
		"Deployment-managed connections cannot be restored as organization-owned replacements.",
	],
	installation_not_restorable: [
		"settings.recovery.errors.installationNotRestorable",
		"Only retiring, retired, or revoked installations can be restored.",
	],
	endpoint_reconciliation_required: [
		"settings.recovery.errors.endpointReconciliationRequired",
		"Provider endpoint state is uncertain after a timed-out cleanup. Reconcile endpoint state before restoring.",
	],
	credentials_required: [
		"settings.recovery.errors.credentialsRequired",
		"Enter fresh credentials to re-verify this installation before restoring.",
	],
	invalid_slack_user_id: [
		"settings.recovery.errors.invalidSlackUserId",
		"Enter a valid Slack member ID (for example, U01234567).",
	],
	private_delivery_failed: [
		"settings.recovery.errors.privateDeliveryFailed",
		"Could not send the synthetic private test message. Check bot permissions and retry.",
	],
	switch_not_enabled: [
		"settings.recovery.errors.switchNotEnabled",
		"Switching or restoring an organization-owned app is not enabled for this organization yet.",
	],
	candidate_not_ready: [
		"settings.recovery.errors.candidateNotReady",
		"Complete all fresh verification steps before confirming restore.",
	],
	candidate_verification_expired: [
		"settings.recovery.errors.candidateVerificationExpired",
		"Verification proofs have expired. Re-verify before confirming restore.",
	],
	impact_changed: [
		"settings.recovery.errors.impactChanged",
		"Impact or revisions changed since your review. Review the updated summary and confirm again.",
	],
	unready_acknowledgement_required: [
		"settings.recovery.errors.unreadyAckRequired",
		"Acknowledge that some employees still need to connect or verify direct messages before restoring.",
	],
} satisfies RefusalMessages<
	| "installation_not_found"
	| "deployment_managed_not_rotatable"
	| "installation_not_rotatable"
	| "invalid_bot_token_format"
	| "invalid_signing_secret_format"
	| "invalid_bot_token"
	| "missing_slack_scope"
	| "external_identity_mismatch"
	| "provider_unavailable"
	| "secret_store_unavailable"
	| "credential_write_failed"
	| "deployment_managed_not_restorable"
	| "installation_not_restorable"
	| "endpoint_reconciliation_required"
	| "credentials_required"
	| "invalid_slack_user_id"
	| "private_delivery_failed"
	| "switch_not_enabled"
	| "candidate_not_ready"
	| "candidate_verification_expired"
	| "impact_changed"
	| "unready_acknowledgement_required"
>;

export interface ChatInstallationRecoveryPanelProps {
	channelName: string;
	initialState: ChatInstallationRecoveryState | null;
	refreshStateAction: () => Promise<ServerActionResult<ChatInstallationRecoveryState>>;
	rotateCredentialsAction: (
		input: RotateSlackCredentialsActionInput,
	) => Promise<ServerActionResult<RotatedSlackInstallationData>>;
	revokeInstallationAction: (
		input: RevokeSlackInstallationActionInput,
	) => Promise<ServerActionResult<RevokedSlackInstallationData>>;
	prepareRestoreAction: (
		input: PrepareSlackRestoreActionInput,
	) => Promise<ServerActionResult<PreparedSlackRestoreData>>;
	verifyRestoreAction: (
		input: VerifySlackRestoreActionInput,
	) => Promise<ServerActionResult<VerifiedSlackRestoreData>>;
	confirmRestoreAction: (
		input: ConfirmSlackRestoreActionInput,
	) => Promise<ServerActionResult<ConfirmedSlackRestoreData>>;
}

function isPreviewPayload(value: unknown): value is ChatSwitchImpactPreview {
	return (
		typeof value === "object" &&
		value !== null &&
		"impactDigest" in value &&
		typeof (value as { impactDigest?: unknown }).impactDigest === "string"
	);
}

export function ChatInstallationRecoveryPanel({
	channelName,
	initialState,
	refreshStateAction,
	rotateCredentialsAction,
	revokeInstallationAction,
	prepareRestoreAction,
	verifyRestoreAction,
	confirmRestoreAction,
}: ChatInstallationRecoveryPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const idPrefix = useId();

	const rotateTriggerRef = useRef<HTMLButtonElement | null>(null);
	const revokeTriggerRef = useRef<HTMLButtonElement | null>(null);
	const restoreSummaryRef = useRef<HTMLDivElement | null>(null);

	const [state, setState] = useState<ChatInstallationRecoveryState | null>(initialState);
	const [rotateDialogOpen, setRotateDialogOpen] = useState(false);
	const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
	const [lastRotationResult, setLastRotationResult] = useState<RotatedSlackInstallationData | null>(
		null,
	);
	const [rotateError, setRotateError] = useState<string | null>(null);
	const [revokeError, setRevokeError] = useState<string | null>(null);
	const [restoreError, setRestoreError] = useState<string | null>(null);
	const [restoreImpactChangedNotice, setRestoreImpactChangedNotice] = useState<string | null>(null);
	const [acknowledgedUnready, setAcknowledgedUnready] = useState(false);
	const [announcement, setAnnouncement] = useState("");

	const restoreFocus = (ref: React.RefObject<HTMLButtonElement | null>) => {
		queueMicrotask(() => {
			ref.current?.focus();
		});
	};

	const refreshMutation = useMutation({
		mutationFn: () => refreshStateAction(),
		onSuccess: (result) => {
			if (result.success) {
				setState(result.data);
				setRestoreError(null);
				setRestoreImpactChangedNotice(null);
				const msg = t(
					"settings.recovery.refreshedAnnouncement",
					"{channel} recovery state refreshed.",
					{ channel: channelName },
				);
				setAnnouncement(msg);
			} else {
				const msg = actionErrorMessage(t, result, RECOVERY_REFUSALS, [
					"settings.recovery.errors.refreshFailed",
					"Could not refresh recovery state.",
				]);
				setRestoreError(msg);
				setAnnouncement(msg);
				toast.error(msg);
			}
		},
	});

	const rotateMutation = useMutation({
		mutationFn: (input: RotateSlackCredentialsActionInput) => rotateCredentialsAction(input),
		onSuccess: (result) => {
			if (result.success) {
				setState(result.data.recoveryState);
				setLastRotationResult(result.data);
				setRotateError(null);
				rotateForm.reset();
				setRotateDialogOpen(false);
				restoreFocus(rotateTriggerRef);
				const msg = t(
					"settings.recovery.rotate.successAnnouncement",
					"Credentials rotated to revision v{revision}. Follow the verification steps below to confirm recovery.",
					{ revision: String(result.data.newRevisionNumber) },
				);
				setAnnouncement(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, RECOVERY_REFUSALS, [
					"settings.recovery.errors.rotateFailed",
					"Could not rotate installation credentials.",
				]);
				setRotateError(msg);
				setAnnouncement(msg);
				toast.error(msg);
			}
		},
		onError: () => {
			const msg = t(
				"settings.recovery.errors.rotateFailed",
				"Could not rotate installation credentials.",
			);
			setRotateError(msg);
			setAnnouncement(msg);
			toast.error(msg);
		},
	});

	const revokeMutation = useMutation({
		mutationFn: (input: RevokeSlackInstallationActionInput) => revokeInstallationAction(input),
		onSuccess: (result) => {
			if (result.success) {
				setState(result.data.recoveryState);
				setRevokeError(null);
				setRevokeDialogOpen(false);
				restoreFocus(revokeTriggerRef);
				const msg = t(
					"settings.recovery.revoke.successAnnouncement",
					"Installation revoked immediately. Pending approvals remain accessible in the Z8 inbox.",
				);
				setAnnouncement(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, RECOVERY_REFUSALS, [
					"settings.recovery.errors.revokeFailed",
					"Could not revoke chat installation.",
				]);
				setRevokeError(msg);
				setAnnouncement(msg);
				toast.error(msg);
			}
		},
		onError: () => {
			const msg = t("settings.recovery.errors.revokeFailed", "Could not revoke chat installation.");
			setRevokeError(msg);
			setAnnouncement(msg);
			toast.error(msg);
		},
	});

	const prepareRestoreMutation = useMutation({
		mutationFn: (input: PrepareSlackRestoreActionInput) => prepareRestoreAction(input),
		onSuccess: (result) => {
			if (result.success) {
				setState(result.data.recoveryState);
				setRestoreError(null);
				setRestoreImpactChangedNotice(null);
				setAcknowledgedUnready(false);
				const msg = t(
					"settings.recovery.restore.startedAnnouncement",
					"Restore started. Complete fresh verification and review impact before reactivating.",
				);
				setAnnouncement(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, RECOVERY_REFUSALS, [
					"settings.recovery.errors.prepareRestoreFailed",
					"Could not start restoring this installation.",
				]);
				setRestoreError(msg);
				setAnnouncement(msg);
				toast.error(msg);
			}
		},
	});

	const verifyRestoreMutation = useMutation({
		mutationFn: (input: VerifySlackRestoreActionInput) => verifyRestoreAction(input),
		onSuccess: (result) => {
			if (result.success) {
				setState(result.data.recoveryState);
				setRestoreError(null);
				restoreVerifyForm.reset();
				const msg = result.data.readyForSwitch
					? t(
							"settings.recovery.restore.verifiedReadyAnnouncement",
							"Fresh restore verification complete. Review impact and confirm restore.",
						)
					: t(
							"settings.recovery.restore.verifiedStepAnnouncement",
							"Restore verification step recorded. Complete remaining checks before confirming.",
						);
				setAnnouncement(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, RECOVERY_REFUSALS, [
					"settings.recovery.errors.verifyRestoreFailed",
					"Could not verify the installation for restore.",
				]);
				setRestoreError(msg);
				setAnnouncement(msg);
				toast.error(msg);
			}
		},
	});

	const confirmRestoreMutation = useMutation({
		mutationFn: (input: ConfirmSlackRestoreActionInput) => confirmRestoreAction(input),
		onSuccess: (result) => {
			if (result.success) {
				setState(result.data.recoveryState);
				setRestoreError(null);
				setRestoreImpactChangedNotice(null);
				setAcknowledgedUnready(false);
				const msg = t(
					"settings.recovery.restore.confirmedAnnouncement",
					"Previous installation verified and restored as active.",
				);
				setAnnouncement(msg);
				toast.success(msg);
				router.refresh();
				return;
			}

			const freshPreview =
				result.details && "preview" in result.details && isPreviewPayload(result.details.preview)
					? result.details.preview
					: null;
			if (freshPreview) {
				setState((prev) => (prev ? { ...prev, restoreCandidatePreview: freshPreview } : prev));
				setAcknowledgedUnready(false);
			}

			const msg = actionErrorMessage(t, result, RECOVERY_REFUSALS, [
				"settings.recovery.errors.confirmRestoreFailed",
				"Could not confirm installation restore.",
			]);

			if (result.refusal === "impact_changed") {
				setRestoreImpactChangedNotice(msg);
				setRestoreError(null);
				setAnnouncement(msg);
				queueMicrotask(() => {
					restoreSummaryRef.current?.focus();
				});
				return;
			}

			setRestoreError(msg);
			setAnnouncement(msg);
			toast.error(msg);
		},
	});

	const rotateForm = useForm({
		defaultValues: {
			botToken: "",
			signingSecret: "",
		},
		onSubmit: async ({ value }) => {
			const activeInst = state?.activeInstallation;
			if (!activeInst) return;
			setRotateError(null);
			rotateMutation.mutate({
				installationId: activeInst.id,
				botToken: value.botToken,
				signingSecret: value.signingSecret,
			});
		},
	});

	const restoreVerifyForm = useForm({
		defaultValues: {
			botToken: "",
			signingSecret: "",
			slackUserId: "",
		},
		onSubmit: async ({ value }) => {
			const candidateId = state?.restoreCandidateSetup?.installationId;
			if (!candidateId) return;
			setRestoreError(null);
			verifyRestoreMutation.mutate({
				installationId: candidateId,
				botToken: value.botToken || undefined,
				signingSecret: value.signingSecret || undefined,
				slackUserId: value.slackUserId || undefined,
			});
		},
	});

	const rotateFormValues = useStore(rotateForm.store, (s) => s.values);
	const restoreVerifyValues = useStore(restoreVerifyForm.store, (s) => s.values);

	if (!state) {
		return null;
	}

	const activeInstallation = state.activeInstallation;
	const hasContent =
		Boolean(activeInstallation) ||
		state.restorableInstallations.length > 0 ||
		Boolean(state.restoreCandidateSetup) ||
		state.pendingCleanupJobs.length > 0;

	if (!hasContent) {
		return null;
	}

	const restoreSetup = state.restoreCandidateSetup;
	const restorePreview = state.restoreCandidatePreview;
	const ackCheckboxId = `${idPrefix}-restore-ack-unready`;
	const rotateBotTokenId = `${idPrefix}-rotate-bot-token`;
	const rotateSigningSecretId = `${idPrefix}-rotate-signing-secret`;
	const restoreBotTokenId = `${idPrefix}-restore-bot-token`;
	const restoreSigningSecretId = `${idPrefix}-restore-signing-secret`;
	const restoreSlackUserId = `${idPrefix}-restore-slack-user`;

	const canSubmitRestoreConfirm =
		Boolean(restorePreview?.candidateInstallation) &&
		Boolean(restorePreview?.canConfirm) &&
		!confirmRestoreMutation.isPending &&
		(!restorePreview?.requiresUnreadyAcknowledgement || acknowledgedUnready);

	const handleRotateDialogOpenChange = (open: boolean) => {
		setRotateDialogOpen(open);
		if (!open) {
			rotateForm.reset();
			setRotateError(null);
			restoreFocus(rotateTriggerRef);
		}
	};

	const handleRevokeDialogOpenChange = (open: boolean) => {
		setRevokeDialogOpen(open);
		if (!open) {
			setRevokeError(null);
			restoreFocus(revokeTriggerRef);
		}
	};

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<CardTitle className="flex items-center gap-2 text-base">
							<IconRotateClockwise className="size-4 shrink-0" aria-hidden="true" />
							{t(
								"settings.recovery.title",
								"{channel} credential rotation, revocation & recovery",
								{
									channel: channelName,
								},
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.recovery.description",
								"Rotate credentials for the same app identity, revoke local authorization immediately, or re-verify and restore a previous installation.",
							)}
						</CardDescription>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-fit shrink-0"
						onClick={() => refreshMutation.mutate()}
						disabled={refreshMutation.isPending}
					>
						{refreshMutation.isPending ? (
							<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
						) : (
							<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
						)}
						{t("settings.recovery.refresh", "Refresh")}
					</Button>
				</div>
			</CardHeader>

			<CardContent className="min-w-0 space-y-6">
				<div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
					{announcement}
				</div>

				{/* Active installation rotation & immediate revocation */}
				{activeInstallation ? (
					<div className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 space-y-1">
								<p className="break-words text-sm font-medium">
									{activeInstallation.externalDisplayName ??
										activeInstallation.externalSpaceName ??
										channelName}
								</p>
								<p className="break-words text-xs text-muted-foreground">
									{activeInstallation.externalAppId
										? `${t("settings.recovery.appIdLabel", "App ID")}: ${activeInstallation.externalAppId}`
										: t("settings.recovery.deploymentManagedLabel", "Deployment-managed app")}
									{activeInstallation.externalSpaceId
										? ` · ${activeInstallation.externalSpaceName ?? activeInstallation.externalSpaceId}`
										: ""}
								</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<Badge variant="default">
									{activeInstallation.status === "active"
										? t("settings.recovery.status.active", "Active")
										: t("settings.recovery.status.legacyActive", "Legacy active")}
								</Badge>
								{activeInstallation.endpointState === "uncertain" ? (
									<Badge variant="destructive">
										{t("settings.recovery.endpointState.uncertain", "Endpoint uncertain")}
									</Badge>
								) : null}
							</div>
						</div>

						{/* Provider-specific interruption guidance */}
						<div className="rounded-md border bg-background p-3 text-xs text-muted-foreground">
							<p className="flex items-center gap-1.5 font-medium text-foreground">
								<IconInfoCircle className="size-4 shrink-0" aria-hidden="true" />
								{t(
									"settings.recovery.guidance.heading",
									"Provider interruption & recovery guidance",
								)}
							</p>
							<p className="mt-1 break-words">{state.rotationGuidance.interruptionDetails}</p>
						</div>

						<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
							{activeInstallation.canRotate ? (
								<Button
									ref={rotateTriggerRef}
									type="button"
									variant="outline"
									size="sm"
									onClick={() => setRotateDialogOpen(true)}
								>
									<IconKey className="mr-1.5 size-4" aria-hidden="true" />
									{t("settings.recovery.rotate.openButton", "Rotate credentials")}
								</Button>
							) : null}

							{activeInstallation.canRevoke ? (
								<Button
									ref={revokeTriggerRef}
									type="button"
									variant="destructive"
									size="sm"
									onClick={() => setRevokeDialogOpen(true)}
								>
									<IconShieldOff className="mr-1.5 size-4" aria-hidden="true" />
									{t("settings.recovery.revoke.openButton", "Revoke access immediately")}
								</Button>
							) : null}
						</div>

						{/* Post-rotation verification checklist */}
						{lastRotationResult ? (
							<div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-xs">
								<p className="flex items-center gap-1.5 font-medium text-foreground">
									<IconCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
									{t(
										"settings.recovery.rotate.postRotationHeading",
										"Credentials rotated to revision v{revision} — verify recovery",
										{ revision: String(lastRotationResult.newRevisionNumber) },
									)}
								</p>
								<ol className="mt-2 list-decimal space-y-1 pl-4 text-muted-foreground">
									{lastRotationResult.guidance.verificationSteps.map((step) => (
										<li key={step} className="break-words">
											{step}
										</li>
									))}
								</ol>
							</div>
						) : null}
					</div>
				) : null}

				{/* Restorable previous installations */}
				{state.restorableInstallations.length > 0 ? (
					<div className="min-w-0 space-y-3">
						<div className="space-y-1">
							<h3 className="flex items-center gap-1.5 text-sm font-medium">
								<IconHistory className="size-4 shrink-0" aria-hidden="true" />
								{t(
									"settings.recovery.restore.listHeading",
									"Previous installations available to restore",
								)}
							</h3>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.recovery.restore.listDescription",
									"Restoring a previous installation requires fresh credential and delivery verification plus a fresh impact review before it becomes active.",
								)}
							</p>
						</div>

						{restoreError ? (
							<div
								role="alert"
								className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
							>
								{restoreError}
							</div>
						) : null}

						<ul className="space-y-2">
							{state.restorableInstallations.map((inst) => (
								<li
									key={inst.id}
									className="flex flex-col gap-3 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="min-w-0 space-y-0.5">
										<p className="break-words text-sm font-medium">
											{inst.externalDisplayName ?? inst.externalSpaceName ?? channelName}
										</p>
										<p className="break-words text-xs text-muted-foreground">
											{inst.externalAppId ? `${inst.externalAppId} · ` : ""}
											{inst.status}
											{inst.revokedAt
												? ` · ${t("settings.recovery.restore.revokedAt", "Revoked: {timestamp}", { timestamp: inst.revokedAt })}`
												: inst.retiredAt
													? ` · ${t("settings.recovery.restore.retiredAt", "Retired: {timestamp}", { timestamp: inst.retiredAt })}`
													: ""}
										</p>
										{inst.endpointState === "uncertain" ? (
											<p className="text-xs text-destructive">
												{t(
													"settings.recovery.restore.uncertainWarning",
													"Endpoint cleanup timed out; endpoint reconciliation is required before restoring.",
												)}
											</p>
										) : null}
									</div>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="w-fit shrink-0"
										disabled={prepareRestoreMutation.isPending}
										onClick={() => prepareRestoreMutation.mutate({ installationId: inst.id })}
									>
										{prepareRestoreMutation.isPending ? (
											<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
										) : (
											<IconHistory className="mr-1.5 size-4" aria-hidden="true" />
										)}
										{t("settings.recovery.restore.startButton", "Start restore & verify")}
									</Button>
								</li>
							))}
						</ul>
					</div>
				) : null}

				{/* In-progress restore verification & fresh impact review */}
				{restoreSetup ? (
					<div className="min-w-0 space-y-4 rounded-lg border border-primary/30 bg-background p-4">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
							<div className="min-w-0 space-y-0.5">
								<h3 className="flex items-center gap-1.5 text-sm font-medium">
									<IconShieldCheck className="size-4 shrink-0" aria-hidden="true" />
									{t(
										"settings.recovery.restore.verifyHeading",
										"Verify installation before restoring",
									)}
								</h3>
								<p className="break-words text-xs text-muted-foreground">
									{t(
										"settings.recovery.restore.verifyDescription",
										"Re-verify credentials, receive a fresh signed Slack event, and send a synthetic private DM test before confirming restore.",
									)}
								</p>
							</div>
							<Badge variant={restoreSetup.readyForSwitch ? "default" : "secondary"}>
								{restoreSetup.readyForSwitch
									? t("settings.recovery.restore.readyBadge", "Ready to confirm restore")
									: t("settings.recovery.restore.pendingBadge", "Verification required")}
							</Badge>
						</div>

						{restoreError ? (
							<div
								role="alert"
								className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
							>
								{restoreError}
							</div>
						) : null}

						<form
							onSubmit={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void restoreVerifyForm.handleSubmit();
							}}
							className="space-y-3"
						>
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<restoreVerifyForm.Field name="botToken">
									{(field) => (
										<TFormItem>
											<TFormLabel htmlFor={restoreBotTokenId}>
												{t(
													"settings.recovery.fields.botToken",
													"Bot User OAuth Token (write-only)",
												)}
											</TFormLabel>
											<TFormControl>
												<Input
													id={restoreBotTokenId}
													type="password"
													autoComplete="off"
													placeholder="xoxb-..."
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
											</TFormControl>
										</TFormItem>
									)}
								</restoreVerifyForm.Field>

								<restoreVerifyForm.Field name="signingSecret">
									{(field) => (
										<TFormItem>
											<TFormLabel htmlFor={restoreSigningSecretId}>
												{t("settings.recovery.fields.signingSecret", "Signing Secret (write-only)")}
											</TFormLabel>
											<TFormControl>
												<Input
													id={restoreSigningSecretId}
													type="password"
													autoComplete="off"
													placeholder="••••••••••••••••"
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
												/>
											</TFormControl>
										</TFormItem>
									)}
								</restoreVerifyForm.Field>
							</div>

							<restoreVerifyForm.Field name="slackUserId">
								{(field) => (
									<TFormItem>
										<TFormLabel htmlFor={restoreSlackUserId}>
											{t(
												"settings.recovery.restore.slackUserIdLabel",
												"Slack Member ID for synthetic DM test (optional)",
											)}
										</TFormLabel>
										<TFormControl>
											<Input
												id={restoreSlackUserId}
												type="text"
												autoComplete="off"
												placeholder="U01234567"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
										</TFormControl>
									</TFormItem>
								)}
							</restoreVerifyForm.Field>

							<Button
								type="submit"
								variant="outline"
								size="sm"
								disabled={
									verifyRestoreMutation.isPending ||
									(!restoreVerifyValues.botToken &&
										!restoreVerifyValues.signingSecret &&
										!restoreVerifyValues.slackUserId &&
										!restoreSetup.hasStoredCredentials)
								}
							>
								{verifyRestoreMutation.isPending ? (
									<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconSend className="mr-1.5 size-4" aria-hidden="true" />
								)}
								{t("settings.recovery.restore.verifyButton", "Verify credentials & test DM")}
							</Button>
						</form>

						{/* Fresh impact review & confirmation */}
						{restorePreview ? (
							<div
								ref={restoreSummaryRef}
								tabIndex={-1}
								className="space-y-3 rounded-lg border bg-muted/20 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
									<p className="text-sm font-medium">
										{t("settings.recovery.restore.impactHeading", "Fresh restore impact review")}
									</p>
									<span className="text-xs text-muted-foreground">
										{t("settings.recovery.restore.snapshot", "Snapshot: {timestamp}", {
											timestamp: restorePreview.generatedAt,
										})}
									</span>
								</div>

								{restoreImpactChangedNotice ? (
									<div
										role="alert"
										className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive"
									>
										<IconAlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
										<p className="break-words">{restoreImpactChangedNotice}</p>
									</div>
								) : null}

								<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
									<div className="rounded border bg-background p-2.5 text-xs">
										<p className="text-muted-foreground">
											{t("settings.recovery.restore.metrics.reachable", "Verified reachable")}
										</p>
										<p className="mt-1 text-lg font-semibold tabular-nums">
											{restorePreview.employeeImpact.verifiedReachableEmployees}
										</p>
									</div>
									<div className="rounded border bg-background p-2.5 text-xs">
										<p className="text-muted-foreground">
											{t(
												"settings.recovery.restore.metrics.unready",
												"Employees needing action / unknown",
											)}
										</p>
										<p className="mt-1 text-lg font-semibold tabular-nums">
											{restorePreview.employeeImpact.unreadyEmployees}
										</p>
									</div>
									<div className="rounded border bg-background p-2.5 text-xs">
										<p className="text-muted-foreground">
											{t(
												"settings.recovery.restore.metrics.approvals",
												"Outstanding approval cards",
											)}
										</p>
										<p className="mt-1 text-lg font-semibold tabular-nums">
											{restorePreview.approvalImpact.totalOutstanding}
										</p>
									</div>
								</div>

								{restorePreview.requiresUnreadyAcknowledgement ? (
									<div className="flex items-start gap-2">
										<input
											id={ackCheckboxId}
											type="checkbox"
											checked={acknowledgedUnready}
											onChange={(e) => setAcknowledgedUnready(e.target.checked)}
											className="mt-0.5 size-4 rounded border-input"
										/>
										<Label htmlFor={ackCheckboxId} className="text-xs leading-relaxed">
											{t(
												"settings.recovery.restore.acknowledgeUnready",
												"I acknowledge that {count} employees still need to connect or verify direct messages after restoring this installation.",
												{ count: String(restorePreview.employeeImpact.unreadyEmployees) },
											)}
										</Label>
									</div>
								) : null}

								<Button
									type="button"
									size="sm"
									disabled={!canSubmitRestoreConfirm}
									onClick={() => {
										if (!restorePreview.candidateInstallation) return;
										setRestoreError(null);
										setRestoreImpactChangedNotice(null);
										confirmRestoreMutation.mutate({
											candidateInstallationId: restorePreview.candidateInstallation.id,
											reviewedCurrentInstallationId: restorePreview.primaryCurrentInstallationId,
											reviewedCurrentCredentialRevisionId:
												restorePreview.primaryCurrentCredentialRevisionId,
											reviewedCandidateCredentialRevisionId:
												restorePreview.candidateInstallation.activeCredentialRevisionId,
											reviewedImpactDigest: restorePreview.impactDigest,
											acknowledgeUnreadyEmployees: acknowledgedUnready,
										});
									}}
								>
									{confirmRestoreMutation.isPending ? (
										<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
									) : (
										<IconShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
									)}
									{t("settings.recovery.restore.confirmButton", "Confirm restore")}
								</Button>
							</div>
						) : null}
					</div>
				) : null}

				{/* Pending / exhausted cleanup jobs (redacted status only) */}
				{state.pendingCleanupJobs.length > 0 ? (
					<div className="min-w-0 space-y-2 rounded-lg border bg-muted/10 p-3 text-xs">
						<p className="font-medium">
							{t("settings.recovery.cleanup.heading", "Background cleanup queue")}
						</p>
						<ul className="space-y-1.5">
							{state.pendingCleanupJobs.map((job) => (
								<li
									key={job.id}
									className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
								>
									<span className="break-words text-muted-foreground">
										{job.kind === "credential_revision_cleanup"
											? t("settings.recovery.cleanup.credentialKind", "Credential revision cleanup")
											: t("settings.recovery.cleanup.endpointKind", "Provider endpoint cleanup")}
										{job.lastErrorCode ? ` (${job.lastErrorCode})` : ""}
									</span>
									<Badge variant={job.status === "exhausted" ? "destructive" : "secondary"}>
										{job.status} ({job.attemptCount}/{job.maxAttempts})
									</Badge>
								</li>
							))}
						</ul>
					</div>
				) : null}

				{/* Rotate credentials dialog */}
				<Dialog open={rotateDialogOpen} onOpenChange={handleRotateDialogOpenChange}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								{t("settings.recovery.rotate.dialogTitle", "Rotate {channel} credentials", {
									channel: channelName,
								})}
							</DialogTitle>
							<DialogDescription>
								{t(
									"settings.recovery.rotate.dialogDescription",
									"Enter new credentials for the exact same app and workspace. Existing DM conversations, employee links, and open approval cards are preserved.",
								)}
							</DialogDescription>
						</DialogHeader>

						<div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
							<p className="font-medium text-foreground">
								{t("settings.recovery.rotate.interruptionTitle", "Provider-imposed interruption")}
							</p>
							<p className="mt-1 break-words text-muted-foreground">
								{state.rotationGuidance.interruptionDetails}
							</p>
						</div>

						{rotateError ? (
							<div
								role="alert"
								className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
							>
								{rotateError}
							</div>
						) : null}

						<form
							onSubmit={(event) => {
								event.preventDefault();
								event.stopPropagation();
								void rotateForm.handleSubmit();
							}}
							className="space-y-4"
						>
							<rotateForm.Field
								name="botToken"
								validators={{
									onSubmit: ({ value }) =>
										!value.trim()
											? t("settings.recovery.validation.botTokenRequired", "Bot token is required.")
											: undefined,
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel htmlFor={rotateBotTokenId}>
											{t("settings.recovery.fields.botToken", "Bot User OAuth Token (write-only)")}
										</TFormLabel>
										<TFormControl>
											<Input
												id={rotateBotTokenId}
												type="password"
												autoComplete="off"
												placeholder="xoxb-..."
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={fieldHasError(field)}
											/>
										</TFormControl>
										<TFormDescription>
											{t(
												"settings.recovery.fields.writeOnlyHint",
												"Stored in a new immutable revision and never displayed again.",
											)}
										</TFormDescription>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</rotateForm.Field>

							<rotateForm.Field
								name="signingSecret"
								validators={{
									onSubmit: ({ value }) =>
										!value.trim()
											? t(
													"settings.recovery.validation.signingSecretRequired",
													"Signing secret is required.",
												)
											: undefined,
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel htmlFor={rotateSigningSecretId}>
											{t("settings.recovery.fields.signingSecret", "Signing Secret (write-only)")}
										</TFormLabel>
										<TFormControl>
											<Input
												id={rotateSigningSecretId}
												type="password"
												autoComplete="off"
												placeholder="••••••••••••••••"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												aria-invalid={fieldHasError(field)}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</rotateForm.Field>

							<DialogFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => handleRotateDialogOpenChange(false)}
								>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button
									type="submit"
									disabled={
										rotateMutation.isPending ||
										!rotateFormValues.botToken.trim() ||
										!rotateFormValues.signingSecret.trim()
									}
								>
									{rotateMutation.isPending ? (
										<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
									) : (
										<IconKey className="mr-1.5 size-4" aria-hidden="true" />
									)}
									{t("settings.recovery.rotate.submitButton", "Verify identity & rotate")}
								</Button>
							</DialogFooter>
						</form>
					</DialogContent>
				</Dialog>

				{/* Immediate revoke confirmation dialog */}
				<Dialog open={revokeDialogOpen} onOpenChange={handleRevokeDialogOpenChange}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								{t("settings.recovery.revoke.dialogTitle", "Revoke {channel} access immediately?", {
									channel: channelName,
								})}
							</DialogTitle>
							<DialogDescription>
								{t(
									"settings.recovery.revoke.dialogDescription",
									"Revocation immediately ends local authorization for this installation. Asynchronous cleanup removes only this organization's credentials and leaves shared deployment credentials and unrelated organizations unaffected. Pending approvals remain available in the Z8 inbox.",
								)}
							</DialogDescription>
						</DialogHeader>

						{revokeError ? (
							<div
								role="alert"
								className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
							>
								{revokeError}
							</div>
						) : null}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => handleRevokeDialogOpenChange(false)}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button
								type="button"
								variant="destructive"
								disabled={revokeMutation.isPending || !activeInstallation}
								onClick={() => {
									if (!activeInstallation) return;
									setRevokeError(null);
									revokeMutation.mutate({ installationId: activeInstallation.id });
								}}
							>
								{revokeMutation.isPending ? (
									<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconShieldOff className="mr-1.5 size-4" aria-hidden="true" />
								)}
								{t("settings.recovery.revoke.confirmButton", "Confirm immediate revocation")}
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</CardContent>
		</Card>
	);
}
