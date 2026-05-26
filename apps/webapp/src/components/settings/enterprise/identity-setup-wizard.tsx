"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	activateEnterpriseIdentitySetupAction,
	type EnterpriseIdentitySetupResponse,
	generateEnterpriseIdentityScimTokenAction,
	recordEnterpriseIdentitySsoTestAction,
	refreshEnterpriseIdentityDomainStatusAction,
	refreshEnterpriseIdentityScimStatusAction,
	registerEnterpriseIdentitySSOProviderAction,
	updateEnterpriseIdentityAccessPolicyAction,
	updateEnterpriseIdentityProviderAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	ENTERPRISE_IDENTITY_PROVIDER_PRESETS,
	type EnterpriseIdentityProtocol,
	type EnterpriseIdentityProviderPresetId,
} from "@/lib/enterprise-identity/provider-presets";
import {
	type EnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupStep,
	getEnterpriseIdentityReadiness,
} from "@/lib/enterprise-identity/setup-state";

interface IdentitySetupWizardProps {
	initialSetup: EnterpriseIdentitySetupResponse;
	organizationId: string;
}

interface StepDefinition {
	id: EnterpriseIdentitySetupStep;
}

const STEPS: StepDefinition[] = [
	{ id: "provider" },
	{ id: "domain" },
	{ id: "sso" },
	{ id: "ssoTest" },
	{ id: "scim" },
	{ id: "accessPolicy" },
	{ id: "review" },
];

const STEP_INDEX = new Map(STEPS.map((step, index) => [step.id, index]));
const PROVIDER_OPTIONS = Object.values(ENTERPRISE_IDENTITY_PROVIDER_PRESETS);
const DEFAULT_PRESET = ENTERPRISE_IDENTITY_PROVIDER_PRESETS.generic;

function stepStatus(step: EnterpriseIdentitySetupStep, setup: EnterpriseIdentitySetupState) {
	const currentIndex = STEP_INDEX.get(setup.currentStep) ?? 0;
	const stepIndex = STEP_INDEX.get(step) ?? 0;

	if (stepIndex < currentIndex) return "complete";
	if (stepIndex === currentIndex) return "current";
	return "waiting";
}

function statusBadge(status: string, t: (key: string, fallback: string) => string) {
	if (status === "complete") {
		return (
			<Badge variant="secondary">{t("settings.enterprise.identity.badge.ready", "Ready")}</Badge>
		);
	}
	if (status === "current")
		return <Badge>{t("settings.enterprise.identity.badge.now", "Now")}</Badge>;
	return (
		<Badge variant="outline">{t("settings.enterprise.identity.badge.queued", "Queued")}</Badge>
	);
}

function getStepCopy(
	step: EnterpriseIdentitySetupStep,
	t: (key: string, fallback: string) => string,
) {
	switch (step) {
		case "provider":
			return {
				label: t("settings.enterprise.identity.step.provider", "Provider"),
				description: t(
					"settings.enterprise.identity.step.provider.description",
					"Pick the identity source",
				),
			};
		case "domain":
			return {
				label: t("settings.enterprise.identity.step.domain", "Domain"),
				description: t(
					"settings.enterprise.identity.step.domain.description",
					"Confirm tenant boundary",
				),
			};
		case "sso":
			return {
				label: t("settings.enterprise.identity.step.sso", "SSO Configuration"),
				description: t(
					"settings.enterprise.identity.step.sso.description",
					"Register OIDC or SAML",
				),
			};
		case "ssoTest":
			return {
				label: t("settings.enterprise.identity.step.ssoTest", "Test User"),
				description: t(
					"settings.enterprise.identity.step.ssoTest.description",
					"Record live sign-in result",
				),
			};
		case "scim":
			return {
				label: t("settings.enterprise.identity.step.scim", "SCIM Provisioning"),
				description: t(
					"settings.enterprise.identity.step.scim.description",
					"Issue provisioning token",
				),
			};
		case "accessPolicy":
			return {
				label: t("settings.enterprise.identity.step.accessPolicy", "Access Policy"),
				description: t(
					"settings.enterprise.identity.step.accessPolicy.description",
					"Set enforcement rules",
				),
			};
		case "review":
			return {
				label: t("settings.enterprise.identity.step.review", "Review & Activate"),
				description: t("settings.enterprise.identity.step.review.description", "Guard activation"),
			};
	}
}

function WizardCard({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<Card className="min-w-0 border-border/80 shadow-xs">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="min-w-0 space-y-4">{children}</CardContent>
		</Card>
	);
}

function FieldError({ message }: { message: unknown }) {
	if (!message) return null;
	return (
		<p aria-live="polite" className="text-destructive text-sm">
			{String(message)}
		</p>
	);
}

function StepRail({ setup }: { setup: EnterpriseIdentitySetupState }) {
	const { t } = useTranslate();

	return (
		<Card className="h-fit border-border/80 bg-muted/20 py-4 shadow-xs lg:sticky lg:top-4">
			<CardContent className="space-y-2 px-3">
				<p className="px-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					{t("settings.enterprise.identity.rail.title", "Readiness rail")}
				</p>
				<ol className="space-y-1">
					{STEPS.map((step) => {
						const status = stepStatus(step.id, setup);
						const copy = getStepCopy(step.id, t);

						return (
							<li key={step.id} className="rounded-lg border bg-background/80 px-3 py-2 text-sm">
								<div className="flex min-w-0 items-center justify-between gap-2">
									<span className="truncate font-medium">{copy.label}</span>
									{statusBadge(status, t)}
								</div>
								<p className="mt-1 truncate text-muted-foreground text-xs">{copy.description}</p>
							</li>
						);
					})}
				</ol>
			</CardContent>
		</Card>
	);
}

function selectedPreset(id: EnterpriseIdentityProviderPresetId) {
	return ENTERPRISE_IDENTITY_PROVIDER_PRESETS[id] ?? DEFAULT_PRESET;
}

function presetDescription(
	id: EnterpriseIdentityProviderPresetId,
	t: (key: string, fallback: string) => string,
) {
	if (id === "okta") {
		return t(
			"settings.enterprise.identity.provider.preset.okta.description",
			"Use Okta Workforce Identity for SAML or OIDC single sign-on.",
		);
	}
	if (id === "microsoft-entra") {
		return t(
			"settings.enterprise.identity.provider.preset.microsoftEntra.description",
			"Use Microsoft Entra ID for enterprise SSO and optional provisioning.",
		);
	}
	if (id === "google-workspace") {
		return t(
			"settings.enterprise.identity.provider.preset.googleWorkspace.description",
			"Use Google Workspace OIDC for SSO and optional directory sync.",
		);
	}
	return t(
		"settings.enterprise.identity.provider.preset.generic.description",
		"Use any standards-compliant OIDC or SAML 2.0 identity provider.",
	);
}

function presetIssuerPlaceholder(
	id: EnterpriseIdentityProviderPresetId,
	t: (key: string, fallback: string) => string,
) {
	if (id === "okta") {
		return t("settings.enterprise.identity.sso.placeholder.issuer.okta", "https://acme.okta.com…");
	}
	if (id === "microsoft-entra") {
		return t(
			"settings.enterprise.identity.sso.placeholder.issuer.microsoftEntra",
			"https://login.microsoftonline.com/{tenant-id}/v2.0…",
		);
	}
	if (id === "google-workspace") {
		return t(
			"settings.enterprise.identity.sso.placeholder.issuer.googleWorkspace",
			"https://accounts.google.com…",
		);
	}
	return t(
		"settings.enterprise.identity.sso.placeholder.issuer.generic",
		"https://idp.example.com…",
	);
}

function ssoTestStatusLabel(
	status: EnterpriseIdentitySetupState["ssoTest"]["status"],
	t: (key: string, fallback: string) => string,
) {
	if (status === "passed") {
		return t("settings.enterprise.identity.ssoTest.status.passed", "Passed");
	}
	if (status === "failed") {
		return t("settings.enterprise.identity.ssoTest.status.failed", "Failed");
	}
	return t("settings.enterprise.identity.ssoTest.status.notRun", "Not run");
}

function readinessRequirementLabel(
	item: "provider" | "domain" | "ssoTest",
	t: (key: string, fallback: string) => string,
) {
	if (item === "provider") {
		return t("settings.enterprise.identity.review.requirement.provider", "Provider");
	}
	if (item === "domain") {
		return t("settings.enterprise.identity.review.requirement.domain", "Verified domain");
	}
	return t("settings.enterprise.identity.review.requirement.ssoTest", "SSO test");
}

export function IdentitySetupWizard({ initialSetup, organizationId }: IdentitySetupWizardProps) {
	const { t } = useTranslate();
	const [setup, setSetup] = useState(initialSetup.state);
	const [scimToken, setScimToken] = useState<string | null>(null);
	const [defaultRoleTemplateId, setDefaultRoleTemplateId] = useState(
		initialSetup.defaultRoleTemplateId ?? "none",
	);
	const [testEmail, setTestEmail] = useState(initialSetup.state.ssoTest.testEmail ?? "");
	const [testError, setTestError] = useState(initialSetup.state.ssoTest.error ?? "");
	const [isPending, startTransition] = useTransition();
	const readiness = getEnterpriseIdentityReadiness(setup);
	const preset = selectedPreset(setup.provider?.preset ?? "generic");
	const presetId = setup.provider?.preset ?? "generic";
	const domain =
		setup.domain?.domain ?? t("settings.enterprise.identity.domain.notSelected", "Not selected");
	const providerId = setup.provider?.providerId ?? "";
	const protocol = setup.provider?.protocol ?? preset.defaultProtocol;
	const scimActivityObserved = setup.scim.verified && !!setup.scim.lastCheckedAt;

	const providerForm = useForm({
		defaultValues: {
			preset: presetId,
			protocol,
			providerId: setup.provider?.providerId ?? "",
			domain: setup.domain?.domain ?? "",
		},
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				try {
					const next = await updateEnterpriseIdentityProviderAction({
						preset: value.preset as EnterpriseIdentityProviderPresetId,
						protocol: value.protocol as EnterpriseIdentityProtocol,
						providerId: value.providerId,
						domain: value.domain,
						currentStep: "domain",
					});
					setSetup(next.state);
					toast.success(
						t("settings.enterprise.identity.toast.providerSaved", "Identity provider saved"),
					);
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: t(
									"settings.enterprise.identity.toast.providerSaveFailed",
									"Failed to save provider",
								),
					);
				}
			});
		},
	});

	const ssoForm = useForm({
		defaultValues: {
			issuer: "",
			clientId: "",
			clientSecret: "",
			metadata: "",
		},
		onSubmit: async ({ value }) => {
			startTransition(async () => {
				if (!providerId || !setup.domain?.domain) {
					toast.error(
						t(
							"settings.enterprise.identity.sso.error.saveProviderFirst",
							"Save provider and domain before registering SSO",
						),
					);
					return;
				}

				try {
					const next = await registerEnterpriseIdentitySSOProviderAction(
						protocol === "oidc"
							? {
									protocol: "oidc",
									providerId,
									issuer: value.issuer,
									domain: setup.domain.domain,
									clientId: value.clientId,
									clientSecret: value.clientSecret,
									scopes: preset.defaultOidcScopes,
								}
							: {
									protocol: "saml",
									providerId,
									issuer: value.issuer,
									domain: setup.domain.domain,
									metadata: value.metadata,
								},
					);
					setSetup(next.state);
					toast.success(
						t("settings.enterprise.identity.toast.ssoRegistered", "SSO provider registered"),
					);
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: t(
									"settings.enterprise.identity.toast.ssoRegisterFailed",
									"Failed to register SSO provider",
								),
					);
				}
			});
		},
	});

	const recordSsoTest = (status: "passed" | "failed") => {
		startTransition(async () => {
			if (!providerId) {
				toast.error(
					t(
						"settings.enterprise.identity.ssoTest.error.saveProviderFirst",
						"Save provider before recording a test",
					),
				);
				return;
			}

			try {
				const next = await recordEnterpriseIdentitySsoTestAction({
					providerId,
					testEmail,
					status,
					error:
						status === "failed"
							? testError ||
								t("settings.enterprise.identity.ssoTest.defaultFailure", "Live SSO test failed")
							: null,
				});
				setSetup(next.state);
				toast.success(
					status === "passed"
						? t("settings.enterprise.identity.toast.ssoTestPassed", "SSO test marked passed")
						: t("settings.enterprise.identity.toast.ssoTestFailed", "SSO test marked failed"),
				);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t(
								"settings.enterprise.identity.toast.ssoTestRecordFailed",
								"Failed to record SSO test",
							),
				);
			}
		});
	};

	const generateScimToken = () => {
		startTransition(async () => {
			if (!providerId) {
				toast.error(
					t(
						"settings.enterprise.identity.scim.error.saveProviderFirst",
						"Save provider before generating a SCIM token",
					),
				);
				return;
			}

			try {
				const result = await generateEnterpriseIdentityScimTokenAction({
					providerId,
					defaultRoleTemplateId: defaultRoleTemplateId === "none" ? null : defaultRoleTemplateId,
				});
				setScimToken(result.scimToken ?? null);
				setSetup((current) => ({
					...current,
					currentStep: "accessPolicy",
					scim: {
						...current.scim,
						enabled: true,
						providerId,
						error: null,
					},
				}));
				toast.success(
					t("settings.enterprise.identity.toast.scimTokenGenerated", "SCIM token generated"),
				);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t(
								"settings.enterprise.identity.toast.scimTokenFailed",
								"Failed to generate SCIM token",
							),
				);
			}
		});
	};

	const refreshScimStatus = () => {
		startTransition(async () => {
			try {
				const result = await refreshEnterpriseIdentityScimStatusAction();
				setSetup((current) => ({
					...current,
					scim: {
						...current.scim,
						verified: result.verified,
						lastCheckedAt: result.checkedAt,
						error: result.error,
					},
				}));
				toast.success(
					t("settings.enterprise.identity.toast.scimStatusRefreshed", "SCIM status refreshed"),
				);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t(
								"settings.enterprise.identity.toast.scimStatusFailed",
								"Failed to refresh SCIM status",
							),
				);
			}
		});
	};

	const refreshDomainStatus = () => {
		startTransition(async () => {
			try {
				const next = await refreshEnterpriseIdentityDomainStatusAction();
				setSetup(next.state);
				toast.success(
					t("settings.enterprise.identity.toast.domainStatusRefreshed", "Domain status refreshed"),
				);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t(
								"settings.enterprise.identity.toast.domainStatusFailed",
								"Failed to refresh domain status",
							),
				);
			}
		});
	};

	const saveAccessPolicy = () => {
		startTransition(async () => {
			try {
				const next = await updateEnterpriseIdentityAccessPolicyAction({
					ssoRequired: setup.enforcement.ssoRequired,
					domainRestrictionEnabled: setup.enforcement.domainRestrictionEnabled,
					inviteRestrictionEnabled: setup.enforcement.inviteRestrictionEnabled,
					defaultRoleTemplateId: defaultRoleTemplateId === "none" ? null : defaultRoleTemplateId,
				});
				setSetup(next.state);
				setDefaultRoleTemplateId(next.defaultRoleTemplateId ?? "none");
				toast.success(
					t("settings.enterprise.identity.toast.accessPolicySaved", "Access policy saved"),
				);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t(
								"settings.enterprise.identity.toast.accessPolicyFailed",
								"Failed to save access policy",
							),
				);
			}
		});
	};

	const activateSetup = () => {
		startTransition(async () => {
			try {
				const next = await activateEnterpriseIdentitySetupAction();
				setSetup(next.state);
				toast.success(
					t("settings.enterprise.identity.toast.activated", "Enterprise identity setup activated"),
				);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t("settings.enterprise.identity.toast.activateFailed", "Failed to activate setup"),
				);
			}
		});
	};

	const updateEnforcement = (
		key: keyof EnterpriseIdentitySetupState["enforcement"],
		value: boolean,
	) => {
		setSetup((current) => ({
			...current,
			enforcement: {
				...current.enforcement,
				[key]: value,
			},
		}));
	};

	return (
		<section className="space-y-4">
			<div className="rounded-xl border bg-card/60 p-4 text-card-foreground">
				<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0">
						<p className="font-medium text-primary text-sm">
							{t("settings.enterprise.identity.hero.eyebrow", "Enterprise identity")}
						</p>
						<h2 className="text-xl font-semibold tracking-tight">
							{t("settings.enterprise.identity.hero.title", "Operational command checklist")}
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{t(
								"settings.enterprise.identity.hero.description",
								"Configure SSO, SCIM, and enforcement for organization {organizationId} with guarded activation.",
								{ organizationId },
							)}
						</p>
					</div>
					<Badge variant={setup.activatedAt ? "default" : "outline"} className="w-fit">
						{setup.activatedAt
							? t("settings.enterprise.identity.status.activated", "Activated")
							: t("settings.enterprise.identity.status.draft", "Draft")}
					</Badge>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[220px_1fr]">
				<StepRail setup={setup} />

				<div className="min-w-0 space-y-4">
					<WizardCard
						title={t("settings.enterprise.identity.provider.title", "Provider")}
						description={t(
							"settings.enterprise.identity.provider.description",
							"Choose the identity provider preset, protocol, provider ID, and email domain.",
						)}
					>
						<form
							className="grid min-w-0 gap-4 sm:grid-cols-2"
							onSubmit={(event) => {
								event.preventDefault();
								providerForm.handleSubmit();
							}}
						>
							<providerForm.Field name="preset">
								{(field) => (
									<div className="min-w-0 space-y-2">
										<Label htmlFor="identity-provider-preset">
											{t("settings.enterprise.identity.provider.label.preset", "Provider preset")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => {
												const nextPreset = selectedPreset(
													value as EnterpriseIdentityProviderPresetId,
												);
												field.handleChange(value as EnterpriseIdentityProviderPresetId);
												providerForm.setFieldValue("protocol", nextPreset.defaultProtocol);
											}}
										>
											<SelectTrigger id="identity-provider-preset" className="w-full min-w-0">
												<SelectValue
													placeholder={t(
														"settings.enterprise.identity.provider.placeholder.provider",
														"Select provider",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{PROVIDER_OPTIONS.map((option) => (
													<SelectItem key={option.id} value={option.id}>
														{option.name}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-muted-foreground text-sm">
											{presetDescription(
												field.state.value as EnterpriseIdentityProviderPresetId,
												t,
											)}
										</p>
									</div>
								)}
							</providerForm.Field>

							<providerForm.Field name="protocol">
								{(field) => (
									<div className="min-w-0 space-y-2">
										<Label htmlFor="identity-provider-protocol">
											{t("settings.enterprise.identity.provider.label.protocol", "Protocol")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) =>
												field.handleChange(value as EnterpriseIdentityProtocol)
											}
										>
											<SelectTrigger id="identity-provider-protocol" className="w-full min-w-0">
												<SelectValue
													placeholder={t(
														"settings.enterprise.identity.provider.placeholder.protocol",
														"Select protocol",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												{preset.supportedProtocols.map((option) => (
													<SelectItem key={option} value={option}>
														{option.toUpperCase()}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>
								)}
							</providerForm.Field>

							<providerForm.Field
								name="providerId"
								validators={{
									onChange: ({ value }) =>
										value.trim()
											? undefined
											: t(
													"settings.enterprise.identity.provider.error.providerIdRequired",
													"Provider ID is required",
												),
								}}
							>
								{(field) => (
									<div className="min-w-0 space-y-2">
										<Label htmlFor="identity-provider-id">
											{t("settings.enterprise.identity.provider.label.providerId", "Provider ID")}
										</Label>
										<Input
											id="identity-provider-id"
											name="providerId"
											autoComplete="off"
											spellCheck={false}
											placeholder={t(
												"settings.enterprise.identity.provider.placeholder.providerId",
												"e.g. acme-okta…",
											)}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
										<FieldError message={field.state.meta.errors[0]} />
									</div>
								)}
							</providerForm.Field>

							<providerForm.Field
								name="domain"
								validators={{
									onChange: ({ value }) =>
										value.trim()
											? undefined
											: t(
													"settings.enterprise.identity.provider.error.domainRequired",
													"Domain is required",
												),
								}}
							>
								{(field) => (
									<div className="min-w-0 space-y-2">
										<Label htmlFor="identity-domain">
											{t("settings.enterprise.identity.provider.label.domain", "Email domain")}
										</Label>
										<Input
											id="identity-domain"
											name="domain"
											autoComplete="off"
											spellCheck={false}
											placeholder={t(
												"settings.enterprise.identity.provider.placeholder.domain",
												"e.g. example.com…",
											)}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
										<FieldError message={field.state.meta.errors[0]} />
									</div>
								)}
							</providerForm.Field>

							<div className="sm:col-span-2">
								<Button type="submit" disabled={isPending}>
									{t("settings.enterprise.identity.provider.action.save", "Save provider")}
								</Button>
							</div>
						</form>
					</WizardCard>

					<WizardCard
						title={t("settings.enterprise.identity.domain.title", "Domain")}
						description={t(
							"settings.enterprise.identity.domain.description",
							"Validate the tenant boundary before enforcing SSO for employees.",
						)}
					>
						<div className="rounded-lg border bg-muted/30 p-4">
							<div className="flex min-w-0 items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="text-muted-foreground text-sm">
										{t("settings.enterprise.identity.domain.selected", "Selected domain")}
									</p>
									<p className="truncate font-medium">{domain}</p>
								</div>
								<Badge variant={setup.domain?.verified ? "default" : "outline"}>
									{setup.domain?.verified
										? t("settings.enterprise.identity.domain.status.verified", "Verified")
										: t("settings.enterprise.identity.domain.status.pending", "Pending")}
								</Badge>
							</div>
							<p className="mt-3 text-muted-foreground text-sm">
								{t(
									"settings.enterprise.identity.domain.help",
									"DNS verification uses the existing SSO domain verification actions. Complete that verification before activating enforcement.",
								)}
							</p>
							<Button
								type="button"
								variant="outline"
								className="mt-4"
								onClick={refreshDomainStatus}
								disabled={isPending || !providerId || !setup.domain?.domain}
							>
								{t("settings.enterprise.identity.domain.action.checkStatus", "Check domain status")}
							</Button>
						</div>
					</WizardCard>

					<WizardCard
						title={t("settings.enterprise.identity.sso.title", "SSO Configuration")}
						description={t(
							"settings.enterprise.identity.sso.description",
							"Register the external IdP using OIDC client credentials or SAML metadata.",
						)}
					>
						<form
							className="space-y-4"
							onSubmit={(event) => {
								event.preventDefault();
								ssoForm.handleSubmit();
							}}
						>
							<ssoForm.Field name="issuer">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="sso-issuer">
											{t("settings.enterprise.identity.sso.label.issuer", "Issuer")}
										</Label>
										<Input
											id="sso-issuer"
											name="issuer"
											autoComplete="off"
											spellCheck={false}
											placeholder={presetIssuerPlaceholder(presetId, t)}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									</div>
								)}
							</ssoForm.Field>

							{protocol === "oidc" ? (
								<div className="grid min-w-0 gap-4 sm:grid-cols-2">
									<ssoForm.Field name="clientId">
										{(field) => (
											<div className="min-w-0 space-y-2">
												<Label htmlFor="oidc-client-id">
													{t("settings.enterprise.identity.sso.label.clientId", "Client ID")}
												</Label>
												<Input
													id="oidc-client-id"
													name="clientId"
													autoComplete="off"
													spellCheck={false}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
												/>
											</div>
										)}
									</ssoForm.Field>
									<ssoForm.Field name="clientSecret">
										{(field) => (
											<div className="min-w-0 space-y-2">
												<Label htmlFor="oidc-client-secret">
													{t(
														"settings.enterprise.identity.sso.label.clientSecret",
														"Client secret",
													)}
												</Label>
												<Input
													id="oidc-client-secret"
													name="clientSecret"
													type="password"
													autoComplete="off"
													spellCheck={false}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
												/>
											</div>
										)}
									</ssoForm.Field>
								</div>
							) : (
								<ssoForm.Field name="metadata">
									{(field) => (
										<div className="space-y-2">
											<Label htmlFor="saml-metadata">
												{t("settings.enterprise.identity.sso.label.metadata", "SAML metadata")}
											</Label>
											<Textarea
												id="saml-metadata"
												name="metadata"
												autoComplete="off"
												spellCheck={false}
												className="min-h-32"
												placeholder={t(
													"settings.enterprise.identity.sso.placeholder.metadata",
													"Paste IdP metadata XML…",
												)}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										</div>
									)}
								</ssoForm.Field>
							)}

							<Button type="submit" disabled={isPending || !providerId}>
								{t("settings.enterprise.identity.sso.action.register", "Register SSO provider")}
							</Button>
						</form>
					</WizardCard>

					<WizardCard
						title={t("settings.enterprise.identity.ssoTest.title", "Test User")}
						description={t(
							"settings.enterprise.identity.ssoTest.description",
							"Record the result of a live external SSO test before enforcement.",
						)}
					>
						<div className="grid min-w-0 gap-4 sm:grid-cols-2">
							<div className="min-w-0 space-y-2">
								<Label htmlFor="sso-test-email">
									{t("settings.enterprise.identity.ssoTest.label.email", "Test user email")}
								</Label>
								<Input
									id="sso-test-email"
									name="testEmail"
									type="email"
									autoComplete="off"
									spellCheck={false}
									value={testEmail}
									onChange={(event) => setTestEmail(event.target.value)}
								/>
							</div>
							<div className="min-w-0 space-y-2">
								<Label htmlFor="sso-test-error">
									{t("settings.enterprise.identity.ssoTest.label.failureNote", "Failure note")}
								</Label>
								<Input
									id="sso-test-error"
									name="testError"
									autoComplete="off"
									value={testError}
									onChange={(event) => setTestError(event.target.value)}
								/>
							</div>
						</div>
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.enterprise.identity.ssoTest.help",
								"This records a live external SSO test result. Run the login in the IdP first, then capture pass or fail here for the activation guard.",
							)}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								disabled={isPending || !testEmail}
								onClick={() => recordSsoTest("passed")}
							>
								{t("settings.enterprise.identity.ssoTest.action.recordPass", "Record pass")}
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={isPending || !testEmail}
								onClick={() => recordSsoTest("failed")}
							>
								{t("settings.enterprise.identity.ssoTest.action.recordFail", "Record fail")}
							</Button>
							<Badge variant={setup.ssoTest.status === "passed" ? "default" : "outline"}>
								{ssoTestStatusLabel(setup.ssoTest.status, t)}
							</Badge>
						</div>
					</WizardCard>

					<WizardCard
						title={t("settings.enterprise.identity.scim.title", "SCIM Provisioning")}
						description={t(
							"settings.enterprise.identity.scim.cardDescription",
							"Generate the provisioning token and monitor connection health.",
						)}
					>
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.enterprise.identity.scim.description",
								"SCIM verification updates after your identity provider sends a test user or group change.",
							)}
						</p>
						<div className="grid min-w-0 gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
							<div className="min-w-0">
								<p className="text-muted-foreground text-sm">
									{t("settings.enterprise.identity.scim.baseUrl", "Base URL")}
								</p>
								<code className="block truncate rounded bg-background px-2 py-1 text-sm">
									/api/auth/scim/v2
								</code>
							</div>
							<Button type="button" onClick={generateScimToken} disabled={isPending || !providerId}>
								{t("settings.enterprise.identity.scim.action.generateToken", "Generate token")}
							</Button>
						</div>

						{scimToken ? (
							<div className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-4">
								<p className="font-medium text-sm">
									{t(
										"settings.enterprise.identity.scim.tokenShownOnce",
										"This token is shown once",
									)}
								</p>
								<div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
									<code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-2 text-sm">
										{scimToken}
									</code>
									<Button
										type="button"
										variant="outline"
										onClick={() => navigator.clipboard.writeText(scimToken)}
									>
										{t("settings.enterprise.identity.scim.action.copyToken", "Copy token")}
									</Button>
								</div>
							</div>
						) : null}

						<div className="flex flex-wrap items-center gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={refreshScimStatus}
								disabled={isPending}
							>
								{t("settings.enterprise.identity.scim.action.refreshStatus", "Refresh status")}
							</Button>
							<Badge variant={scimActivityObserved ? "default" : "outline"}>
								{scimActivityObserved
									? t(
											"settings.enterprise.identity.scim.status.observed",
											"Provisioning activity observed",
										)
									: t(
											"settings.enterprise.identity.scim.status.none",
											"No provisioning activity yet",
										)}
							</Badge>
							{setup.scim.error ? (
								<span className="text-destructive text-sm">{setup.scim.error}</span>
							) : null}
						</div>
					</WizardCard>

					<WizardCard
						title={t("settings.enterprise.identity.accessPolicy.title", "Access Policy")}
						description={t(
							"settings.enterprise.identity.accessPolicy.description",
							"Set domain, invite, and SSO enforcement after the pilot test passes.",
						)}
					>
						<div className="space-y-3">
							<div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
								<Checkbox
									id="identity-access-policy-require-sso"
									aria-labelledby="identity-access-policy-require-sso-label"
									aria-describedby="identity-access-policy-require-sso-help"
									checked={setup.enforcement.ssoRequired}
									onCheckedChange={(checked) => updateEnforcement("ssoRequired", checked === true)}
								/>
								<Label
									htmlFor="identity-access-policy-require-sso"
									className="min-w-0 cursor-pointer"
								>
									<span id="identity-access-policy-require-sso-label" className="block font-medium">
										{t("settings.enterprise.identity.accessPolicy.requireSso", "Require SSO")}
									</span>
									<span
										id="identity-access-policy-require-sso-help"
										className="block text-muted-foreground"
									>
										{t(
											"settings.enterprise.identity.accessPolicy.requireSsoHelp",
											"Employees must use the enterprise IdP.",
										)}
									</span>
								</Label>
							</div>
							<div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
								<Checkbox
									id="identity-access-policy-restrict-domain"
									aria-labelledby="identity-access-policy-restrict-domain-label"
									aria-describedby="identity-access-policy-restrict-domain-help"
									checked={setup.enforcement.domainRestrictionEnabled}
									onCheckedChange={(checked) =>
										updateEnforcement("domainRestrictionEnabled", checked === true)
									}
								/>
								<Label
									htmlFor="identity-access-policy-restrict-domain"
									className="min-w-0 cursor-pointer"
								>
									<span
										id="identity-access-policy-restrict-domain-label"
										className="block font-medium"
									>
										{t(
											"settings.enterprise.identity.accessPolicy.restrictDomain",
											"Restrict to verified domain",
										)}
									</span>
									<span
										id="identity-access-policy-restrict-domain-help"
										className="block text-muted-foreground"
									>
										{t(
											"settings.enterprise.identity.accessPolicy.restrictDomainHelp",
											"Block accounts outside the selected domain.",
										)}
									</span>
								</Label>
							</div>
							<div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
								<Checkbox
									id="identity-access-policy-restrict-invites"
									aria-labelledby="identity-access-policy-restrict-invites-label"
									aria-describedby="identity-access-policy-restrict-invites-help"
									checked={setup.enforcement.inviteRestrictionEnabled}
									onCheckedChange={(checked) =>
										updateEnforcement("inviteRestrictionEnabled", checked === true)
									}
								/>
								<Label
									htmlFor="identity-access-policy-restrict-invites"
									className="min-w-0 cursor-pointer"
								>
									<span
										id="identity-access-policy-restrict-invites-label"
										className="block font-medium"
									>
										{t(
											"settings.enterprise.identity.accessPolicy.restrictInvites",
											"Restrict invites",
										)}
									</span>
									<span
										id="identity-access-policy-restrict-invites-help"
										className="block text-muted-foreground"
									>
										{t(
											"settings.enterprise.identity.accessPolicy.restrictInvitesHelp",
											"Only allow invitations aligned with access policy.",
										)}
									</span>
								</Label>
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="default-role-template">
								{t(
									"settings.enterprise.identity.accessPolicy.defaultRoleTemplate",
									"Default role template",
								)}
							</Label>
							<Select value={defaultRoleTemplateId} onValueChange={setDefaultRoleTemplateId}>
								<SelectTrigger id="default-role-template" className="w-full min-w-0">
									<SelectValue
										placeholder={t(
											"settings.enterprise.identity.accessPolicy.placeholder.roleTemplate",
											"Select role template",
										)}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">
										{t(
											"settings.enterprise.identity.accessPolicy.noDefaultTemplate",
											"No default template",
										)}
									</SelectItem>
									{initialSetup.roleTemplates.map((template) => (
										<SelectItem key={template.id} value={template.id}>
											{template.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<Button type="button" onClick={saveAccessPolicy} disabled={isPending}>
							{t("settings.enterprise.identity.accessPolicy.action.save", "Save access policy")}
						</Button>
					</WizardCard>

					<WizardCard
						title={t("settings.enterprise.identity.review.title", "Review & Activate")}
						description={t(
							"settings.enterprise.identity.review.description",
							"Review guarded activation checks before enabling enterprise identity controls.",
						)}
					>
						<div className="rounded-lg border bg-muted/30 p-4">
							<p className="font-medium text-sm">
								{t("settings.enterprise.identity.review.activationSummary", "Activation summary")}
							</p>
							{readiness.missing.length ? (
								<ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-sm">
									{readiness.missing.map((item) => (
										<li key={item}>
											{t(
												"settings.enterprise.identity.review.missingRequirement",
												"{item} is required before activation",
												{ item: readinessRequirementLabel(item, t) },
											)}
										</li>
									))}
								</ul>
							) : (
								<p className="mt-2 text-muted-foreground text-sm">
									{t(
										"settings.enterprise.identity.review.prerequisitesComplete",
										"Provider, verified domain, and SSO test prerequisites are complete.",
									)}
								</p>
							)}
						</div>
						<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
							<p className="font-medium">
								{t(
									"settings.enterprise.identity.review.lockoutWarning",
									"Current-admin lockout warning",
								)}
							</p>
							<p className="mt-1 text-muted-foreground">
								{t(
									"settings.enterprise.identity.review.lockoutWarningHelp",
									"Confirm your current admin account can sign in through the configured provider before activation. Enforcement may block password fallback for the selected domain.",
								)}
							</p>
						</div>
						<Button
							type="button"
							onClick={activateSetup}
							disabled={!readiness.canActivate || isPending}
						>
							{t(
								"settings.enterprise.identity.review.action.activate",
								"Activate enterprise identity",
							)}
						</Button>
					</WizardCard>
				</div>
			</div>
		</section>
	);
}
