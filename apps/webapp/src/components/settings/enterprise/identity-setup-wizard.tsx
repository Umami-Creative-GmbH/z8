"use client";

import { useForm } from "@tanstack/react-form";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	activateEnterpriseIdentitySetupAction,
	generateEnterpriseIdentityScimTokenAction,
	recordEnterpriseIdentitySsoTestAction,
	refreshEnterpriseIdentityDomainStatusAction,
	refreshEnterpriseIdentityScimStatusAction,
	registerEnterpriseIdentitySSOProviderAction,
	type EnterpriseIdentitySetupResponse,
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
	getEnterpriseIdentityReadiness,
	type EnterpriseIdentitySetupState,
	type EnterpriseIdentitySetupStep,
} from "@/lib/enterprise-identity/setup-state";

interface IdentitySetupWizardProps {
	initialSetup: EnterpriseIdentitySetupResponse;
	organizationId: string;
}

interface StepDefinition {
	id: EnterpriseIdentitySetupStep;
	label: string;
	description: string;
}

const STEPS: StepDefinition[] = [
	{ id: "provider", label: "Provider", description: "Pick the identity source" },
	{ id: "domain", label: "Domain", description: "Confirm tenant boundary" },
	{ id: "sso", label: "SSO Configuration", description: "Register OIDC or SAML" },
	{ id: "ssoTest", label: "Test User", description: "Record live sign-in result" },
	{ id: "scim", label: "SCIM Provisioning", description: "Issue provisioning token" },
	{ id: "accessPolicy", label: "Access Policy", description: "Set enforcement rules" },
	{ id: "review", label: "Review & Activate", description: "Guard activation" },
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

function statusBadge(status: string) {
	if (status === "complete") return <Badge variant="secondary">Ready</Badge>;
	if (status === "current") return <Badge>Now</Badge>;
	return <Badge variant="outline">Queued</Badge>;
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
	return (
		<Card className="h-fit border-border/80 bg-muted/20 py-4 shadow-xs lg:sticky lg:top-4">
			<CardContent className="space-y-2 px-3">
				<p className="px-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
					Readiness rail
				</p>
				<ol className="space-y-1">
					{STEPS.map((step) => {
						const status = stepStatus(step.id, setup);

						return (
							<li
								key={step.id}
								className="rounded-lg border bg-background/80 px-3 py-2 text-sm"
							>
								<div className="flex min-w-0 items-center justify-between gap-2">
									<span className="truncate font-medium">{step.label}</span>
									{statusBadge(status)}
								</div>
								<p className="mt-1 truncate text-muted-foreground text-xs">{step.description}</p>
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

export function IdentitySetupWizard({ initialSetup, organizationId }: IdentitySetupWizardProps) {
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
	const domain = setup.domain?.domain ?? "Not selected";
	const providerId = setup.provider?.providerId ?? "";
	const protocol = setup.provider?.protocol ?? preset.defaultProtocol;
	const scimActivityObserved = setup.scim.verified && !!setup.scim.lastCheckedAt;

	const providerForm = useForm({
		defaultValues: {
			preset: setup.provider?.preset ?? "generic",
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
					toast.success("Identity provider saved");
				} catch (error) {
					toast.error(error instanceof Error ? error.message : "Failed to save provider");
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
				try {
					if (!providerId || !setup.domain?.domain) {
						throw new Error("Save provider and domain before registering SSO");
					}

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
					toast.success("SSO provider registered");
				} catch (error) {
					toast.error(error instanceof Error ? error.message : "Failed to register SSO provider");
				}
			});
		},
	});

	const recordSsoTest = (status: "passed" | "failed") => {
		startTransition(async () => {
			try {
				if (!providerId) throw new Error("Save provider before recording a test");
				const next = await recordEnterpriseIdentitySsoTestAction({
					providerId,
					testEmail,
					status,
					error: status === "failed" ? testError || "Live SSO test failed" : null,
				});
				setSetup(next.state);
				toast.success(status === "passed" ? "SSO test marked passed" : "SSO test marked failed");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to record SSO test");
			}
		});
	};

	const generateScimToken = () => {
		startTransition(async () => {
			try {
				if (!providerId) throw new Error("Save provider before generating a SCIM token");
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
				toast.success("SCIM token generated");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to generate SCIM token");
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
				toast.success("SCIM status refreshed");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to refresh SCIM status");
			}
		});
	};

	const refreshDomainStatus = () => {
		startTransition(async () => {
			try {
				const next = await refreshEnterpriseIdentityDomainStatusAction();
				setSetup(next.state);
				toast.success("Domain status refreshed");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to refresh domain status");
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
				toast.success("Access policy saved");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to save access policy");
			}
		});
	};

	const activateSetup = () => {
		startTransition(async () => {
			try {
				const next = await activateEnterpriseIdentitySetupAction();
				setSetup(next.state);
				toast.success("Enterprise identity setup activated");
			} catch (error) {
				toast.error(error instanceof Error ? error.message : "Failed to activate setup");
			}
		});
	};

	const updateEnforcement = (key: keyof EnterpriseIdentitySetupState["enforcement"], value: boolean) => {
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
						<p className="font-medium text-primary text-sm">Enterprise identity</p>
						<h2 className="text-xl font-semibold tracking-tight">Operational command checklist</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							Configure SSO, SCIM, and enforcement for organization {organizationId} with guarded
							activation.
						</p>
					</div>
					<Badge variant={setup.activatedAt ? "default" : "outline"} className="w-fit">
						{setup.activatedAt ? "Activated" : "Draft"}
					</Badge>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[220px_1fr]">
				<StepRail setup={setup} />

				<div className="min-w-0 space-y-4">
					<WizardCard
						title="Provider"
						description="Choose the identity provider preset, protocol, provider ID, and email domain."
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
										<Label htmlFor="identity-provider-preset">Provider preset</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => {
												const nextPreset = selectedPreset(value as EnterpriseIdentityProviderPresetId);
												field.handleChange(value as EnterpriseIdentityProviderPresetId);
												providerForm.setFieldValue("protocol", nextPreset.defaultProtocol);
											}}
										>
											<SelectTrigger id="identity-provider-preset" className="w-full min-w-0">
												<SelectValue placeholder="Select provider" />
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
											{selectedPreset(field.state.value as EnterpriseIdentityProviderPresetId).description}
										</p>
									</div>
								)}
							</providerForm.Field>

							<providerForm.Field name="protocol">
								{(field) => (
									<div className="min-w-0 space-y-2">
										<Label htmlFor="identity-provider-protocol">Protocol</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as EnterpriseIdentityProtocol)}
										>
											<SelectTrigger id="identity-provider-protocol" className="w-full min-w-0">
												<SelectValue placeholder="Select protocol" />
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
									onChange: ({ value }) => (value.trim() ? undefined : "Provider ID is required"),
								}}
							>
								{(field) => (
									<div className="min-w-0 space-y-2">
										<Label htmlFor="identity-provider-id">Provider ID</Label>
										<Input
											id="identity-provider-id"
											name="providerId"
											autoComplete="off"
											spellCheck={false}
											placeholder="e.g. acme-okta…"
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
								validators={{ onChange: ({ value }) => (value.trim() ? undefined : "Domain is required") }}
							>
								{(field) => (
									<div className="min-w-0 space-y-2">
										<Label htmlFor="identity-domain">Email domain</Label>
										<Input
											id="identity-domain"
											name="domain"
											autoComplete="off"
											spellCheck={false}
											placeholder="e.g. example.com…"
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
									Save provider
								</Button>
							</div>
						</form>
					</WizardCard>

					<WizardCard
						title="Domain"
						description="Validate the tenant boundary before enforcing SSO for employees."
					>
						<div className="rounded-lg border bg-muted/30 p-4">
							<div className="flex min-w-0 items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="text-muted-foreground text-sm">Selected domain</p>
									<p className="truncate font-medium">{domain}</p>
								</div>
								<Badge variant={setup.domain?.verified ? "default" : "outline"}>
									{setup.domain?.verified ? "Verified" : "Pending"}
								</Badge>
							</div>
							<p className="mt-3 text-muted-foreground text-sm">
								DNS verification uses the existing SSO domain verification actions. Complete that
								verification before activating enforcement.
							</p>
							<Button
								type="button"
								variant="outline"
								className="mt-4"
								onClick={refreshDomainStatus}
								disabled={isPending || !providerId || !setup.domain?.domain}
							>
								Check domain status
							</Button>
						</div>
					</WizardCard>

					<WizardCard
						title="SSO Configuration"
						description="Register the external IdP using OIDC client credentials or SAML metadata."
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
										<Label htmlFor="sso-issuer">Issuer</Label>
										<Input
											id="sso-issuer"
											name="issuer"
											autoComplete="off"
											spellCheck={false}
											placeholder={`${preset.issuerPlaceholder}…`}
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
												<Label htmlFor="oidc-client-id">Client ID</Label>
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
												<Label htmlFor="oidc-client-secret">Client secret</Label>
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
											<Label htmlFor="saml-metadata">SAML metadata</Label>
											<Textarea
												id="saml-metadata"
												name="metadata"
												autoComplete="off"
												spellCheck={false}
												className="min-h-32"
												placeholder="Paste IdP metadata XML…"
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
											/>
										</div>
									)}
								</ssoForm.Field>
							)}

							<Button type="submit" disabled={isPending || !providerId}>
								Register SSO provider
							</Button>
						</form>
					</WizardCard>

					<WizardCard
						title="Test User"
						description="Record the result of a live external SSO test before enforcement."
					>
						<div className="grid min-w-0 gap-4 sm:grid-cols-2">
							<div className="min-w-0 space-y-2">
								<Label htmlFor="sso-test-email">Test user email</Label>
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
								<Label htmlFor="sso-test-error">Failure note</Label>
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
							This records a live external SSO test result. Run the login in the IdP first, then
							capture pass or fail here for the activation guard.
						</p>
						<div className="flex flex-wrap gap-2">
							<Button type="button" disabled={isPending || !testEmail} onClick={() => recordSsoTest("passed")}>
								Record pass
							</Button>
							<Button
								type="button"
								variant="outline"
								disabled={isPending || !testEmail}
								onClick={() => recordSsoTest("failed")}
							>
								Record fail
							</Button>
							<Badge variant={setup.ssoTest.status === "passed" ? "default" : "outline"}>
								{setup.ssoTest.status}
							</Badge>
						</div>
					</WizardCard>

					<WizardCard
						title="SCIM Provisioning"
						description="Generate the provisioning token and monitor connection health."
					>
						<p className="text-muted-foreground text-sm">
							SCIM verification updates after your identity provider sends a test user or group change.
						</p>
						<div className="grid min-w-0 gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
							<div className="min-w-0">
								<p className="text-muted-foreground text-sm">Base URL</p>
								<code className="block truncate rounded bg-background px-2 py-1 text-sm">
									/api/auth/scim/v2
								</code>
							</div>
							<Button type="button" onClick={generateScimToken} disabled={isPending || !providerId}>
								Generate token
							</Button>
						</div>

						{scimToken ? (
							<div className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-4">
								<p className="font-medium text-sm">This token is shown once</p>
								<div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row">
									<code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-2 text-sm">
										{scimToken}
									</code>
									<Button
										type="button"
										variant="outline"
										onClick={() => navigator.clipboard.writeText(scimToken)}
									>
										Copy token
									</Button>
								</div>
							</div>
						) : null}

						<div className="flex flex-wrap items-center gap-2">
							<Button type="button" variant="outline" onClick={refreshScimStatus} disabled={isPending}>
								Refresh status
							</Button>
							<Badge variant={scimActivityObserved ? "default" : "outline"}>
								{scimActivityObserved ? "Provisioning activity observed" : "No provisioning activity yet"}
							</Badge>
							{setup.scim.error ? <span className="text-destructive text-sm">{setup.scim.error}</span> : null}
						</div>
					</WizardCard>

					<WizardCard
						title="Access Policy"
						description="Set domain, invite, and SSO enforcement after the pilot test passes."
					>
						<div className="space-y-3">
							<label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
								<Checkbox
									checked={setup.enforcement.ssoRequired}
									onCheckedChange={(checked) => updateEnforcement("ssoRequired", checked === true)}
								/>
								<span className="min-w-0">
									<span className="block font-medium">Require SSO</span>
									<span className="block text-muted-foreground">Employees must use the enterprise IdP.</span>
								</span>
							</label>
							<label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
								<Checkbox
									checked={setup.enforcement.domainRestrictionEnabled}
									onCheckedChange={(checked) =>
										updateEnforcement("domainRestrictionEnabled", checked === true)
									}
								/>
								<span className="min-w-0">
									<span className="block font-medium">Restrict to verified domain</span>
									<span className="block text-muted-foreground">Block accounts outside the selected domain.</span>
								</span>
							</label>
							<label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
								<Checkbox
									checked={setup.enforcement.inviteRestrictionEnabled}
									onCheckedChange={(checked) =>
										updateEnforcement("inviteRestrictionEnabled", checked === true)
									}
								/>
								<span className="min-w-0">
									<span className="block font-medium">Restrict invites</span>
									<span className="block text-muted-foreground">Only allow invitations aligned with access policy.</span>
								</span>
							</label>
						</div>

						<div className="space-y-2">
							<Label htmlFor="default-role-template">Default role template</Label>
							<Select value={defaultRoleTemplateId} onValueChange={setDefaultRoleTemplateId}>
								<SelectTrigger id="default-role-template" className="w-full min-w-0">
									<SelectValue placeholder="Select role template" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">No default template</SelectItem>
									{initialSetup.roleTemplates.map((template) => (
										<SelectItem key={template.id} value={template.id}>
											{template.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<Button type="button" onClick={saveAccessPolicy} disabled={isPending}>
							Save access policy
						</Button>
					</WizardCard>

					<WizardCard
						title="Review & Activate"
						description="Review guarded activation checks before enabling enterprise identity controls."
					>
						<div className="rounded-lg border bg-muted/30 p-4">
							<p className="font-medium text-sm">Activation summary</p>
							{readiness.missing.length ? (
								<ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground text-sm">
									{readiness.missing.map((item) => (
										<li key={item}>{item} is required before activation</li>
									))}
								</ul>
							) : (
								<p className="mt-2 text-muted-foreground text-sm">
									Provider, verified domain, and SSO test prerequisites are complete.
								</p>
							)}
						</div>
						<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
							<p className="font-medium">Current-admin lockout warning</p>
							<p className="mt-1 text-muted-foreground">
								Confirm your current admin account can sign in through the configured provider before
								activation. Enforcement may block password fallback for the selected domain.
							</p>
						</div>
						<Button type="button" onClick={activateSetup} disabled={!readiness.canActivate || isPending}>
							Activate enterprise identity
						</Button>
					</WizardCard>
				</div>
			</div>
		</section>
	);
}
