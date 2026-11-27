"use client";

import {
	IconBrandTeams,
	IconCheck,
	IconCopy,
	IconDownload,
	IconKey,
	IconLoader2,
	IconPackage,
	IconRefresh,
	IconSend,
	IconShieldCheck,
} from "@tabler/icons-react";
import { VerificationHeading, VerificationStepRow } from "./chat-verification";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { toast } from "sonner";
import type {
	TeamsCandidateCredentialsInput,
	TeamsCandidateProactiveTestInput,
} from "@/app/[locale]/(app)/settings/notification-channels/teams-setup-actions";
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
import {
	buildTeamsAppPackageZip,
	type TeamsCandidateSetupView,
} from "@/lib/chat-installations/teams-app-package";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import { runWithBusyState } from "./run-with-busy-state";

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TEAMS_SETUP_REFUSALS = {
	invalid_app_id_format: [
		"settings.teamsPrepare.errors.invalidAppIdFormat",
		"Microsoft App ID must be a valid GUID.",
	],
	invalid_tenant_id_format: [
		"settings.teamsPrepare.errors.invalidTenantIdFormat",
		"Microsoft Entra Tenant ID must be a valid GUID.",
	],
	invalid_app_password_format: [
		"settings.teamsPrepare.errors.invalidAppPasswordFormat",
		"Microsoft App Password (client secret) must be at least 8 characters.",
	],
	tenant_claimed_by_other_org: [
		"settings.teamsPrepare.errors.tenantClaimed",
		"This Microsoft Teams tenant is already connected to another Z8 organization.",
	],
	app_claimed_by_other_org: [
		"settings.teamsPrepare.errors.appClaimed",
		"This Microsoft Teams App ID is already claimed by another Z8 organization.",
	],
	candidate_not_found: [
		"settings.teamsPrepare.errors.candidateNotFound",
		"Candidate Teams setup was not found. Reload and prepare the app again.",
	],
	credentials_not_configured: [
		"settings.teamsPrepare.errors.credentialsNotConfigured",
		"Save your single-tenant Teams credentials before running the proactive test.",
	],
	credentials_missing: [
		"settings.teamsPrepare.errors.credentialsMissing",
		"Stored credentials could not be found. Re-enter and save your single-tenant credentials.",
	],
	missing_private_reachability: [
		"settings.teamsPrepare.errors.missingPrivateReachability",
		"No personal chat reachability has been captured for this candidate Teams app yet. Send a 1:1 message to the candidate bot in Microsoft Teams first, then retry.",
	],
	tenant_mismatch: [
		"settings.teamsPrepare.errors.tenantMismatch",
		"The captured conversation belongs to a different Microsoft Teams tenant. Message the candidate bot from the configured tenant and retry.",
	],
} satisfies RefusalMessages<
	| "invalid_app_id_format"
	| "invalid_tenant_id_format"
	| "invalid_app_password_format"
	| "tenant_claimed_by_other_org"
	| "app_claimed_by_other_org"
	| "candidate_not_found"
	| "credentials_not_configured"
	| "credentials_missing"
	| "missing_private_reachability"
	| "tenant_mismatch"
>;

export interface TeamsPrepareTestPanelProps {
	initialSetup: TeamsCandidateSetupView | null;
	prepareAction: () => Promise<ServerActionResult<TeamsCandidateSetupView>>;
	refreshAction: () => Promise<ServerActionResult<TeamsCandidateSetupView | null>>;
	saveCredentialsAction: (
		input: TeamsCandidateCredentialsInput,
	) => Promise<ServerActionResult<TeamsCandidateSetupView>>;
	sendProactiveTestAction: (
		input: TeamsCandidateProactiveTestInput,
	) => Promise<ServerActionResult<TeamsCandidateSetupView>>;
}

function useTeamsPrepareTestPanel({
	initialSetup,
	prepareAction,
	refreshAction,
	saveCredentialsAction,
	sendProactiveTestAction,
}: TeamsPrepareTestPanelProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const idPrefix = useId();
	const [setup, setSetup] = useState<TeamsCandidateSetupView | null>(initialSetup);
	const [announcement, setAnnouncement] = useState<string>("");
	const [credentialsError, setCredentialsError] = useState<string | null>(null);
	const [proactiveTestError, setProactiveTestError] = useState<string | null>(null);
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const [isDownloadingPackage, setIsDownloadingPackage] = useState(false);

	const announce = (message: string) => {
		setAnnouncement(message);
	};

	const prepareMutation = useMutation({
		mutationFn: () => prepareAction(),
		onSuccess: (result) => {
			if (result.success) {
				setSetup(result.data);
				const msg = t(
					"settings.teamsPrepare.preparedAnnouncement",
					"Single-tenant Teams app package and messaging endpoint generated.",
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, TEAMS_SETUP_REFUSALS, [
					"settings.teamsPrepare.errors.prepareFailed",
					"Could not prepare single-tenant Teams app.",
				]);
				announce(msg);
				toast.error(msg);
			}
		},
		onError: () => {
			const msg = t(
				"settings.teamsPrepare.errors.prepareFailed",
				"Could not prepare single-tenant Teams app.",
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
							"settings.teamsPrepare.readyAnnouncement",
							"Single-tenant Teams app verification complete. Ready for switch review.",
						)
					: t(
							"settings.teamsPrepare.refreshedAnnouncement",
							"Teams verification status refreshed.",
						);
				announce(msg);
				router.refresh();
			} else if (!result.success) {
				const msg = actionErrorMessage(t, result, TEAMS_SETUP_REFUSALS, [
					"settings.teamsPrepare.errors.refreshFailed",
					"Could not refresh Teams verification status.",
				]);
				announce(msg);
				toast.error(msg);
			}
		},
	});

	const saveCredentialsMutation = useMutation({
		mutationFn: (input: TeamsCandidateCredentialsInput) => saveCredentialsAction(input),
	});

	const sendProactiveTestMutation = useMutation({
		mutationFn: (input: TeamsCandidateProactiveTestInput) => sendProactiveTestAction(input),
		onSuccess: (result) => {
			if (result.success) {
				setProactiveTestError(null);
				setSetup(result.data);
				const msg = result.data.readyForSwitch
					? t(
							"settings.teamsPrepare.readyAnnouncement",
							"Single-tenant Teams app verification complete. Ready for switch review.",
						)
					: t(
							"settings.teamsPrepare.proactiveTestSentAnnouncement",
							"Synthetic proactive private test message delivered to Microsoft Teams.",
						);
				announce(msg);
				toast.success(msg);
				router.refresh();
			} else {
				const msg = actionErrorMessage(t, result, TEAMS_SETUP_REFUSALS, [
					"settings.teamsPrepare.errors.proactiveTestFailed",
					"Could not send the proactive private test message.",
				]);
				setProactiveTestError(msg);
				announce(msg);
				toast.error(msg);
			}
		},
		onError: () => {
			const msg = t(
				"settings.teamsPrepare.errors.proactiveTestFailed",
				"Could not send the proactive private test message.",
			);
			setProactiveTestError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const credentialsForm = useForm({
		defaultValues: {
			microsoftAppId: initialSetup?.microsoftAppId ?? "",
			microsoftTenantId: initialSetup?.microsoftTenantId ?? "",
			tenantDisplayName: initialSetup?.tenantDisplayName ?? "",
			microsoftAppPassword: "",
		},
		onSubmit: async ({ value }) => {
			if (!setup) return;
			setCredentialsError(null);
			let result: ServerActionResult<TeamsCandidateSetupView>;
			try {
				result = await saveCredentialsMutation.mutateAsync({
					installationId: setup.installationId,
					microsoftAppId: value.microsoftAppId.trim(),
					microsoftTenantId: value.microsoftTenantId.trim(),
					microsoftAppPassword: value.microsoftAppPassword.trim(),
					...(value.tenantDisplayName.trim()
						? { tenantDisplayName: value.tenantDisplayName.trim() }
						: {}),
				});
			} catch {
				const msg = t(
					"settings.teamsPrepare.errors.saveCredentialsFailed",
					"Failed to save single-tenant Teams credentials.",
				);
				setCredentialsError(msg);
				announce(msg);
				toast.error(msg);
				return;
			}

			if (result.success) {
				setSetup(result.data);
				// Write-only: clear client secret from memory immediately while preserving non-secret GUIDs
				credentialsForm.setFieldValue("microsoftAppPassword", "");
				const msg = t(
					"settings.teamsPrepare.credentialsSavedAnnouncement",
					"Single-tenant Teams credentials stored in revision {revision}.",
					{ revision: String(result.data.credentialRevisionNumber ?? 1) },
				);
				announce(msg);
				toast.success(msg);
				router.refresh();
				return;
			}

			const msg = actionErrorMessage(t, result, TEAMS_SETUP_REFUSALS, [
				"settings.teamsPrepare.errors.saveCredentialsFailed",
				"Failed to save single-tenant Teams credentials.",
			]);
			setCredentialsError(msg);
			announce(msg);
			toast.error(msg);
		},
	});

	const isSavingCredentials =
		useStore(credentialsForm.store, (state) => state.isSubmitting) ||
		saveCredentialsMutation.isPending;

	const handleCopy = async (key: string, text: string, label: string) => {
		try {
			await navigator.clipboard.writeText(text);
			setCopiedKey(key);
			const msg = t("settings.teamsPrepare.copiedAnnouncement", "{label} copied.", { label });
			announce(msg);
			toast.success(msg);
		} catch {
			const msg = t(
				"settings.teamsPrepare.copyFailed",
				"Could not copy automatically. Select the text and copy it manually.",
			);
			announce(msg);
			toast.error(msg);
		}
	};

	const handleDownloadManifest = () => {
		if (!setup) return;
		const blob = new Blob([setup.manifestJson], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = setup.manifestFileName;
		link.click();
		URL.revokeObjectURL(url);
		announce(t("settings.teamsPrepare.manifestDownloaded", "Teams app manifest downloaded."));
	};

	const handleDownloadPackageZip = async () => {
		if (!setup) return;
		await runWithBusyState(setIsDownloadingPackage, async () => {
			try {
				const zipBytes = await buildTeamsAppPackageZip(setup.manifestJson);
				const blob = new Blob([new Uint8Array(zipBytes)], { type: "application/zip" });
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = setup.packageFileName;
				link.click();
				URL.revokeObjectURL(url);
				const msg = t(
					"settings.teamsPrepare.packageDownloaded",
					"Single-tenant Teams app package (.zip) downloaded.",
				);
				announce(msg);
				toast.success(msg);
			} catch {
				const msg = t(
					"settings.teamsPrepare.packageDownloadFailed",
					"Could not generate Teams app package (.zip).",
				);
				announce(msg);
				toast.error(msg);
			}
		});
	};

	const endpointUrlId = `${idPrefix}-teams-messaging-endpoint`;
	const appIdInputId = `${idPrefix}-teams-app-id`;
	const tenantIdInputId = `${idPrefix}-teams-tenant-id`;
	const tenantNameInputId = `${idPrefix}-teams-tenant-name`;
	const appPasswordInputId = `${idPrefix}-teams-app-password`;

	return {
		t,
		idPrefix,
		setup,
		announcement,
		credentialsError,
		setCredentialsError,
		proactiveTestError,
		setProactiveTestError,
		copiedKey,
		isDownloadingPackage,
		prepareMutation,
		refreshMutation,
		sendProactiveTestMutation,
		credentialsForm,
		isSavingCredentials,
		handleCopy,
		handleDownloadManifest,
		handleDownloadPackageZip,
		endpointUrlId,
		appIdInputId,
		tenantIdInputId,
		tenantNameInputId,
		appPasswordInputId,
	};
}

type PanelState = NonNullable<ReturnType<typeof useTeamsPrepareTestPanel>>;

function ManifestSection(props: PanelState & { setup: NonNullable<PanelState["setup"]> }) {
	const {
		t,
		idPrefix,
		copiedKey,
		isDownloadingPackage,
		handleCopy,
		handleDownloadManifest,
		handleDownloadPackageZip,
		endpointUrlId,
		setup,
	} = props;
	return (
		<section aria-labelledby={`${idPrefix}-prepare-heading`} className="min-w-0 space-y-4">
			<div className="space-y-1">
				<h3 id={`${idPrefix}-prepare-heading`} className="text-sm font-semibold">
					{t(
						"settings.teamsPrepare.prepare.heading",
						"1. Prepare single-tenant Teams app & admin rollout",
					)}
				</h3>
				<p className="text-xs text-muted-foreground">
					{t(
						"settings.teamsPrepare.prepare.instructions",
						"Configure your Single-Tenant Azure Bot with the dedicated messaging endpoint below, save your credentials, then upload the app package in Microsoft Teams Admin Center.",
					)}
				</p>
			</div>

			<div className="min-w-0 space-y-1">
				<Label htmlFor={endpointUrlId} className="text-xs">
					{t(
						"settings.teamsPrepare.prepare.messagingEndpointLabel",
						"Dedicated Messaging Endpoint",
					)}
				</Label>
				<div className="flex flex-col gap-2 sm:flex-row">
					<Input
						id={endpointUrlId}
						value={setup.messagingEndpointUrl}
						readOnly
						className="min-w-0 font-mono text-xs"
						onFocus={(event) => event.target.select()}
					/>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="w-fit shrink-0"
						onClick={() =>
							handleCopy(
								"endpoint",
								setup.messagingEndpointUrl,
								t(
									"settings.teamsPrepare.prepare.messagingEndpointLabel",
									"Dedicated Messaging Endpoint",
								),
							)
						}
					>
						{copiedKey === "endpoint" ? (
							<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
						) : (
							<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
						)}
						{t("settings.teamsPrepare.prepare.copyUrl", "Copy")}
					</Button>
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="default"
						size="sm"
						disabled={isDownloadingPackage}
						onClick={handleDownloadPackageZip}
					>
						{isDownloadingPackage ? (
							<IconLoader2 className="mr-1.5 size-4 motion-safe:animate-spin" aria-hidden="true" />
						) : (
							<IconPackage className="mr-1.5 size-4" aria-hidden="true" />
						)}
						{t("settings.teamsPrepare.prepare.downloadPackage", "Download App Package (.zip)")}
					</Button>
					<Button type="button" variant="outline" size="sm" onClick={handleDownloadManifest}>
						<IconDownload className="mr-1.5 size-4" aria-hidden="true" />
						{t("settings.teamsPrepare.prepare.downloadManifest", "Download manifest.json")}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() =>
							handleCopy(
								"manifest",
								setup.manifestJson,
								t("settings.teamsPrepare.prepare.manifestLabel", "Teams app manifest"),
							)
						}
					>
						{copiedKey === "manifest" ? (
							<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
						) : (
							<IconCopy className="mr-1.5 size-4" aria-hidden="true" />
						)}
						{t("settings.teamsPrepare.prepare.copyManifest", "Copy manifest")}
					</Button>
				</div>

				{setup.usesPlaceholderAppId ? (
					<p className="text-xs text-muted-foreground">
						{t(
							"settings.teamsPrepare.prepare.placeholderAppIdNote",
							"Save your Microsoft App ID below to populate the app ID inside manifest.json before uploading to Microsoft Teams Admin Center.",
						)}
					</p>
				) : null}

				<pre className="max-h-56 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
					{setup.manifestJson}
				</pre>
			</div>

			{setup.rolloutInstructions.length > 0 ? (
				<div className="space-y-2 rounded-lg border bg-muted/20 p-3">
					<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						{t(
							"settings.teamsPrepare.rollout.heading",
							"Microsoft Teams Admin Center rollout instructions",
						)}
					</h4>
					<ol className="space-y-2 text-xs">
						{setup.rolloutInstructions.map((step) => (
							<li key={step.id} className="min-w-0 space-y-0.5">
								<p className="break-words font-medium">
									{step.stepNumber}.{" "}
									{t(`settings.teamsPrepare.rollout.steps.${step.id}.title`, step.title)}
								</p>
								<p className="break-words text-muted-foreground">
									{t(`settings.teamsPrepare.rollout.steps.${step.id}.summary`, step.summary, {
										endpointUrl: setup.messagingEndpointUrl,
									})}
								</p>
							</li>
						))}
					</ol>
				</div>
			) : null}
		</section>
	);
}

function CredentialsSection(props: PanelState & { setup: NonNullable<PanelState["setup"]> }) {
	const {
		t,
		idPrefix,
		credentialsError,
		setCredentialsError,
		credentialsForm,
		isSavingCredentials,
		appIdInputId,
		tenantIdInputId,
		tenantNameInputId,
		appPasswordInputId,
		setup,
	} = props;
	return (
		<section
			aria-labelledby={`${idPrefix}-credentials-heading`}
			className="min-w-0 space-y-4 border-t pt-4"
		>
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0 space-y-1">
					<h3 id={`${idPrefix}-credentials-heading`} className="text-sm font-semibold">
						{t(
							"settings.teamsPrepare.credentials.heading",
							"2. Enter single-tenant credentials (write-only)",
						)}
					</h3>
					<p className="text-xs text-muted-foreground">
						{t(
							"settings.teamsPrepare.credentials.description",
							"The client secret is stored in an immutable organization-scoped revision and is never displayed again after saving. Existing legacy Teams tenants remain active.",
						)}
					</p>
				</div>
				{setup.hasStoredCredentials ? (
					<Badge variant="outline" className="w-fit shrink-0">
						{t("settings.teamsPrepare.credentials.storedBadge", "Stored (revision v{revision})", {
							revision: String(setup.credentialRevisionNumber ?? 1),
						})}
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
						name="microsoftAppId"
						validators={{
							onBlur: ({ value }) => {
								const trimmed = value.trim();
								if (!trimmed) {
									return t(
										"settings.teamsPrepare.validation.appIdRequired",
										"Microsoft App ID is required.",
									);
								}
								if (!GUID_PATTERN.test(trimmed)) {
									return t(
										"settings.teamsPrepare.errors.invalidAppIdFormat",
										"Microsoft App ID must be a valid GUID.",
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
									<TFormLabel htmlFor={appIdInputId} hasError={hasError} required>
										{t("settings.teamsPrepare.credentials.appId", "Microsoft App ID (GUID)")}
									</TFormLabel>
									<TFormControl hasError={hasError}>
										<Input
											id={appIdInputId}
											name="microsoftAppId"
											placeholder="00000000-0000-4000-8000-000000000000"
											value={field.state.value}
											onChange={(event) => {
												setCredentialsError(null);
												field.handleChange(event.target.value);
											}}
											onBlur={field.handleBlur}
											disabled={isSavingCredentials}
											className="font-mono text-xs"
											autoComplete="off"
											spellCheck={false}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.teamsPrepare.credentials.appIdHelp",
											"Application (client) ID from your Single-Tenant Azure Bot registration.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							);
						}}
					</credentialsForm.Field>

					<credentialsForm.Field
						name="microsoftTenantId"
						validators={{
							onBlur: ({ value }) => {
								const trimmed = value.trim();
								if (!trimmed) {
									return t(
										"settings.teamsPrepare.validation.tenantIdRequired",
										"Microsoft Entra Tenant ID is required.",
									);
								}
								if (!GUID_PATTERN.test(trimmed)) {
									return t(
										"settings.teamsPrepare.errors.invalidTenantIdFormat",
										"Microsoft Entra Tenant ID must be a valid GUID.",
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
									<TFormLabel htmlFor={tenantIdInputId} hasError={hasError} required>
										{t(
											"settings.teamsPrepare.credentials.tenantId",
											"Microsoft Entra Tenant ID (GUID)",
										)}
									</TFormLabel>
									<TFormControl hasError={hasError}>
										<Input
											id={tenantIdInputId}
											name="microsoftTenantId"
											placeholder="00000000-0000-4000-8000-000000000000"
											value={field.state.value}
											onChange={(event) => {
												setCredentialsError(null);
												field.handleChange(event.target.value);
											}}
											onBlur={field.handleBlur}
											disabled={isSavingCredentials}
											className="font-mono text-xs"
											autoComplete="off"
											spellCheck={false}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.teamsPrepare.credentials.tenantIdHelp",
											"Directory (tenant) ID of your Microsoft 365 tenant. You can stage a replacement in the same tenant as your live Teams connection.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							);
						}}
					</credentialsForm.Field>

					<credentialsForm.Field
						name="microsoftAppPassword"
						validators={{
							onBlur: ({ value }) => {
								const trimmed = value.trim();
								if (!trimmed) {
									return t(
										"settings.teamsPrepare.validation.appPasswordRequired",
										"Microsoft App Password is required.",
									);
								}
								if (trimmed.length < 8) {
									return t(
										"settings.teamsPrepare.errors.invalidAppPasswordFormat",
										"Microsoft App Password (client secret) must be at least 8 characters.",
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
									<TFormLabel htmlFor={appPasswordInputId} hasError={hasError} required>
										{t(
											"settings.teamsPrepare.credentials.appPassword",
											"Microsoft App Password (Client Secret)",
										)}
									</TFormLabel>
									<TFormControl hasError={hasError}>
										<Input
											id={appPasswordInputId}
											name="microsoftAppPassword"
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
											"settings.teamsPrepare.credentials.appPasswordHelp",
											"Write-only client secret generated under Certificates & secrets in Microsoft Entra ID.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							);
						}}
					</credentialsForm.Field>

					<credentialsForm.Field name="tenantDisplayName">
						{(field) => (
							<TFormItem>
								<TFormLabel htmlFor={tenantNameInputId}>
									{t(
										"settings.teamsPrepare.credentials.tenantDisplayName",
										"Tenant Display Name (optional)",
									)}
								</TFormLabel>
								<TFormControl>
									<Input
										id={tenantNameInputId}
										name="tenantDisplayName"
										placeholder="Contoso Microsoft 365"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										disabled={isSavingCredentials}
										autoComplete="off"
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.teamsPrepare.credentials.tenantDisplayNameHelp",
										"Friendly label shown during verification and switch review.",
									)}
								</TFormDescription>
							</TFormItem>
						)}
					</credentialsForm.Field>
				</div>

				{credentialsError ? (
					<p role="alert" className="text-sm text-destructive">
						{credentialsError}
					</p>
				) : null}

				<Button type="submit" disabled={isSavingCredentials}>
					{isSavingCredentials ? (
						<IconLoader2 className="mr-2 size-4 motion-safe:animate-spin" aria-hidden="true" />
					) : (
						<IconKey className="mr-2 size-4" aria-hidden="true" />
					)}
					{setup.hasStoredCredentials
						? t("settings.teamsPrepare.credentials.updateButton", "Save new credential revision")
						: t("settings.teamsPrepare.credentials.saveButton", "Save single-tenant credentials")}
				</Button>
			</form>
		</section>
	);
}

function VerificationSection(props: PanelState & { setup: NonNullable<PanelState["setup"]> }) {
	const {
		t,
		idPrefix,
		proactiveTestError,
		setProactiveTestError,
		refreshMutation,
		sendProactiveTestMutation,
		setup,
	} = props;
	return (
		<section
			aria-labelledby={`${idPrefix}-test-heading`}
			className="min-w-0 space-y-4 border-t pt-4"
		>
			<VerificationHeading
				headingId={`${idPrefix}-test-heading`}
				title={t("settings.teamsPrepare.test.heading", "3. Test & verify single-tenant Teams app")}
				description={t(
					"settings.teamsPrepare.test.description",
					"Candidate verification never executes production commands, approval cards, or live notifications. Employees with a proven same-tenant Entra identity can message the bot directly; others link with a code from Settings → Notifications.",
				)}
				refreshLabel={t("settings.teamsPrepare.test.refreshStatus", "Refresh status")}
				pending={refreshMutation.isPending}
				onRefresh={() => refreshMutation.mutate()}
			/>

			<ul className="space-y-3">
				<VerificationStepRow
					provider="teams"
					title={t(
						"settings.teamsPrepare.steps.credentials.title",
						"Single-tenant credentials & tenant ownership",
					)}
					description={t(
						"settings.teamsPrepare.steps.credentials.description",
						"Microsoft App ID, Entra Tenant ID, and write-only client secret stored in an immutable organization-scoped revision.",
					)}
					step={setup.steps.credentials}
					t={t}
				/>

				<VerificationStepRow
					provider="teams"
					title={t(
						"settings.teamsPrepare.steps.inboundProof.title",
						"Authenticated inbound activity (matching app & tenant)",
					)}
					description={t(
						"settings.teamsPrepare.steps.inboundProof.description",
						"Open a 1:1 personal chat with your candidate Teams bot and send a message (e.g., 'verify') so Z8 confirms your Bot Framework token, App ID, Tenant ID, and personal conversation reachability.",
					)}
					step={setup.steps.inboundProof}
					action={
						setup.steps.inboundProof.status === "failed" ||
						setup.steps.inboundProof.status === "expired" ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={refreshMutation.isPending}
								onClick={() => refreshMutation.mutate()}
							>
								<IconRefresh className="mr-1.5 size-4" aria-hidden="true" />
								{t("settings.teamsPrepare.steps.inboundProof.retry", "Recheck inbound activity")}
							</Button>
						) : null
					}
					t={t}
				/>

				<VerificationStepRow
					provider="teams"
					title={t(
						"settings.teamsPrepare.steps.privateTest.title",
						"Proactive private test message",
					)}
					description={
						setup.hasPrivateReachability
							? t(
									"settings.teamsPrepare.steps.privateTest.descriptionReady",
									"Personal conversation reachability is captured for this candidate app. Send a synthetic proactive test message using the installation-scoped adapter.",
								)
							: t(
									"settings.teamsPrepare.steps.privateTest.descriptionMissing",
									"Waiting for a 1:1 personal message to the candidate bot in Microsoft Teams to capture your conversation reference before running the proactive test.",
								)
					}
					step={setup.steps.privateTest}
					action={
						setup.hasStoredCredentials ? (
							<div className="space-y-2 pt-1">
								<Button
									type="button"
									variant={
										setup.steps.privateTest.status === "failed" ||
										setup.steps.privateTest.status === "expired"
											? "default"
											: "outline"
									}
									size="sm"
									disabled={sendProactiveTestMutation.isPending}
									onClick={() => {
										setProactiveTestError(null);
										sendProactiveTestMutation.mutate({
											installationId: setup.installationId,
										});
									}}
								>
									{sendProactiveTestMutation.isPending ? (
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
												"settings.teamsPrepare.test.retryProactiveTest",
												"Retry proactive private test",
											)
										: t(
												"settings.teamsPrepare.test.sendProactiveTest",
												"Send proactive private test",
											)}
								</Button>
								{proactiveTestError ? (
									<p role="alert" className="text-xs text-destructive">
										{proactiveTestError}
									</p>
								) : null}
							</div>
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
					<IconShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
					<p className="break-words text-xs sm:text-sm">
						{t(
							"settings.teamsPrepare.readyBanner",
							"Your single-tenant Microsoft Teams app passed credential, authenticated inbound activity, and proactive private delivery checks. Existing legacy Teams tenants remain active until you review and confirm a switch.",
						)}
					</p>
				</div>
			) : null}
		</section>
	);
}

export function TeamsPrepareTestPanel(props: TeamsPrepareTestPanelProps) {
	const model = useTeamsPrepareTestPanel(props);
	const { t, setup, announcement, prepareMutation } = model;
	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1">
						<CardTitle className="flex items-center gap-2 text-base">
							<IconBrandTeams className="size-4 shrink-0" aria-hidden="true" />
							{t("settings.teamsPrepare.title", "Prepare & test single-tenant Microsoft Teams app")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.teamsPrepare.description",
								"Stage and verify an organization-owned, single-tenant Microsoft Teams app without interrupting your active Teams tenants. Switching happens separately after verification passes.",
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
								? t("settings.teamsPrepare.badge.ready", "Ready to review switch")
								: t("settings.teamsPrepare.badge.candidate", "Candidate setup")}
						</Badge>
					) : null}
				</div>
			</CardHeader>

			<CardContent className="min-w-0 space-y-6">
				{!setup ? (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.teamsPrepare.emptyPrompt",
								"Generate a dedicated single-tenant Teams app package, messaging endpoint, and Microsoft Teams Admin Center rollout instructions. Your current Teams deployment continues serving traffic throughout setup.",
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
								<IconBrandTeams className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("settings.teamsPrepare.prepareButton", "Prepare single-tenant Teams app")}
						</Button>
					</div>
				) : (
					<>
						{/* Step 1: Messaging Endpoint, App Package & Microsoft Admin Rollout Instructions */}
						<ManifestSection {...model} setup={setup} />

						{/* Step 2: Write-Only Single-Tenant Credentials */}
						<CredentialsSection {...model} setup={setup} />

						{/* Step 3: Verification Checklist & Proactive Private Test */}
						<VerificationSection {...model} setup={setup} />
					</>
				)}

				<p className="sr-only" aria-live="polite" aria-atomic="true">
					{announcement}
				</p>
			</CardContent>
		</Card>
	);
}
