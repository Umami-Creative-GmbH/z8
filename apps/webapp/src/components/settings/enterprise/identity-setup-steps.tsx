"use client";

import {
	IconAlertTriangle,
	IconArrowRight,
	IconCheck,
	IconCircleCheck,
	IconCircleDashed,
	IconInfoCircle,
	IconX,
} from "@tabler/icons-react";
import Link from "next/link";
import { type ReactNode, useId, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getEntraIssuer, getOidcCallbackUrl } from "@/lib/enterprise-identity/entra-setup";
import {
	ENTERPRISE_IDENTITY_PROVIDER_PRESETS,
	type EnterpriseIdentityProtocol,
	type EnterpriseIdentityProviderPresetId,
} from "@/lib/enterprise-identity/provider-presets";
import {
	DOMAIN_REGEX,
	type EnterpriseIdentitySetupStep,
	PROVIDER_ID_REGEX,
} from "@/lib/enterprise-identity/setup-state";
import { cn } from "@/lib/utils";
import {
	dnsRecordHost,
	type IdentitySetupController,
	selectedPreset,
	type Translate,
	WIZARD_STEPS,
} from "./identity-setup-controller";
import { domainName, getStepCopy, providerName } from "./identity-setup-copy";
import { ScimStep as ManagedScimStep } from "./scim/scim-step";
import { CopySetupButton, SsoProviderGuide } from "./sso-provider-guide";

const PROVIDER_OPTIONS = Object.values(ENTERPRISE_IDENTITY_PROVIDER_PRESETS);
const SSO_PROVIDERS_TAB = "/settings/enterprise/identity-setup?tab=sso";
const DOMAINS_PAGE = "/settings/enterprise/domains";

function subscribeBrowserOrigin() {
	return () => undefined;
}
function getBrowserOriginSnapshot() {
	return window.location.origin;
}
function getServerBrowserOriginSnapshot() {
	return "";
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

function presetDescription(id: EnterpriseIdentityProviderPresetId, t: Translate) {
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

function presetIssuerPlaceholder(id: EnterpriseIdentityProviderPresetId, t: Translate) {
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

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

type CalloutTone = "info" | "success" | "warning" | "danger";

const CALLOUT_TONE: Record<
	CalloutTone,
	{ box: string; icon: string; Icon: typeof IconInfoCircle }
> = {
	info: { box: "border-border bg-muted/40", icon: "text-primary", Icon: IconInfoCircle },
	success: { box: "border-success/40 bg-success/10", icon: "text-success", Icon: IconCircleCheck },
	warning: {
		box: "border-warning/40 bg-warning/10",
		icon: "text-warning",
		Icon: IconAlertTriangle,
	},
	danger: {
		box: "border-destructive/40 bg-destructive/10",
		icon: "text-destructive",
		Icon: IconAlertTriangle,
	},
};

function Callout({
	tone = "info",
	title,
	children,
	action,
}: {
	tone?: CalloutTone;
	title?: ReactNode;
	children?: ReactNode;
	action?: ReactNode;
}) {
	const { box, icon, Icon } = CALLOUT_TONE[tone];
	return (
		<div role="note" className={cn("flex gap-3 rounded-lg border p-4 text-sm", box)}>
			<Icon className={cn("mt-0.5 size-4 shrink-0", icon)} aria-hidden="true" />
			<div className="min-w-0 flex-1 space-y-1">
				{title ? <p className="font-medium text-pretty">{title}</p> : null}
				{children ? (
					<div className="text-pretty text-muted-foreground leading-relaxed">{children}</div>
				) : null}
				{action ? <div className="pt-2">{action}</div> : null}
			</div>
		</div>
	);
}

/** Shown in place of a step's form until the step it depends on is done. */
function Prerequisite({
	controller,
	step,
	children,
}: {
	controller: IdentitySetupController;
	step: EnterpriseIdentitySetupStep;
	children: ReactNode;
}) {
	const { goTo, t } = controller;
	return (
		<Callout
			title={t("settings.enterprise.identity.wizard.prerequisite.title", "One step to go first")}
			action={
				<Button type="button" size="sm" onClick={() => goTo(step)}>
					{t("settings.enterprise.identity.wizard.prerequisite.action", "Go to {step}", {
						step: getStepCopy(step, controller).navLabel,
					})}
					<IconArrowRight aria-hidden="true" />
				</Button>
			}
		>
			{children}
		</Callout>
	);
}

function FieldHelp({ id, children }: { id: string; children: ReactNode }) {
	return (
		<p id={id} className="text-pretty text-muted-foreground text-sm leading-relaxed">
			{children}
		</p>
	);
}

function FieldError({ id, message }: { id?: string; message: unknown }) {
	if (!message) return null;
	return (
		<p id={id} role="alert" className="text-destructive text-sm">
			{String(message)}
		</p>
	);
}

/** A labelled value an administrator copies into another system. */
function CopyValue({
	label,
	value,
	copyLabel,
}: {
	label: string;
	value: string;
	copyLabel?: string;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0 space-y-0.5">
				<p className="text-muted-foreground text-xs">{label}</p>
				<code translate="no" className="block break-all font-mono text-sm">
					{value}
				</code>
			</div>
			{copyLabel ? (
				<div className="shrink-0">
					<CopySetupButton value={value} label={copyLabel} />
				</div>
			) : null}
		</div>
	);
}

function SectionHeading({ number, children }: { number?: number; children: ReactNode }) {
	return (
		<h4 className="flex items-center gap-2 font-medium text-sm">
			{number ? (
				<span
					aria-hidden="true"
					className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-xs tabular-nums"
				>
					{number}
				</span>
			) : null}
			{children}
		</h4>
	);
}

// ---------------------------------------------------------------------------
// 1. Identity provider
// ---------------------------------------------------------------------------

function ProviderIdentifierFields({ controller }: { controller: IdentitySetupController }) {
	const { providerForm, t } = controller;
	return (
		<div className="grid min-w-0 gap-5 sm:grid-cols-2">
			<providerForm.Field
				name="domain"
				validators={{
					onChange: ({ value }) => {
						const trimmed = value.trim();
						if (!trimmed) {
							return t(
								"settings.enterprise.identity.provider.error.domainRequired",
								"Domain is required",
							);
						}
						return DOMAIN_REGEX.test(trimmed)
							? undefined
							: t(
									"settings.enterprise.identity.wizard.provider.domainInvalid",
									"Enter only the part after the @, for example example.com.",
								);
					},
				}}
			>
				{(field) => {
					const error = field.state.meta.errors[0];
					return (
						<div className="min-w-0 space-y-2">
							<Label htmlFor="identity-domain">
								{t("settings.enterprise.identity.wizard.provider.domainLabel", "Work email domain")}
							</Label>
							<Input
								id="identity-domain"
								name="domain"
								autoComplete="off"
								autoCapitalize="none"
								spellCheck={false}
								inputMode="url"
								placeholder={t(
									"settings.enterprise.identity.provider.placeholder.domain",
									"e.g. example.com…",
								)}
								value={field.state.value}
								aria-invalid={Boolean(error)}
								aria-describedby={`identity-domain-help${error ? " identity-domain-error" : ""}`}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
							<FieldHelp id="identity-domain-help">
								{t(
									"settings.enterprise.identity.wizard.provider.domainHelp",
									"Employees whose email address ends in this domain will sign in through your provider.",
								)}
							</FieldHelp>
							<FieldError id="identity-domain-error" message={error} />
						</div>
					);
				}}
			</providerForm.Field>

			<providerForm.Field
				name="providerId"
				validators={{
					onChange: ({ value }) => {
						const trimmed = value.trim();
						if (!trimmed) {
							return t(
								"settings.enterprise.identity.provider.error.providerIdRequired",
								"Provider ID is required",
							);
						}
						return PROVIDER_ID_REGEX.test(trimmed)
							? undefined
							: t(
									"settings.enterprise.identity.wizard.provider.providerIdInvalid",
									"Use only lowercase letters, numbers and hyphens, without a hyphen at the start or end.",
								);
					},
				}}
			>
				{(field) => {
					const error = field.state.meta.errors[0];
					return (
						<div className="min-w-0 space-y-2">
							<Label htmlFor="identity-provider-id">
								{t("settings.enterprise.identity.provider.label.providerId", "Provider ID")}
							</Label>
							<Input
								id="identity-provider-id"
								name="providerId"
								autoComplete="off"
								autoCapitalize="none"
								spellCheck={false}
								placeholder={t(
									"settings.enterprise.identity.provider.placeholder.providerId",
									"e.g. acme-okta…",
								)}
								value={field.state.value}
								aria-invalid={Boolean(error)}
								aria-describedby={`identity-provider-id-help${error ? " identity-provider-id-error" : ""}`}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
							<FieldHelp id="identity-provider-id-help">
								{t(
									"settings.enterprise.identity.wizard.provider.providerIdHelp",
									"A short name for this connection, used in sign-in links. Lowercase letters, numbers and hyphens, for example acme-okta.",
								)}
							</FieldHelp>
							<FieldError id="identity-provider-id-error" message={error} />
						</div>
					);
				}}
			</providerForm.Field>
		</div>
	);
}

export function ProviderStep({ controller }: { controller: IdentitySetupController }) {
	const { completion, isPending, providerForm, ssoRegistered, t } = controller;
	const ids = useId();

	return (
		<>
			{!completion.provider ? (
				<Callout
					title={t("settings.enterprise.identity.wizard.provider.prepTitle", "Before you begin")}
				>
					<p>
						{t(
							"settings.enterprise.identity.wizard.provider.prepIntro",
							"Setup takes about 15 minutes. Have these ready:",
						)}
					</p>
					<ul className="mt-2 list-disc space-y-1 pl-5">
						<li>
							{t(
								"settings.enterprise.identity.wizard.provider.prepAdmin",
								"Administrator access to your identity provider, such as Okta or Microsoft Entra ID",
							)}
						</li>
						<li>
							{t(
								"settings.enterprise.identity.wizard.provider.prepDns",
								"Access to your domain's DNS settings, to add one TXT record",
							)}
						</li>
						<li>
							{t(
								"settings.enterprise.identity.wizard.provider.prepTester",
								"A colleague's work account, or a test account, to try signing in",
							)}
						</li>
					</ul>
				</Callout>
			) : null}

			{ssoRegistered ? (
				<Callout tone="warning">
					{t(
						"settings.enterprise.identity.wizard.provider.changeWarning",
						"This provider is already connected. Changing the provider ID or email domain means you will need to connect and verify again.",
					)}
				</Callout>
			) : null}

			<form className="min-w-0 space-y-6" action={() => providerForm.handleSubmit()} noValidate>
				<providerForm.Field name="preset">
					{(field) => (
						<fieldset className="min-w-0 space-y-3">
							<legend className="mb-3 font-medium text-sm">
								{t(
									"settings.enterprise.identity.wizard.provider.presetLegend",
									"Which identity provider does your company use?",
								)}
							</legend>
							<RadioGroup
								value={field.state.value}
								onValueChange={(value) => {
									const nextPreset = selectedPreset(value as EnterpriseIdentityProviderPresetId);
									field.handleChange(value as EnterpriseIdentityProviderPresetId);
									providerForm.setFieldValue("protocol", nextPreset.defaultProtocol);
								}}
								className="grid gap-2 sm:grid-cols-2"
							>
								{PROVIDER_OPTIONS.map((option) => {
									const optionId = `${ids}-preset-${option.id}`;
									const selected = field.state.value === option.id;
									return (
										<label
											key={option.id}
											className={cn(
												"flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40",
												selected && "border-primary bg-primary/5 hover:bg-primary/5",
											)}
										>
											<RadioGroupItem
												id={optionId}
												value={option.id}
												aria-labelledby={`${optionId}-name`}
												aria-describedby={`${optionId}-description`}
												className="mt-0.5"
											/>
											<span className="min-w-0 space-y-0.5">
												<span id={`${optionId}-name`} className="block font-medium text-sm">
													{option.name}
												</span>
												<span
													id={`${optionId}-description`}
													className="block text-pretty text-muted-foreground text-xs leading-relaxed"
												>
													{presetDescription(option.id, t)}
												</span>
											</span>
										</label>
									);
								})}
							</RadioGroup>
						</fieldset>
					)}
				</providerForm.Field>

				<providerForm.Subscribe selector={(state) => state.values.preset}>
					{(presetValue) => {
						const formPreset = selectedPreset(presetValue as EnterpriseIdentityProviderPresetId);
						return (
							<providerForm.Field name="protocol">
								{(field) =>
									formPreset.supportedProtocols.length > 1 ? (
										<fieldset className="min-w-0 space-y-3">
											<legend className="mb-3 font-medium text-sm">
												{t(
													"settings.enterprise.identity.wizard.provider.protocolLegend",
													"How should Z8 connect?",
												)}
											</legend>
											<RadioGroup
												value={field.state.value}
												onValueChange={(value) =>
													field.handleChange(value as EnterpriseIdentityProtocol)
												}
												className="grid gap-2 sm:grid-cols-2"
											>
												{formPreset.supportedProtocols.map((option) => {
													const optionId = `${ids}-protocol-${option}`;
													const selected = field.state.value === option;
													return (
														<label
															key={option}
															className={cn(
																"flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40",
																selected && "border-primary bg-primary/5 hover:bg-primary/5",
															)}
														>
															<RadioGroupItem
																id={optionId}
																value={option}
																aria-labelledby={`${optionId}-name`}
																aria-describedby={`${optionId}-description`}
																className="mt-0.5"
															/>
															<span className="min-w-0 space-y-0.5">
																<span id={`${optionId}-name`} className="block font-medium text-sm">
																	{option === "oidc"
																		? t(
																				"settings.enterprise.identity.wizard.provider.oidc",
																				"OpenID Connect (recommended)",
																			)
																		: t(
																				"settings.enterprise.identity.wizard.provider.saml",
																				"SAML 2.0",
																			)}
																</span>
																<span
																	id={`${optionId}-description`}
																	className="block text-pretty text-muted-foreground text-xs leading-relaxed"
																>
																	{option === "oidc"
																		? t(
																				"settings.enterprise.identity.wizard.provider.oidcHelp",
																				"Quicker to set up and supported by most providers. Choose this if you're not sure.",
																			)
																		: t(
																				"settings.enterprise.identity.wizard.provider.samlHelp",
																				"Use this if your IT team requires SAML. You'll paste an XML metadata file.",
																			)}
																</span>
															</span>
														</label>
													);
												})}
											</RadioGroup>
										</fieldset>
									) : (
										<p className="text-muted-foreground text-sm">
											{t(
												"settings.enterprise.identity.wizard.provider.singleProtocol",
												"{provider} connects with OpenID Connect (OIDC).",
												{ provider: formPreset.name },
											)}
										</p>
									)
								}
							</providerForm.Field>
						);
					}}
				</providerForm.Subscribe>

				<ProviderIdentifierFields controller={controller} />

				<Button type="submit" disabled={isPending}>
					{t("settings.enterprise.identity.wizard.provider.save", "Save and continue")}
				</Button>
			</form>
		</>
	);
}

// ---------------------------------------------------------------------------
// 2. Connect
// ---------------------------------------------------------------------------

function requiredValidator(message: string) {
	return ({ value }: { value: string }) => (value.trim() ? undefined : message);
}

function SsoConnectionForm({ controller }: { controller: IdentitySetupController }) {
	const { isPending, presetId, protocol, providerId, ssoForm, t } = controller;
	const provider = providerName(controller);
	return (
		<section className="min-w-0 space-y-4 border-t pt-6">
			<SectionHeading>
				{t("settings.enterprise.identity.wizard.sso.partTwo", "Paste the details from {provider}", {
					provider,
				})}
			</SectionHeading>
			<form className="min-w-0 space-y-5" action={() => ssoForm.handleSubmit()} noValidate>
				{presetId === "microsoft-entra" && protocol === "oidc" ? (
					<ssoForm.Field
						name="tenantId"
						validators={{
							onChange: ({ value }) =>
								!value || getEntraIssuer(value)
									? undefined
									: t(
											"settings.enterprise.sso.guide.entra.tenantInvalid",
											"Enter the Directory (tenant) ID as a complete UUID.",
										),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="wizard-entra-tenant">
									{t("settings.enterprise.sso.guide.entra.tenantId", "Directory (tenant) ID")}
								</Label>
								<Input
									id="wizard-entra-tenant"
									name={field.name}
									autoComplete="off"
									spellCheck={false}
									value={field.state.value}
									onBlur={field.handleBlur}
									aria-invalid={field.state.meta.errors.length > 0}
									aria-describedby="wizard-entra-tenant-help"
									onChange={(event) => {
										field.handleChange(event.target.value);
										ssoForm.setFieldValue("issuer", getEntraIssuer(event.target.value) ?? "");
									}}
								/>
								<FieldHelp id="wizard-entra-tenant-help">
									{t(
										"settings.enterprise.sso.guide.entra.tenantHelp",
										"App registrations → your app → Overview. Use your tenant ID, not common or organizations.",
									)}
								</FieldHelp>
								<FieldError message={field.state.meta.errors.join(" ")} />
							</div>
						)}
					</ssoForm.Field>
				) : null}

				<ssoForm.Field
					name="issuer"
					validators={{
						onChange: requiredValidator(
							t(
								"settings.enterprise.identity.wizard.sso.issuerRequired",
								"Enter the issuer URL from your provider.",
							),
						),
					}}
				>
					{(field) => {
						const error = field.state.meta.errors[0];
						return (
							<div className="space-y-2">
								<Label htmlFor="sso-issuer">
									{t("settings.enterprise.identity.sso.label.issuer", "Issuer")}
								</Label>
								<Input
									id="sso-issuer"
									name="issuer"
									type="url"
									autoComplete="off"
									spellCheck={false}
									placeholder={presetIssuerPlaceholder(presetId, t)}
									value={field.state.value}
									aria-invalid={Boolean(error)}
									aria-describedby="sso-issuer-help"
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								<FieldHelp id="sso-issuer-help">
									{t(
										"settings.enterprise.identity.wizard.sso.issuerHelp",
										"The web address that identifies your provider. It's listed in the app's settings and starts with https://.",
									)}
								</FieldHelp>
								<FieldError message={error} />
							</div>
						);
					}}
				</ssoForm.Field>

				{protocol === "oidc" ? (
					<div className="grid min-w-0 gap-5 sm:grid-cols-2">
						<ssoForm.Field
							name="clientId"
							validators={{
								onChange: requiredValidator(
									t(
										"settings.enterprise.identity.wizard.sso.clientIdRequired",
										"Enter the client ID.",
									),
								),
							}}
						>
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
										aria-invalid={field.state.meta.errors.length > 0}
										aria-describedby="oidc-client-id-help"
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
									<FieldHelp id="oidc-client-id-help">
										{t(
											"settings.enterprise.identity.wizard.sso.clientIdHelp",
											"Also called application ID.",
										)}
									</FieldHelp>
									<FieldError message={field.state.meta.errors[0]} />
								</div>
							)}
						</ssoForm.Field>
						<ssoForm.Field
							name="clientSecret"
							validators={{
								onChange: requiredValidator(
									t(
										"settings.enterprise.identity.wizard.sso.clientSecretRequired",
										"Enter the client secret.",
									),
								),
							}}
						>
							{(field) => (
								<div className="min-w-0 space-y-2">
									<Label htmlFor="oidc-client-secret">
										{t("settings.enterprise.identity.sso.label.clientSecret", "Client secret")}
									</Label>
									<Input
										id="oidc-client-secret"
										name="clientSecret"
										type="password"
										autoComplete="off"
										spellCheck={false}
										value={field.state.value}
										aria-invalid={field.state.meta.errors.length > 0}
										aria-describedby="oidc-client-secret-help"
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
									<FieldHelp id="oidc-client-secret-help">
										{t(
											"settings.enterprise.identity.wizard.sso.clientSecretHelp",
											"Stored securely and never shown again.",
										)}
									</FieldHelp>
									<FieldError message={field.state.meta.errors[0]} />
								</div>
							)}
						</ssoForm.Field>
					</div>
				) : (
					<ssoForm.Field
						name="metadata"
						validators={{
							onChange: requiredValidator(
								t(
									"settings.enterprise.identity.wizard.sso.metadataRequired",
									"Paste the metadata XML from your provider.",
								),
							),
						}}
					>
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
									className="min-h-32 font-mono text-xs"
									placeholder={t(
										"settings.enterprise.identity.sso.placeholder.metadata",
										"Paste IdP metadata XML…",
									)}
									value={field.state.value}
									aria-invalid={field.state.meta.errors.length > 0}
									onBlur={field.handleBlur}
									onChange={(event) => field.handleChange(event.target.value)}
								/>
								<FieldError message={field.state.meta.errors[0]} />
							</div>
						)}
					</ssoForm.Field>
				)}

				<Button type="submit" disabled={isPending || !providerId}>
					{t("settings.enterprise.identity.wizard.sso.save", "Connect provider")}
				</Button>
			</form>
		</section>
	);
}

export function SsoStep({ controller }: { controller: IdentitySetupController }) {
	const { callbackBaseUrl, completion, domain, presetId, protocol, providerId, ssoRegistered, t } =
		controller;
	const browserOrigin = useSyncExternalStore(
		subscribeBrowserOrigin,
		getBrowserOriginSnapshot,
		getServerBrowserOriginSnapshot,
	);
	const provider = providerName(controller);

	if (!completion.provider) {
		return (
			<Prerequisite controller={controller} step="provider">
				{t(
					"settings.enterprise.identity.wizard.sso.needsProvider",
					"Choose your identity provider and email domain first, so Z8 can prepare the connection details.",
				)}
			</Prerequisite>
		);
	}

	if (ssoRegistered) {
		return (
			<Callout
				tone="success"
				title={t("settings.enterprise.identity.wizard.sso.connected", "Connected as {providerId}", {
					providerId,
				})}
				action={
					<Button type="button" size="sm" onClick={() => controller.goTo("domain")}>
						{t(
							"settings.enterprise.identity.wizard.sso.continue",
							"Continue to domain verification",
						)}
						<IconArrowRight aria-hidden="true" />
					</Button>
				}
			>
				<p>
					{t(
						"settings.enterprise.identity.wizard.sso.connectedHelp",
						"To change the connection details, remove this provider under SSO Providers and connect it again here.",
					)}{" "}
					<Link
						href={SSO_PROVIDERS_TAB}
						className="text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
					>
						{t("settings.enterprise.identity.wizard.sso.manageLink", "Open SSO Providers")}
					</Link>
				</p>
			</Callout>
		);
	}

	const samlAcsPath = `/api/auth/sso/saml2/sp/acs/${encodeURIComponent(providerId)}`;
	const samlAcsUrl = browserOrigin ? `${browserOrigin}${samlAcsPath}` : samlAcsPath;

	return (
		<>
			<section className="min-w-0 space-y-3">
				<SectionHeading>
					{t(
						"settings.enterprise.identity.wizard.sso.partOne",
						"Create an app for Z8 in {provider}",
						{
							provider,
						},
					)}
				</SectionHeading>
				{protocol === "oidc" ? (
					<SsoProviderGuide
						kind={presetId === "microsoft-entra" ? "microsoft-entra" : "generic"}
						callbackUrl={getOidcCallbackUrl(callbackBaseUrl)}
						domain={domain}
						showNextSteps={false}
					/>
				) : (
					<div className="space-y-3">
						<p className="text-pretty text-muted-foreground text-sm leading-relaxed">
							{t(
								"settings.enterprise.identity.wizard.sso.samlIntro",
								"Create a SAML app in {provider} and enter this address as its assertion consumer service (ACS) or reply URL. Then download the app's metadata XML.",
								{ provider },
							)}
						</p>
						<CopyValue
							label={t("settings.enterprise.identity.wizard.sso.acsLabel", "ACS URL")}
							value={samlAcsUrl}
							copyLabel={t("settings.enterprise.identity.wizard.sso.copyAcs", "Copy ACS URL")}
						/>
					</div>
				)}
			</section>

			<SsoConnectionForm controller={controller} />
		</>
	);
}

// ---------------------------------------------------------------------------
// 3. Verify domain
// ---------------------------------------------------------------------------

export function DomainStep({ controller }: { controller: IdentitySetupController }) {
	const { dnsToken, domain, generateDnsRecord, isPending, providerId, setup, ssoRegistered, t } =
		controller;
	const verified = Boolean(setup.domain?.verified);

	if (!ssoRegistered && !verified) {
		return (
			<Prerequisite controller={controller} step="sso">
				{t(
					"settings.enterprise.identity.wizard.domain.needsConnection",
					"Connect your identity provider first. Z8 creates the DNS record for that connection.",
				)}
			</Prerequisite>
		);
	}

	const host = dnsRecordHost(providerId);

	return (
		<>
			<div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-4">
				<div className="min-w-0">
					<p className="text-muted-foreground text-xs">
						{t("settings.enterprise.identity.domain.selected", "Selected domain")}
					</p>
					<p className="break-all font-medium">{domain}</p>
				</div>
				{verified ? (
					<Badge variant="success">
						<IconCheck aria-hidden="true" />
						{t("settings.enterprise.identity.domain.status.verified", "Verified")}
					</Badge>
				) : (
					<Badge variant="outline">
						{t("settings.enterprise.identity.wizard.domain.notVerified", "Not verified yet")}
					</Badge>
				)}
			</div>

			{verified ? (
				<Callout
					tone="success"
					action={
						<Button type="button" size="sm" onClick={() => controller.goTo("ssoTest")}>
							{t("settings.enterprise.identity.wizard.domain.continue", "Continue to test sign-in")}
							<IconArrowRight aria-hidden="true" />
						</Button>
					}
				>
					{t(
						"settings.enterprise.identity.wizard.domain.verifiedHelp",
						"Z8 found your DNS record. You can leave it in place.",
					)}
				</Callout>
			) : (
				<ol className="min-w-0 space-y-6">
					<li className="min-w-0 space-y-3">
						<SectionHeading number={1}>
							{t("settings.enterprise.identity.wizard.domain.stepCreate", "Create the DNS record")}
						</SectionHeading>
						{dnsToken ? (
							<div className="space-y-2">
								<div className="grid min-w-0 gap-2">
									<CopyValue
										label={t("settings.enterprise.identity.wizard.domain.recordType", "Type")}
										value="TXT"
									/>
									<CopyValue
										label={t(
											"settings.enterprise.identity.wizard.domain.recordName",
											"Name (also called host)",
										)}
										value={host}
										copyLabel={t(
											"settings.enterprise.identity.wizard.domain.copyName",
											"Copy name",
										)}
									/>
									<CopyValue
										label={t(
											"settings.enterprise.identity.wizard.domain.recordValue",
											"Value (also called content)",
										)}
										value={dnsToken}
										copyLabel={t(
											"settings.enterprise.identity.wizard.domain.copyValue",
											"Copy value",
										)}
									/>
								</div>
								<p className="text-pretty text-muted-foreground text-xs leading-relaxed">
									{t(
										"settings.enterprise.identity.wizard.domain.fullNameHint",
										"If your DNS provider asks for the full name, use {fullName}.",
										{ fullName: `${host}.${domain}` },
									)}
								</p>
							</div>
						) : (
							<div className="space-y-3">
								<p className="text-pretty text-muted-foreground text-sm leading-relaxed">
									{t(
										"settings.enterprise.identity.wizard.domain.createHelp",
										"Z8 generates a unique value for you to publish. If you already created one under SSO Providers, you can skip to the last step.",
									)}
								</p>
								<Button
									type="button"
									variant="outline"
									onClick={generateDnsRecord}
									disabled={isPending}
								>
									{t("settings.enterprise.identity.wizard.domain.create", "Create DNS record")}
								</Button>
							</div>
						)}
					</li>
					<li className="min-w-0 space-y-2">
						<SectionHeading number={2}>
							{t(
								"settings.enterprise.identity.wizard.domain.stepPublish",
								"Add it where your domain is managed",
							)}
						</SectionHeading>
						<p className="text-pretty text-muted-foreground text-sm leading-relaxed">
							{t(
								"settings.enterprise.identity.wizard.domain.publishHelp",
								"Sign in to your DNS provider, such as Cloudflare, GoDaddy or IONOS, and add a new TXT record exactly as shown. If someone else manages your domain, send them these values.",
							)}
						</p>
					</li>
					<li className="min-w-0 space-y-3">
						<SectionHeading number={3}>
							{t(
								"settings.enterprise.identity.wizard.domain.stepVerify",
								"Let Z8 check the record",
							)}
						</SectionHeading>
						<p className="text-pretty text-muted-foreground text-sm leading-relaxed">
							{t(
								"settings.enterprise.identity.wizard.domain.verifyHelp",
								"New records usually appear within a few minutes, but can take up to 48 hours. You can leave this page and check again later.",
							)}
						</p>
						<Button type="button" onClick={controller.verifyDomain} disabled={isPending}>
							{t("settings.enterprise.identity.wizard.domain.verify", "Verify domain")}
						</Button>
					</li>
				</ol>
			)}
		</>
	);
}

// ---------------------------------------------------------------------------
// 4. Test sign-in
// ---------------------------------------------------------------------------

export function SsoTestStep({ controller }: { controller: IdentitySetupController }) {
	const {
		completion,
		domain,
		isPending,
		recordSsoTest,
		setTestEmail,
		setTestError,
		setup,
		ssoRegistered,
		t,
		testEmail,
		testError,
	} = controller;
	const provider = providerName(controller);

	if (!ssoRegistered) {
		return (
			<Prerequisite controller={controller} step="sso">
				{t(
					"settings.enterprise.identity.wizard.ssoTest.needsConnection",
					"Connect your identity provider before testing sign-in.",
				)}
			</Prerequisite>
		);
	}

	const lastTest = setup.ssoTest;

	return (
		<>
			{!completion.domain ? (
				<Callout
					tone="warning"
					action={
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => controller.goTo("domain")}
						>
							{t("settings.enterprise.identity.wizard.ssoTest.goToDomain", "Verify domain")}
						</Button>
					}
				>
					{t(
						"settings.enterprise.identity.wizard.ssoTest.domainFirst",
						"{domain} isn't verified yet. Sign-in through your provider may not work until it is.",
						{ domain: domainName(controller) },
					)}
				</Callout>
			) : null}

			{lastTest.status === "passed" && completion.ssoTest ? (
				<Callout
					tone="success"
					title={t(
						"settings.enterprise.identity.wizard.ssoTest.passed",
						"Sign-in worked for {email}",
						{ email: lastTest.testEmail ?? "" },
					)}
				/>
			) : lastTest.status === "failed" ? (
				<Callout
					tone="danger"
					title={t("settings.enterprise.identity.wizard.ssoTest.failed", "The last test failed")}
				>
					{lastTest.error ? <p className="break-words">{lastTest.error}</p> : null}
					<p className="mt-1">
						{t(
							"settings.enterprise.identity.wizard.ssoTest.failedHelp",
							"Common causes: the callback URL doesn't match exactly, the client secret is wrong or expired, or the test user isn't assigned to the app in {provider}.",
							{ provider },
						)}
					</p>
				</Callout>
			) : null}

			<section className="min-w-0 space-y-3">
				<SectionHeading>
					{t("settings.enterprise.identity.wizard.ssoTest.howTitle", "How to test")}
				</SectionHeading>
				<ol className="list-decimal space-y-2 pl-5 text-pretty text-muted-foreground text-sm leading-relaxed marker:font-medium marker:text-foreground">
					<li>
						{t(
							"settings.enterprise.identity.wizard.ssoTest.howPrivate",
							"Open a private or incognito browser window. Keep this window open, so you stay signed in as administrator if something goes wrong.",
						)}
					</li>
					<li>
						{t(
							"settings.enterprise.identity.wizard.ssoTest.howSignIn",
							"Go to the Z8 sign-in page and sign in with a work email address ending in @{domain}.",
							{ domain: domain || "…" },
						)}
					</li>
					<li>
						{t(
							"settings.enterprise.identity.wizard.ssoTest.howRecord",
							"Come back here and record whether it worked.",
						)}
					</li>
				</ol>
			</section>

			<section className="min-w-0 space-y-4 border-t pt-6">
				<SectionHeading>
					{t("settings.enterprise.identity.wizard.ssoTest.recordTitle", "Record the result")}
				</SectionHeading>
				<div className="space-y-2">
					<Label htmlFor="sso-test-email">
						{t("settings.enterprise.identity.wizard.ssoTest.emailLabel", "Email used for the test")}
					</Label>
					<Input
						id="sso-test-email"
						name="testEmail"
						type="email"
						autoComplete="off"
						spellCheck={false}
						value={testEmail}
						aria-describedby="sso-test-email-help"
						onChange={(event) => setTestEmail(event.target.value)}
					/>
					<FieldHelp id="sso-test-email-help">
						{t(
							"settings.enterprise.identity.wizard.ssoTest.emailHelp",
							"Ideally a colleague's account rather than your own administrator account.",
						)}
					</FieldHelp>
				</div>
				<div className="space-y-2">
					<Label htmlFor="sso-test-error">
						{t(
							"settings.enterprise.identity.wizard.ssoTest.noteLabel",
							"What went wrong? (only if it failed)",
						)}
					</Label>
					<Textarea
						id="sso-test-error"
						name="testError"
						autoComplete="off"
						className="min-h-20"
						placeholder={t(
							"settings.enterprise.identity.wizard.ssoTest.notePlaceholder",
							"For example, the error message you saw…",
						)}
						value={testError}
						onChange={(event) => setTestError(event.target.value)}
					/>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						disabled={isPending || !testEmail.trim()}
						onClick={() => recordSsoTest("passed")}
					>
						<IconCheck aria-hidden="true" />
						{t("settings.enterprise.identity.wizard.ssoTest.recordPass", "Sign-in worked")}
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={isPending || !testEmail.trim()}
						onClick={() => recordSsoTest("failed")}
					>
						<IconX aria-hidden="true" />
						{t("settings.enterprise.identity.wizard.ssoTest.recordFail", "Sign-in failed")}
					</Button>
				</div>
				<p className="text-pretty text-muted-foreground text-xs leading-relaxed">
					{t(
						"settings.enterprise.identity.wizard.ssoTest.selfReported",
						"Z8 can't observe this test, so the result is saved as you report it. Saving the provider and verifying DNS don't prove that sign-in works.",
					)}
				</p>
			</section>
		</>
	);
}

// ---------------------------------------------------------------------------
// 5. Sync users (SCIM)
// ---------------------------------------------------------------------------

function RoleTemplateSelect({
	controller,
	id,
	describedBy,
}: {
	controller: IdentitySetupController;
	id: string;
	describedBy?: string;
}) {
	const { defaultRoleTemplateId, initialSetup, setDefaultRoleTemplateId, t } = controller;
	return (
		<Select value={defaultRoleTemplateId} onValueChange={setDefaultRoleTemplateId}>
			<SelectTrigger id={id} aria-describedby={describedBy} className="w-full min-w-0 sm:max-w-sm">
				<SelectValue
					placeholder={t(
						"settings.enterprise.identity.accessPolicy.placeholder.roleTemplate",
						"Select role template",
					)}
				/>
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="none">
					{t("settings.enterprise.identity.accessPolicy.noDefaultTemplate", "No default template")}
				</SelectItem>
				{initialSetup.roleTemplates.map((template) => (
					<SelectItem key={template.id} value={template.id}>
						{template.name}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function ScimStep({ controller }: { controller: IdentitySetupController }) {
	const { defaultRoleTemplateId, initialSetup, setup, t } = controller;
	const connected = Boolean(setup.scim.connection);

	return (
		<>
			<Callout>
				{t(
					"settings.enterprise.identity.wizard.scim.skipHelp",
					"Skip this step if your provider doesn't support SCIM or you prefer to add people to Z8 yourself. Employees can still sign in with enterprise sign-in.",
				)}
			</Callout>
			{!connected ? (
				<div className="space-y-2">
					<Label htmlFor="scim-default-role-template">
						{t(
							"settings.enterprise.identity.wizard.scim.roleLabel",
							"Role for people created by your provider",
						)}
					</Label>
					<RoleTemplateSelect
						controller={controller}
						id="scim-default-role-template"
						describedBy="scim-default-role-template-help"
					/>
					<FieldHelp id="scim-default-role-template-help">
						{t(
							"settings.enterprise.identity.wizard.scim.roleHelp",
							"Choose a role template before creating the connection. New accounts start with this role.",
						)}
					</FieldHelp>
				</div>
			) : null}
			<ManagedScimStep
				setup={setup}
				defaultRoleTemplateId={defaultRoleTemplateId === "none" ? null : defaultRoleTemplateId}
				endpoint={initialSetup.scimEndpoint}
			/>
		</>
	);
}

// ---------------------------------------------------------------------------
// 6. Access rules
// ---------------------------------------------------------------------------

function PolicyOption({
	id,
	checked,
	onCheckedChange,
	label,
	help,
	extra,
}: {
	id: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	label: string;
	help: string;
	extra?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"flex items-start gap-3 rounded-lg border p-4 text-sm transition-colors",
				checked && "border-primary/50 bg-primary/5",
			)}
		>
			<Checkbox
				id={id}
				aria-labelledby={`${id}-label`}
				aria-describedby={`${id}-help`}
				checked={checked}
				onCheckedChange={(value) => onCheckedChange(value === true)}
				className="mt-0.5"
			/>
			<div className="min-w-0 space-y-1">
				<Label htmlFor={id} className="cursor-pointer">
					<span id={`${id}-label`} className="font-medium">
						{label}
					</span>
				</Label>
				<p id={`${id}-help`} className="text-pretty text-muted-foreground leading-relaxed">
					{help}
				</p>
				{extra}
			</div>
		</div>
	);
}

export function AccessPolicyStep({ controller }: { controller: IdentitySetupController }) {
	const { isPending, saveAccessPolicy, setup, t, updateEnforcement } = controller;
	const provider = providerName(controller);
	const domain = domainName(controller);

	return (
		<>
			<fieldset className="min-w-0 space-y-3">
				<legend className="mb-3 font-medium text-sm">
					{t(
						"settings.enterprise.identity.wizard.accessPolicy.legend",
						"Turn on the rules you need. All are optional.",
					)}
				</legend>
				<PolicyOption
					id="identity-access-policy-require-sso"
					checked={setup.enforcement.ssoRequired}
					onCheckedChange={(checked) => updateEnforcement("ssoRequired", checked)}
					label={t("settings.enterprise.identity.accessPolicy.requireSso", "Require SSO")}
					help={t(
						"settings.enterprise.identity.wizard.accessPolicy.requireSsoHelp",
						"People with an @{domain} email must sign in through {provider} instead of using a password.",
						{ domain, provider },
					)}
					extra={
						<p className="text-pretty text-muted-foreground text-xs leading-relaxed">
							{t(
								"settings.enterprise.identity.wizard.accessPolicy.requireSsoDomains",
								"This also needs {domain} added and verified under Domains.",
								{ domain },
							)}{" "}
							<Link
								href={DOMAINS_PAGE}
								className="text-primary underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
							>
								{t("settings.enterprise.identity.wizard.accessPolicy.domainsLink", "Open Domains")}
							</Link>
						</p>
					}
				/>
				<PolicyOption
					id="identity-access-policy-restrict-domain"
					checked={setup.enforcement.domainRestrictionEnabled}
					onCheckedChange={(checked) => updateEnforcement("domainRestrictionEnabled", checked)}
					label={t(
						"settings.enterprise.identity.accessPolicy.restrictDomain",
						"Restrict to verified domain",
					)}
					help={t(
						"settings.enterprise.identity.wizard.accessPolicy.restrictDomainHelp",
						"Invite codes can only be redeemed by people with an @{domain} email address.",
						{ domain },
					)}
				/>
				<PolicyOption
					id="identity-access-policy-restrict-invites"
					checked={setup.enforcement.inviteRestrictionEnabled}
					onCheckedChange={(checked) => updateEnforcement("inviteRestrictionEnabled", checked)}
					label={t("settings.enterprise.identity.accessPolicy.restrictInvites", "Restrict invites")}
					help={t(
						"settings.enterprise.identity.wizard.accessPolicy.restrictInvitesHelp",
						"Invitations can only be sent to @{domain} email addresses.",
						{ domain },
					)}
				/>
			</fieldset>

			<Button type="button" onClick={saveAccessPolicy} disabled={isPending}>
				{t("settings.enterprise.identity.wizard.accessPolicy.save", "Save and continue")}
			</Button>
		</>
	);
}

// ---------------------------------------------------------------------------
// 7. Review & activate
// ---------------------------------------------------------------------------

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="grid min-w-0 gap-1 py-2.5 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className="min-w-0 break-words text-sm">{children}</dd>
		</div>
	);
}

function ReviewChecklist({ controller }: { controller: IdentitySetupController }) {
	const { completion, goTo, t } = controller;
	const checklist = WIZARD_STEPS.filter((step) => step.id !== "review");
	return (
		<section className="min-w-0 space-y-2">
			<SectionHeading>
				{t("settings.enterprise.identity.wizard.review.checklist", "Checklist")}
			</SectionHeading>
			<ul className="divide-y rounded-lg border">
				{checklist.map((step) => {
					const done = completion[step.id];
					const copy = getStepCopy(step.id, controller);
					return (
						<li key={step.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3">
							{done ? (
								<IconCircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
							) : (
								<IconCircleDashed
									className="size-5 shrink-0 text-muted-foreground"
									aria-hidden="true"
								/>
							)}
							<span className="min-w-0 flex-1 text-sm">
								<span className="font-medium">{copy.navLabel}</span>
								<span className="text-muted-foreground">
									{" · "}
									{done
										? t("settings.enterprise.identity.wizard.status.done", "Done")
										: step.optional
											? t("settings.enterprise.identity.wizard.status.optional", "Optional")
											: t("settings.enterprise.identity.wizard.status.toDo", "To do")}
								</span>
							</span>
							{!done ? (
								<Button type="button" size="sm" variant="ghost" onClick={() => goTo(step.id)}>
									{t("settings.enterprise.identity.wizard.review.open", "Open step")}
									<span className="sr-only">: {copy.navLabel}</span>
								</Button>
							) : null}
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function ReviewSettingsSummary({ controller }: { controller: IdentitySetupController }) {
	const { protocol, providerId, setup, t } = controller;
	const enabledRules = [
		setup.enforcement.ssoRequired
			? t("settings.enterprise.identity.accessPolicy.requireSso", "Require SSO")
			: null,
		setup.enforcement.domainRestrictionEnabled
			? t("settings.enterprise.identity.accessPolicy.restrictDomain", "Restrict to verified domain")
			: null,
		setup.enforcement.inviteRestrictionEnabled
			? t("settings.enterprise.identity.accessPolicy.restrictInvites", "Restrict invites")
			: null,
	].filter((rule): rule is string => rule !== null);
	const notSet = t("settings.enterprise.identity.wizard.review.notSet", "Not set");
	return (
		<section className="min-w-0 space-y-1">
			<SectionHeading>
				{t("settings.enterprise.identity.wizard.review.summary", "Your settings")}
			</SectionHeading>
			<dl className="divide-y">
				<SummaryRow
					label={t("settings.enterprise.identity.wizard.review.provider", "Identity provider")}
				>
					{setup.provider ? `${controller.preset.name} · ${protocol.toUpperCase()}` : notSet}
				</SummaryRow>
				<SummaryRow
					label={t("settings.enterprise.identity.provider.label.providerId", "Provider ID")}
				>
					{providerId ? <code translate="no">{providerId}</code> : notSet}
				</SummaryRow>
				<SummaryRow
					label={t("settings.enterprise.identity.wizard.provider.domainLabel", "Work email domain")}
				>
					{setup.domain
						? `${setup.domain.domain} · ${
								setup.domain.verified
									? t("settings.enterprise.identity.domain.status.verified", "Verified")
									: t("settings.enterprise.identity.wizard.domain.notVerified", "Not verified yet")
							}`
						: notSet}
				</SummaryRow>
				<SummaryRow label={t("settings.enterprise.identity.wizard.review.test", "Sign-in test")}>
					{setup.ssoTest.status === "passed"
						? t(
								"settings.enterprise.identity.wizard.ssoTest.passed",
								"Sign-in worked for {email}",
								{
									email: setup.ssoTest.testEmail ?? "",
								},
							)
						: setup.ssoTest.status === "failed"
							? t("settings.enterprise.identity.wizard.ssoTest.failed", "The last test failed")
							: t("settings.enterprise.identity.ssoTest.status.notRun", "Not run")}
				</SummaryRow>
				<SummaryRow label={t("settings.enterprise.identity.wizard.review.rules", "Access rules")}>
					{enabledRules.length
						? enabledRules.join(", ")
						: t("settings.enterprise.identity.wizard.review.noRules", "No rules turned on")}
				</SummaryRow>
				<SummaryRow
					label={t("settings.enterprise.identity.wizard.review.scim", "User sync (SCIM)")}
				>
					{setup.scim.connection
						? t("settings.enterprise.identity.wizard.review.scimOn", "Connected")
						: t("settings.enterprise.identity.wizard.review.scimOff", "Not set up")}
				</SummaryRow>
			</dl>
		</section>
	);
}

export function ReviewStep({ controller }: { controller: IdentitySetupController }) {
	const { activateSetup, isPending, readiness, setup, t } = controller;
	const activated = Boolean(setup.activatedAt);

	return (
		<>
			<ReviewChecklist controller={controller} />

			<ReviewSettingsSummary controller={controller} />

			<Callout
				tone="warning"
				title={t(
					"settings.enterprise.identity.review.lockoutWarning",
					"Current-admin lockout warning",
				)}
			>
				{t(
					"settings.enterprise.identity.review.lockoutWarningHelp",
					"Confirm your current admin account can sign in through the configured provider before activation. Enforcement may block password fallback for the selected domain.",
				)}
			</Callout>

			<div className="space-y-2">
				<Button
					type="button"
					onClick={activateSetup}
					disabled={!readiness.canActivate || isPending}
				>
					{t("settings.enterprise.identity.review.action.activate", "Activate enterprise identity")}
				</Button>
				<p className="text-pretty text-muted-foreground text-sm">
					{activated
						? t(
								"settings.enterprise.identity.wizard.review.reapply",
								"Already active. Activate again after changing access rules to apply them.",
							)
						: readiness.canActivate
							? t(
									"settings.enterprise.identity.wizard.review.ready",
									"Everything required is done. You can activate now.",
								)
							: t(
									"settings.enterprise.identity.wizard.review.blocked",
									"Finish the steps marked “To do” to activate. Connecting, verifying the domain and a successful sign-in test are required.",
								)}
				</p>
			</div>
		</>
	);
}
