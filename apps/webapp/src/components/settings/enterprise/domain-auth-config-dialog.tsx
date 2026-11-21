"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { SsoButtonIcon } from "@/components/login/sso-button-icon";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AuthConfig } from "@/lib/domain";
import {
	SSO_BUTTON_ICONS,
	SSO_BUTTON_LABEL_MAX_LENGTH,
	type SsoButtonIconName,
} from "@/lib/domain/sso-button";

interface Domain {
	id: string;
	domain: string;
	authConfig: AuthConfig;
}

interface DomainAuthConfigDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	domain: Domain | null;
	organizationId: string;
	/** The canonical platform domain stores sign-in methods only; Turnstile and cookie consent are global there. */
	variant?: "customDomain" | "platform";
	/** The organization has a verified SSO provider to sign in with. */
	ssoProviderAvailable: boolean;
	onSave: (domainId: string, config: AuthConfig, turnstileSecretKey?: string) => Promise<void>;
}

const SOCIAL_PROVIDERS = [
	{ id: "google", label: "Google" },
	{ id: "github", label: "GitHub" },
	{ id: "linkedin", label: "LinkedIn" },
	{ id: "apple", label: "Apple" },
];

const getInitialConfig = (domain: Domain | null): AuthConfig => ({
	emailPasswordEnabled: domain?.authConfig.emailPasswordEnabled ?? true,
	socialProvidersEnabled: domain?.authConfig.socialProvidersEnabled ?? [],
	ssoEnabled: domain?.authConfig.ssoEnabled ?? false,
	// Kept so saving does not detach SSO from its provider.
	ssoProviderId: domain?.authConfig.ssoProviderId,
	ssoButtonLabel: domain?.authConfig.ssoButtonLabel,
	ssoButtonIcon: domain?.authConfig.ssoButtonIcon,
	passkeyEnabled: domain?.authConfig.passkeyEnabled ?? true,
	registrationEnabled: domain?.authConfig.registrationEnabled !== false,
	turnstileSiteKey: domain?.authConfig.turnstileSiteKey,
	cookieConsentScript: domain?.authConfig.cookieConsentScript,
});

function useDomainAuthConfigController({
	domain,
	variant = "customDomain",
	ssoProviderAvailable,
	onSave,
}: DomainAuthConfigDialogProps) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: { config: getInitialConfig(domain), turnstileSecretKey: "" },
		onSubmit: async ({ value }) => {
			if (!domain) return;
			try {
				await onSave(
					domain.id,
					{
						...value.config,
						ssoButtonLabel: value.config.ssoButtonLabel?.trim() || undefined,
					},
					value.turnstileSecretKey || undefined,
				);
			} catch {
				// The parent owns save-error presentation.
			}
		},
	});
	const { config, turnstileSecretKey } = useStore(form.store, (state) => state.values);
	const isSaving = useStore(form.store, (state) => state.isSubmitting);
	const setConfig = (update: (previous: AuthConfig) => AuthConfig) =>
		form.setFieldValue("config", update);

	const handleSocialProviderToggle = (providerId: string, checked: boolean) => {
		setConfig((prev) => ({
			...prev,
			socialProvidersEnabled: checked
				? [...prev.socialProvidersEnabled, providerId]
				: prev.socialProvidersEnabled.filter((p) => p !== providerId),
		}));
	};

	return {
		config,
		handleSave: form.handleSubmit,
		handleSocialProviderToggle,
		isSaving,
		setConfig,
		setTurnstileSecretKey: (value: string) => form.setFieldValue("turnstileSecretKey", value),
		ssoProviderAvailable,
		t,
		turnstileSecretKey,
		variant,
	};
}

type DomainAuthConfigController = ReturnType<typeof useDomainAuthConfigController>;

function SsoButtonFields({ controller }: { controller: DomainAuthConfigController }) {
	const { config, setConfig, t } = controller;
	const iconLabels = {
		fingerprint: t("settings.enterprise.domains.ssoIconFingerprint", "Fingerprint"),
		microsoft: "Microsoft",
		google: "Google",
		github: "GitHub",
		apple: "Apple",
		auth0: "Auth0",
		key: t("settings.enterprise.domains.ssoIconKey", "Key"),
		lock: t("settings.enterprise.domains.ssoIconLock", "Lock"),
		shield: t("settings.enterprise.domains.ssoIconShield", "Shield"),
		badge: t("settings.enterprise.domains.ssoIconBadge", "ID badge"),
	} satisfies Record<SsoButtonIconName, string>;
	return (
		<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
			<div className="space-y-1.5">
				<Label htmlFor="sso-button-label">
					{t("settings.enterprise.domains.ssoButtonLabel", "SSO button label (optional)")}
				</Label>
				<Input
					id="sso-button-label"
					value={config.ssoButtonLabel ?? ""}
					maxLength={SSO_BUTTON_LABEL_MAX_LENGTH}
					placeholder={t("auth.login-with-sso", "Sign in with SSO")}
					onChange={(event) =>
						setConfig((prev) => ({ ...prev, ssoButtonLabel: event.target.value }))
					}
				/>
			</div>
			<div className="space-y-1.5">
				<Label htmlFor="sso-button-icon">
					{t("settings.enterprise.domains.ssoButtonIcon", "SSO button icon")}
				</Label>
				<Select<SsoButtonIconName>
					value={config.ssoButtonIcon ?? "fingerprint"}
					onValueChange={(icon) =>
						setConfig((prev) => ({
							...prev,
							ssoButtonIcon: icon === "fingerprint" ? undefined : icon,
						}))
					}
				>
					<SelectTrigger id="sso-button-icon" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{SSO_BUTTON_ICONS.map((icon) => (
							<SelectItem key={icon} value={icon}>
								<SsoButtonIcon name={icon} />
								{iconLabels[icon]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);
}

function AuthenticationMethodsSection({ controller }: { controller: DomainAuthConfigController }) {
	const { config, handleSocialProviderToggle, setConfig, ssoProviderAvailable, t } = controller;

	return (
		<>
			<div className="flex items-center justify-between">
				<div className="space-y-0.5">
					<Label htmlFor="email-password">
						{t("settings.enterprise.domains.emailPassword", "Email & Password")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.enterprise.domains.emailPasswordHelp",
							"Allow users to sign in with email and password",
						)}
					</p>
				</div>
				<Switch
					id="email-password"
					checked={config.emailPasswordEnabled}
					onCheckedChange={(checked) =>
						setConfig((prev) => ({
							...prev,
							emailPasswordEnabled: checked,
						}))
					}
				/>
			</div>

			<Separator />
			<div className="flex items-center justify-between">
				<div className="space-y-0.5">
					<Label htmlFor="registration">
						{t("settings.enterprise.domains.registration", "Registration")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.enterprise.domains.registrationHelp",
							"Allow new people to create an account here. When off, only people with an invitation can sign up.",
						)}
					</p>
				</div>
				<Switch
					id="registration"
					checked={config.registrationEnabled !== false}
					onCheckedChange={(checked) =>
						setConfig((prev) => ({ ...prev, registrationEnabled: checked }))
					}
				/>
			</div>

			<Separator />
			<div className="space-y-3">
				<div>
					<Label>{t("settings.enterprise.domains.socialProviders", "Social Providers")}</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.enterprise.domains.socialProvidersHelp",
							"Enable social login options for this domain",
						)}
					</p>
				</div>
				<div className="grid grid-cols-2 gap-3">
					{SOCIAL_PROVIDERS.map((provider) => (
						<div key={provider.id} className="flex items-center gap-x-2">
							<Checkbox
								id={provider.id}
								checked={config.socialProvidersEnabled.includes(provider.id)}
								onCheckedChange={(checked) =>
									handleSocialProviderToggle(provider.id, checked === true)
								}
							/>
							<Label htmlFor={provider.id} className="text-sm font-normal">
								{provider.label}
							</Label>
						</div>
					))}
				</div>
			</div>

			<Separator />
			<div className="flex items-center justify-between">
				<div className="space-y-0.5">
					<Label htmlFor="sso">
						{t("settings.enterprise.domains.sso", "Single Sign-On (SSO)")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{ssoProviderAvailable
							? t("settings.enterprise.domains.ssoHelp", "Allow OIDC-based enterprise sign-in")
							: t(
									"settings.enterprise.domains.ssoUnavailableHelp",
									"Set up and verify an SSO provider under Identity setup first.",
								)}
					</p>
				</div>
				<Switch
					id="sso"
					checked={config.ssoEnabled && ssoProviderAvailable}
					disabled={!ssoProviderAvailable}
					onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, ssoEnabled: checked }))}
				/>
			</div>
			{config.ssoEnabled && ssoProviderAvailable ? (
				<SsoButtonFields controller={controller} />
			) : null}

			<Separator />
			<div className="flex items-center justify-between">
				<div className="space-y-0.5">
					<Label htmlFor="passkey">{t("settings.enterprise.domains.passkey", "Passkey")}</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.enterprise.domains.passkeyHelp",
							"Allow passwordless sign-in with passkeys",
						)}
					</p>
				</div>
				<Switch
					id="passkey"
					checked={config.passkeyEnabled}
					onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, passkeyEnabled: checked }))}
				/>
			</div>
		</>
	);
}

function DomainSecuritySection({ controller }: { controller: DomainAuthConfigController }) {
	const { config, setConfig, setTurnstileSecretKey, t, turnstileSecretKey } = controller;

	return (
		<>
			<Separator />
			<div className="space-y-3">
				<div>
					<Label>{t("settings.enterprise.domains.turnstile", "Cloudflare Turnstile")}</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.enterprise.domains.turnstileHelp",
							"Bot protection for auth forms. Required for enterprise domains.",
						)}
					</p>
				</div>
				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor="turnstile-site-key">
							{t("settings.enterprise.domains.siteKey", "Site Key")}
						</Label>
						<Input
							id="turnstile-site-key"
							name="turnstileSiteKey"
							autoComplete="off"
							value={config.turnstileSiteKey ?? ""}
							onChange={(e) =>
								setConfig((prev) => ({
									...prev,
									turnstileSiteKey: e.target.value || undefined,
								}))
							}
							placeholder="0x4AAA..."
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="turnstile-secret-key">
							{t("settings.enterprise.domains.secretKey", "Secret Key")}
						</Label>
						<Input
							id="turnstile-secret-key"
							name="turnstileSecretKey"
							autoComplete="new-password"
							type="password"
							value={turnstileSecretKey}
							onChange={(e) => setTurnstileSecretKey(e.target.value)}
							placeholder={
								config.turnstileSiteKey
									? "••••••••••••••••"
									: t("settings.enterprise.domains.secretKeyPlaceholder", "Enter secret key")
							}
						/>
						<p className="text-xs text-muted-foreground">
							{config.turnstileSiteKey
								? t(
										"settings.enterprise.domains.keepExistingSecretKey",
										"Leave empty to keep existing secret key",
									)
								: t(
										"settings.enterprise.domains.secretKeyRequired",
										"Required when setting a site key",
									)}
						</p>
					</div>
				</div>
			</div>

			<Separator />

			<div className="space-y-3">
				<div>
					<Label htmlFor="cookie-consent-script">
						{t("settings.enterprise.domains.cookieConsentScript", "Cookie Consent Script")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.enterprise.domains.cookieConsentScriptHelp",
							"Injected on authentication pages for this custom domain only. Leave empty to disable.",
						)}
					</p>
				</div>
				<Textarea
					id="cookie-consent-script"
					name="cookieConsentScript"
					autoComplete="off"
					spellCheck={false}
					value={config.cookieConsentScript ?? ""}
					onChange={(e) =>
						setConfig((prev) => ({
							...prev,
							cookieConsentScript: e.target.value || undefined,
						}))
					}
					rows={8}
					className="font-mono text-sm"
					placeholder={`<!-- Example: CookieBot -->
<script id="Cookiebot" src="https://consent.cookiebot.com/uc.js" data-cbid="YOUR-ID" type="text/javascript" async></script>`}
				/>
			</div>
		</>
	);
}

export function DomainAuthConfigDialog(props: DomainAuthConfigDialogProps) {
	const { domain, open, onOpenChange } = props;
	if (!domain) return null;
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<DomainAuthConfigFields key={`${domain.id}-${open}`} {...props} domain={domain} />
			</ActionPanelContent>
		</ActionPanel>
	);
}

function DomainAuthConfigFields(props: DomainAuthConfigDialogProps & { domain: Domain }) {
	const { domain, onOpenChange } = props;
	const controller = useDomainAuthConfigController(props);
	const { handleSave, isSaving, t, variant } = controller;
	return (
		<form className="flex min-h-0 flex-1 flex-col" action={() => handleSave()}>
			<ActionPanelHeader>
				<ActionPanelTitle>
					{t("settings.enterprise.domains.authConfigTitle", "Auth Configuration")}
				</ActionPanelTitle>
				<ActionPanelDescription>
					{t(
						"settings.enterprise.domains.authConfigDescription",
						"Configure which authentication methods are available for users signing in via {domain}",
						{ domain: domain.domain },
					)}
				</ActionPanelDescription>
			</ActionPanelHeader>

			<ActionPanelBody className="space-y-6">
				<AuthenticationMethodsSection controller={controller} />
				{variant === "customDomain" ? <DomainSecuritySection controller={controller} /> : null}
			</ActionPanelBody>

			<ActionPanelFooter>
				<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={isSaving}>
					{isSaving
						? t("common.saving", "Saving…")
						: t("settings.enterprise.domains.saveConfiguration", "Save Configuration")}
				</Button>
			</ActionPanelFooter>
		</form>
	);
}
