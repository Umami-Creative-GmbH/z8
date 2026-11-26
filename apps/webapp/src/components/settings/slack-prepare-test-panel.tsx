"use client";

import {
	IconAlertTriangle,
	IconBrandSlack,
	IconCheck,
	IconClockExclamation,
	IconCopy,
	IconDownload,
	IconKey,
	IconLoader2,
	IconRefresh,
	IconSend,
	IconShieldCheck,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import type {
	SlackCandidateCredentialsInput,
	SlackCandidatePrivateTestInput,
} from "@/app/[locale]/(app)/settings/notification-channels/slack-setup-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type {
	SlackCandidateSetupView,
	SlackVerificationStepStatus,
	SlackVerificationStepView,
} from "@/lib/chat-installations/slack-setup";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";

const SLACK_SETUP_REFUSALS = {
	invalid_bot_token_format: [
		"settings.slack.orgOwned.errors.invalidBotTokenFormat",
		"Bot token must start with xoxb-.",
	],
	invalid_signing_secret_format: [
		"settings.slack.orgOwned.errors.invalidSigningSecretFormat",
		"Signing secret must be at least 16 characters with no spaces.",
	],
	invalid_bot_token: [
		"settings.slack.orgOwned.errors.invalidBotToken",
		"Slack rejected the bot token. Check your Bot User OAuth Token and try again.",
	],
	missing_slack_scope: [
		"settings.slack.orgOwned.errors.missingScope",
		"The bot token is missing required Slack scopes (including users:read). Reinstall the app from the generated manifest.",
	],
	identity_mismatch: [
		"settings.slack.orgOwned.errors.identityMismatch",
		"Slack returned incomplete or inconsistent app and bot metadata. Verify the app credentials and try again.",
	],
	workspace_claimed_by_other_org: [
		"settings.slack.orgOwned.errors.workspaceClaimed",
		"This Slack workspace is already connected to another Z8 organization.",
	],
	app_claimed_by_other_org: [
		"settings.slack.orgOwned.errors.appClaimed",
		"This Slack app is already claimed by another Z8 organization.",
	],
	candidate_not_found: [
		"settings.slack.orgOwned.errors.candidateNotFound",
		"Candidate Slack setup was not found. Reload and prepare the app again.",
	],
	invalid_slack_user_id: [
		"settings.slack.orgOwned.errors.invalidSlackUserId",
		"Enter a valid Slack member ID (for example, U01234567).",
	],
	credentials_not_configured: [
		"settings.slack.orgOwned.errors.credentialsNotConfigured",
		"Save and verify your Slack credentials before sending a test message.",
	],
	credentials_missing: [
		"settings.slack.orgOwned.errors.credentialsMissing",
		"Stored credentials could not be found. Re-enter and verify your bot token and signing secret.",
	],
} satisfies RefusalMessages<
	| "invalid_bot_token_format"
	| "invalid_signing_secret_format"
	| "invalid_bot_token"
	| "missing_slack_scope"
	| "identity_mismatch"
	| "workspace_claimed_by_other_org"
	| "app_claimed_by_other_org"
	| "candidate_not_found"
	| "invalid_slack_user_id"
	| "credentials_not_configured"
	| "credentials_missing"
>;

export interface SlackPrepareTestPanelProps {
	initialSetup: SlackCandidateSetupView | null;
	prepareAction: () => Promise<ServerActionResult<SlackCandidateSetupView>>;
	refreshAction: () => Promise<ServerActionResult<SlackCandidateSetupView | null>>;
	saveCredentialsAction: (
		input: SlackCandidateCredentialsInput,
	) => Promise<ServerActionResult<SlackCandidateSetupView>>;
	sendPrivateTestAction: (
		input: SlackCandidatePrivateTestInput,
	) => Promise<ServerActionResult<SlackCandidateSetupView>>;
}

function StepStatusBadge({
	status,
	t,
}: {
	status: SlackVerificationStepStatus;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	switch (status) {
		case "passed":
			return (
				<Badge variant="default" className="w-fit shrink-0 gap-1">
					<IconCheck className="size-3.5" aria-hidden="true" />
					{t("settings.slack.orgOwned.status.passed", "Passed")}
				</Badge>
			);
		case "failed":
			return (
				<Badge variant="destructive" className="w-fit shrink-0 gap-1">
					<IconAlertTriangle className="size-3.5" aria-hidden="true" />
					{t("settings.slack.orgOwned.status.failed", "Action needed")}
				</Badge>
			);
		case "expired":
			return (
				<Badge variant="outline" className="w-fit shrink-0 gap-1 border-warning/60 text-warning">
					<IconClockExclamation className="size-3.5" aria-hidden="true" />
					{t("settings.slack.orgOwned.status.expired", "Expired")}
				</Badge>
			);
		case "pending":
			return (
				<Badge variant="secondary" className="w-fit shrink-0">
					{t("settings.slack.orgOwned.status.pending", "Pending")}
				</Badge>
			);
	}
}

function StepRow({
	title,
	description,
	step,
	action,
	t,
}: {
	title: string;
	description: string;
	step: SlackVerificationStepView;
	action?: React.ReactNode;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<li className="min-w-0 space-y-2 rounded-lg border bg-background p-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 space-y-0.5">
					<p className="break-words text-sm font-medium">{title}</p>
					<p className="break-words text-xs text-muted-foreground">{description}</p>
				</div>
				<StepStatusBadge status={step.status} t={t} />
			</div>
			{step.verifiedAt ? (
				<p className="break-words text-xs text-muted-foreground">
					{step.status === "expired"
						? t(
								"settings.slack.orgOwned.stepExpiredAt",
								"Previously verified at {timestamp}. Proof has expired and must be refreshed.",
								{ timestamp: step.verifiedAt },
							)
						: t("settings.slack.orgOwned.stepVerifiedAt", "Verified: {timestamp}", {
								timestamp: step.verifiedAt,
							})}
					{step.detail ? ` · ${step.detail}` : ""}
				</p>
			) : null}
			{step.status === "failed" && step.failureCode ? (
				<p role="alert" className="break-words text-xs text-destructive">
					{t(
						"settings.slack.orgOwned.stepFailureCode",
						"Last verification check failed ({code}). Fix the step and retry.",
						{ code: step.failureCode },
					)}
				</p>
			) : null}
			{action ? <div className="pt-1">{action}</div> : null}
		</li>
	);
}

export function SlackPrepareTestPanel({
	initialSetup,
	prepareAction,
	refreshAction,
	saveCredentialsAction,
	sendPrivateTestAction,
}: SlackPrepareTestPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const idPrefix = useId();
	const [setup, setSetup] = useState<SlackCandidateSetupView | null>(initialSetup);
	const [manifestFormat, setManifestFormat] = useState<"json" | "yaml">("yaml");
	const [announcement, setAnnouncement] = useState<string>("");
	const [credentialsError, setCredentialsError] = useState<string | null>(null);
	const [privateTestError, setPrivateTestError] = useState<string | null>(null);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);

	const announce = (message: string) => {
		setAnnouncement(message);
	};

	const prepareMutation = useMutation({
		mutationFn: () => prepareAction(),
		onSuccess: (result) => {
			if (result.success) {
				setSetup(result.data);
				const msg = t(
					"settings.slack.orgOwned.preparedAnnouncement",
					"Organization-owned Slack app manifest generated.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, SLACK_SETUP_REFUSALS, [
					"settings.slack.orgOwned.errors.prepareFailed",
					"Could not prepare organization-owned Slack app.",
				]);
				announce(msg);
				toast.error(msg);
			}
		},
		onError: () => {
			const msg = t(
				"settings.slack.orgOwned.errors.prepareFailed",
				"Could not prepare organization-owned Slack app.",
			);
			announce(msg);
			toast.error(msg);
		},
	});

	const refreshMutation = useMutation({
		mutationFn: () => refreshAction(),
		onSuccess: (result) => {
			if (result.success && result.data) {
				setSetup(result.data);
				const msg = result.data.readyForSwitch
					? t(
							"settings.slack.orgOwned.readyAnnouncement",
							"Slack app verification complete. Ready for switch review.",
						)
					: t(
							"settings.slack.orgOwned.refreshedAnnouncement",
							"Slack verification status refreshed.",
						);
				announce(msg);
				router.refresh();
			} else if (!result.success) {
				const msg = actionErrorMessage(t, result, SLACK_SETUP_REFUSALS, [
					"settings.slack.orgOwned.errors.refreshFailed",
					"Could not refresh Slack verification status.",
				]);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	const saveCredentialsMutation = useMutation({
		mutationFn: (input: SlackCandidateCredentialsInput) => saveCredentialsAction(input),
	});

	const sendPrivateTestMutation = useMutation({
		mutationFn: (input: SlackCandidatePrivateTestInput) => sendPrivateTestAction(input),
	});

	const credentialsForm = useForm({
		defaultValues: {
			botToken: "",
			signingSecret: "",
		},
		onSubmit: async ({ value }) => {
			if (!setup) return;
			setCredentialsError(null);
			let result: ServerActionResult<SlackCandidateSetupView>;
			try {
				result = await saveCredentialsMutation.mutateAsync({
					installationId: setup.installationId,
					botToken: value.botToken.trim(),
					signingSecret: value.signingSecret.trim(),
				});
			} catch {
				const msg = t(
					"settings.slack.orgOwned.errors.saveCredentialsFailed",
					"Failed to verify and save Slack credentials.",
				);
				setCredentialsError(msg);
				announce(msg);
				toast.error(msg);
				return;
			}

			if (result.success) {
				setSetup(result.data);
				// Write-only: clear raw secrets from client memory immediately
				credentialsForm.reset();
				const msg = t(
					"settings.slack.orgOwned.credentialsSavedAnnouncement",
					"Slack bot identity verified and credentials stored in revision {revision}.",
					{ revision: String(result.data.credentialRevisionNumber ?? 1) },
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}

			const msg = actionErrorMessage(t, result, SLACK_SETUP_REFUSALS, [
				"settings.slack.orgOwned.errors.saveCredentialsFailed",
				"Failed to verify and save Slack credentials.",
			]);
			setCredentialsError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const privateTestForm = useForm({
		defaultValues: {
			slackUserId: "",
		},
		onSubmit: async ({ value }) => {
			if (!setup) return;
			setPrivateTestError(null);
			let result: ServerActionResult<SlackCandidateSetupView>;
			try {
				result = await sendPrivateTestMutation.mutateAsync({
					installationId: setup.installationId,
					slackUserId: value.slackUserId.trim(),
				});
			} catch {
				const msg = t(
					"settings.slack.orgOwned.errors.privateTestFailed",
					"Could not send the synthetic private test message.",
				);
				setPrivateTestError(msg);
				announce(msg);
				toast.error(msg);
				return;
			}

			if (result.success) {
				setSetup(result.data);
				const msg = result.data.readyForSwitch
					? t(
							"settings.slack.orgOwned.readyAnnouncement",
							"Slack app verification complete. Ready for switch review.",
						)
					: t(
							"settings.slack.orgOwned.privateTestSentAnnouncement",
							"Synthetic private test message sent to Slack.",
						);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}

			const msg = actionErrorMessage(t, result, SLACK_SETUP_REFUSALS, [
				"settings.slack.orgOwned.errors.privateTestFailed",
				"Could not send the synthetic private test message.",
			]);
			setPrivateTestError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const isSavingCredentials =
		useStore(credentialsForm.store, (state) => state.isSubmitting) ||
		saveCredentialsMutation.isPending;
	const isSendingTest =
		useStore(privateTestForm.store, (state) => state.isSubmitting) ||
		sendPrivateTestMutation.isPending;

	const handleCopy = async (key: string, text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedKey(key);
			const msg = t("settings.slack.orgOwned.copiedAnnouncement", "{label} copied.", { label });
			announce(msg);
			toast.success(msg);
		} catch {
			const msg = t(
				"settings.slack.orgOwned.copyFailed",
				"Could not copy automatically. Select the text and copy it manually.",
			);
			announce(msg);
			toast.error(msg);
		}
	};

	const handleDownloadManifest = () => {
		if (!setup) return;
		const content = manifestFormat === "json" ? setup.manifestJson : setup.manifestYaml;
		const mimeType = manifestFormat === "json" ? "application/json" : "application/yaml";
		const ext = manifestFormat === "json" ? "json" : "yaml";
		const blob = new Blob([content], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `z8-slack-app-manifest.${ext}`;
		link.click();
		URL.revokeObjectURL(url);
		announce(t("settings.slack.orgOwned.manifestDownloaded", "Slack app manifest downloaded."));
	};

	const botTokenInputId = `${idPrefix}-slack-bot-token`;
	const signingSecretInputId = `${idPrefix}-slack-signing-secret`;
	const slackUserIdInputId = `${idPrefix}-slack-test-user-id`;
	const eventsUrlId = `${idPrefix}-events-url`;
	const interactionsUrlId = `${idPrefix}-interactions-url`;
	const commandsUrlId = `${idPrefix}-commands-url`;

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<CardTitle className="flex items-center gap-2 text-base">
							<IconBrandSlack className="size-4 shrink-0" aria-hidden="true" />
							{t("settings.slack.orgOwned.title", "Prepare & test organization-owned Slack app")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.slack.orgOwned.description",
								"Create and verify your organization's own Slack app without interrupting live Slack delivery. Switching happens separately after verification passes.",
							)}
						</CardDescription>
					</div>
					{setup ? (
						<Badge
							variant={setup.readyForSwitch ? "default" : "secondary"}
							className="w-fit shrink-0 gap-1"
						>
							{setup.readyForSwitch ? (
								<IconShieldCheck className="size-3.5" aria-hidden="true" />
							) : (
								<IconKey className="size-3.5" aria-hidden="true" />
							)}
							{setup.readyForSwitch
								? t("settings.slack.orgOwned.badge.ready", "Ready to review switch")
								: t("settings.slack.orgOwned.badge.candidate", "Candidate setup")}
						</Badge>
					) : null}
				</div>
			</CardHeader>

			<CardContent className="min-w-0 space-y-6">
				{!setup ? (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.slack.orgOwned.emptyPrompt",
								"Generate a dedicated Slack app manifest with organization-scoped verification URLs. Your current Slack connection continues delivering throughout setup.",
							)}
						</p>
						<Button
							type="button"
							disabled={prepareMutation.isPending}
							onClick={() => prepareMutation.mutate()}
						>
							{prepareMutation.isPending ? (
								<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
							) : (
								<IconBrandSlack className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("settings.slack.orgOwned.prepareButton", "Generate Slack app manifest")}
						</Button>
					</div>
				) : (
					<>
						{/* Step 1: Prepare Manifest & Callback URLs */}
						<section aria-labelledby={`${idPrefix}-prepare-heading`} className="min-w-0 space-y-4">
							<div className="space-y-1">
								<h3 id={`${idPrefix}-prepare-heading`} className="text-sm font-semibold">
									{t("settings.slack.orgOwned.prepare.heading", "1. Prepare your Slack app")}
								</h3>
								<p className="text-xs text-muted-foreground">
									{t(
										"settings.slack.orgOwned.prepare.instructions",
										"In Slack API (api.slack.com/apps), choose Create New App → From an app manifest, paste this manifest, and install the app to your workspace.",
									)}
								</p>
							</div>

							<div className="space-y-2">
								<div className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										variant={manifestFormat === "yaml" ? "default" : "outline"}
										size="sm"
										onClick={() => setManifestFormat("yaml")}
									>
										YAML
									</Button>
									<Button
										type="button"
										variant={manifestFormat === "json" ? "default" : "outline"}
										size="sm"
										onClick={() => setManifestFormat("json")}
									>
										JSON
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() =>
											handleCopy(
												"manifest",
												manifestFormat === "json" ? setup.manifestJson : setup.manifestYaml,
												t("settings.slack.orgOwned.prepare.manifestLabel", "Slack app manifest"),
											)
										}
									>
										{copiedKey === "manifest" ? (
											<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
										) : (
											<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
										)}
										{t("settings.slack.orgOwned.prepare.copyManifest", "Copy manifest")}
									</Button>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={handleDownloadManifest}
									>
										<IconDownload className="mr-1.5 size-4" aria-hidden="true" />
										{t("settings.slack.orgOwned.prepare.downloadManifest", "Download")}
									</Button>
								</div>

								<pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
									{manifestFormat === "json" ? setup.manifestJson : setup.manifestYaml}
								</pre>
							</div>

							<div className="grid gap-3">
								{[
									{
										id: eventsUrlId,
										key: "events",
										label: t(
											"settings.slack.orgOwned.prepare.eventsUrl",
											"Event Subscriptions URL",
										),
										value: setup.urls.eventsUrl,
									},
									{
										id: interactionsUrlId,
										key: "interactions",
										label: t(
											"settings.slack.orgOwned.prepare.interactionsUrl",
											"Interactivity Request URL",
										),
										value: setup.urls.interactionsUrl,
									},
									{
										id: commandsUrlId,
										key: "commands",
										label: t("settings.slack.orgOwned.prepare.commandsUrl", "Slash Command URL"),
										value: setup.urls.commandsUrl,
									},
								].map((urlItem) => (
									<div key={urlItem.key} className="min-w-0 space-y-1">
										<Label htmlFor={urlItem.id} className="text-xs">
											{urlItem.label}
										</Label>
										<div className="flex flex-col gap-2 sm:flex-row">
											<Input
												id={urlItem.id}
												value={urlItem.value}
												readOnly
												className="min-w-0 font-mono text-xs"
												onFocus={(event) => event.target.select()}
											/>
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="w-fit shrink-0"
												onClick={() => handleCopy(urlItem.key, urlItem.value, urlItem.label)}
											>
												{copiedKey === urlItem.key ? (
													<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
												) : (
													<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
												)}
												{t("settings.slack.orgOwned.prepare.copyUrl", "Copy")}
											</Button>
										</div>
									</div>
								))}
							</div>
						</section>

						{/* Step 2: Write-only Credentials */}
						<section
							aria-labelledby={`${idPrefix}-credentials-heading`}
							className="min-w-0 space-y-4 border-t pt-4"
						>
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0 space-y-1">
									<h3 id={`${idPrefix}-credentials-heading`} className="text-sm font-semibold">
										{t(
											"settings.slack.orgOwned.credentials.heading",
											"2. Enter credentials (write-only)",
										)}
									</h3>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.slack.orgOwned.credentials.description",
											"Credentials are stored in an immutable organization-scoped revision and are never displayed again after saving.",
										)}
									</p>
								</div>
								{setup.hasStoredCredentials ? (
									<Badge variant="outline" className="w-fit shrink-0">
										{t(
											"settings.slack.orgOwned.credentials.storedBadge",
											"Stored (revision v{revision})",
											{ revision: String(setup.credentialRevisionNumber ?? 1) },
										)}
									</Badge>
								) : null}
							</div>

							<form
								className="space-y-4"
								onSubmit={(event) => {
									event.preventDefault();
									credentialsForm.handleSubmit();
								}}
							>
								<div className="grid gap-4 sm:grid-cols-2">
									<credentialsForm.Field
										name="botToken"
										validators={{
											onBlur: ({ value }) => {
												const trimmed = value.trim();
												if (!trimmed) {
													return t(
														"settings.slack.orgOwned.validation.botTokenRequired",
														"Bot User OAuth Token is required.",
													);
												}
												if (!trimmed.startsWith("xoxb-")) {
													return t(
														"settings.slack.orgOwned.errors.invalidBotTokenFormat",
														"Bot token must start with xoxb-.",
													);
												}
												return undefined;
											},
										}}
									>
										{(field) => {
											const hasError = fieldHasError(field);
											return (
												<TFormItem>
													<TFormLabel htmlFor={botTokenInputId} hasError={hasError} required>
														{t(
															"settings.slack.orgOwned.credentials.botToken",
															"Bot User OAuth Token",
														)}
													</TFormLabel>
													<TFormControl hasError={hasError}>
														<Input
															id={botTokenInputId}
															name="botToken"
															type="password"
															placeholder="xoxb-..."
															value={field.state.value}
															onChange={(event) => {
																setCredentialsError(null);
																field.handleChange(event.target.value);
															}}
															onBlur={field.handleBlur}
															disabled={isSavingCredentials}
															autoComplete="off"
															spellCheck={false}
														/>
													</TFormControl>
													<TFormDescription>
														{t(
															"settings.slack.orgOwned.credentials.botTokenHelp",
															"Found under OAuth & Permissions after installing your Slack app.",
														)}
													</TFormDescription>
													<TFormMessage field={field} />
												</TFormItem>
											);
										}}
									</credentialsForm.Field>

									<credentialsForm.Field
										name="signingSecret"
										validators={{
											onBlur: ({ value }) => {
												const trimmed = value.trim();
												if (!trimmed) {
													return t(
														"settings.slack.orgOwned.validation.signingSecretRequired",
														"Signing Secret is required.",
													);
												}
												if (trimmed.length < 16) {
													return t(
														"settings.slack.orgOwned.errors.invalidSigningSecretFormat",
														"Signing secret must be at least 16 characters with no spaces.",
													);
												}
												return undefined;
											},
										}}
									>
										{(field) => {
											const hasError = fieldHasError(field);
											return (
												<TFormItem>
													<TFormLabel htmlFor={signingSecretInputId} hasError={hasError} required>
														{t(
															"settings.slack.orgOwned.credentials.signingSecret",
															"Signing Secret",
														)}
													</TFormLabel>
													<TFormControl hasError={hasError}>
														<Input
															id={signingSecretInputId}
															name="signingSecret"
															type="password"
															value={field.state.value}
															onChange={(event) => {
																setCredentialsError(null);
																field.handleChange(event.target.value);
															}}
															onBlur={field.handleBlur}
															disabled={isSavingCredentials}
															autoComplete="off"
															spellCheck={false}
														/>
													</TFormControl>
													<TFormDescription>
														{t(
															"settings.slack.orgOwned.credentials.signingSecretHelp",
															"Found under Basic Information → App Credentials in Slack.",
														)}
													</TFormDescription>
													<TFormMessage field={field} />
												</TFormItem>
											);
										}}
									</credentialsForm.Field>
								</div>

								{credentialsError ? (
									<p role="alert" className="text-sm text-destructive">
										{credentialsError}
									</p>
								) : null}

								<Button type="submit" disabled={isSavingCredentials}>
									{isSavingCredentials ? (
										<IconLoader2
											className="mr-2 size-4 motion-safe:animate-spin"
											aria-hidden="true"
										/>
									) : (
										<IconKey className="mr-2 size-4" aria-hidden="true" />
									)}
									{setup.hasStoredCredentials
										? t(
												"settings.slack.orgOwned.credentials.updateButton",
												"Verify & save new credential revision",
											)
										: t(
												"settings.slack.orgOwned.credentials.saveButton",
												"Verify & save credentials",
											)}
								</Button>
							</form>
						</section>

						{/* Step 3: Verification Checklist & Synthetic Private Test */}
						<section
							aria-labelledby={`${idPrefix}-test-heading`}
							className="min-w-0 space-y-4 border-t pt-4"
						>
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
								<div className="min-w-0 space-y-1">
									<h3 id={`${idPrefix}-test-heading`} className="text-sm font-semibold">
										{t("settings.slack.orgOwned.test.heading", "3. Test & verify candidate app")}
									</h3>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.slack.orgOwned.test.description",
											"Candidate testing never executes production commands, approval actions, or live notifications.",
										)}
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="w-fit shrink-0"
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
									{t("settings.slack.orgOwned.test.refreshStatus", "Refresh status")}
								</Button>
							</div>

							<ul className="space-y-3">
								<StepRow
									title={t(
										"settings.slack.orgOwned.steps.identity.title",
										"App & workspace identity",
									)}
									description={t(
										"settings.slack.orgOwned.steps.identity.description",
										"Confirmed from Slack bot metadata (auth.test and bots.info) and bound to your organization.",
									)}
									step={setup.steps.identity}
									t={t}
								/>

								<StepRow
									title={t(
										"settings.slack.orgOwned.steps.signedEvent.title",
										"Fresh signed app-and-workspace event",
									)}
									description={t(
										"settings.slack.orgOwned.steps.signedEvent.description",
										"After saving credentials, enable Event Subscriptions in Slack and send a direct message or @mention to your candidate app, then refresh status.",
									)}
									step={setup.steps.signedEvent}
									action={
										setup.steps.signedEvent.status === "failed" ||
										setup.steps.signedEvent.status === "expired" ? (
											<Button
												type="button"
												variant="outline"
												size="sm"
												disabled={refreshMutation.isPending}
												onClick={() => refreshMutation.mutate()}
											>
												<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
												{t(
													"settings.slack.orgOwned.steps.signedEvent.retry",
													"Recheck signed event",
												)}
											</Button>
										) : null
									}
									t={t}
								/>

								<StepRow
									title={t(
										"settings.slack.orgOwned.steps.privateTest.title",
										"Synthetic private test message",
									)}
									description={t(
										"settings.slack.orgOwned.steps.privateTest.description",
										"Send a private verification DM to your Slack member ID (found in Slack profile → Copy member ID).",
									)}
									step={setup.steps.privateTest}
									action={
										setup.hasStoredCredentials ? (
											<form
												className="space-y-3 pt-1"
												onSubmit={(event) => {
													event.preventDefault();
													privateTestForm.handleSubmit();
												}}
											>
												<privateTestForm.Field
													name="slackUserId"
													validators={{
														onBlur: ({ value }) => {
															const trimmed = value.trim().toUpperCase();
															if (!trimmed) {
																return t(
																	"settings.slack.orgOwned.validation.slackUserIdRequired",
																	"Slack member ID is required.",
																);
															}
															if (!/^[UW][A-Z0-9]{7,}$/.test(trimmed)) {
																return t(
																	"settings.slack.orgOwned.errors.invalidSlackUserId",
																	"Enter a valid Slack member ID (for example, U01234567).",
																);
															}
															return undefined;
														},
													}}
												>
													{(field) => {
														const hasError = fieldHasError(field);
														return (
															<TFormItem>
																<TFormLabel htmlFor={slackUserIdInputId} hasError={hasError}>
																	{t(
																		"settings.slack.orgOwned.test.slackUserIdLabel",
																		"Your Slack Member ID",
																	)}
																</TFormLabel>
																<div className="flex flex-col gap-2 sm:flex-row">
																	<TFormControl hasError={hasError}>
																		<Input
																			id={slackUserIdInputId}
																			name="slackUserId"
																			placeholder="U01234567"
																			value={field.state.value}
																			onChange={(event) => {
																				setPrivateTestError(null);
																				field.handleChange(event.target.value);
																			}}
																			onBlur={field.handleBlur}
																			disabled={isSendingTest}
																			className="min-w-0 font-mono text-xs"
																			autoComplete="off"
																			spellCheck={false}
																		/>
																	</TFormControl>
																	<Button
																		type="submit"
																		variant={
																			setup.steps.privateTest.status === "failed" ||
																			setup.steps.privateTest.status === "expired"
																				? "default"
																				: "outline"
																		}
																		size="sm"
																		className="w-fit shrink-0"
																		disabled={isSendingTest}
																	>
																		{isSendingTest ? (
																			<IconLoader2
																				className="mr-1.5 size-4 motion-safe:animate-spin"
																				aria-hidden="true"
																			/>
																		) : (
																			<IconSend className="mr-1.5 size-4" aria-hidden="true" />
																		)}
																		{setup.steps.privateTest.status === "failed" ||
																		setup.steps.privateTest.status === "expired"
																			? t(
																					"settings.slack.orgOwned.test.retryPrivateTest",
																					"Retry private test",
																				)
																			: t(
																					"settings.slack.orgOwned.test.sendPrivateTest",
																					"Send test DM",
																				)}
																	</Button>
																</div>
																<TFormMessage field={field} />
															</TFormItem>
														);
													}}
												</privateTestForm.Field>
												{privateTestError ? (
													<p role="alert" className="text-xs text-destructive">
														{privateTestError}
													</p>
												) : null}
											</form>
										) : null
									}
									t={t}
								/>
							</ul>

							{setup.readyForSwitch ? (
								<div
									role="status"
									className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"
								>
									<IconShieldCheck
										className="mt-0.5 size-4 shrink-0 text-primary"
										aria-hidden="true"
									/>
									<p className="break-words text-xs sm:text-sm">
										{t(
											"settings.slack.orgOwned.readyBanner",
											"Your organization-owned Slack app passed identity, signed inbound event, and private test delivery checks. Existing Slack traffic remains on your current connection until you review and confirm a switch.",
										)}
									</p>
								</div>
							) : null}
						</section>
					</>
				)}

				<p className="sr-only" aria-live="polite" aria-atomic="true">
					{announcement}
				</p>
			</CardContent>
		</Card>
	);
}
