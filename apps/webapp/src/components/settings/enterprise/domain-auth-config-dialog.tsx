"use client";

import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { AuthConfig } from "@/lib/domain";

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
	passkeyEnabled: domain?.authConfig.passkeyEnabled ?? true,
	turnstileSiteKey: domain?.authConfig.turnstileSiteKey,
	cookieConsentScript: domain?.authConfig.cookieConsentScript,
});

export function DomainAuthConfigDialog({
	open,
	onOpenChange,
	domain,
	organizationId: _organizationId,
	onSave,
}: DomainAuthConfigDialogProps) {
	const { t } = useTranslate();
	const [config, setConfig] = useState<AuthConfig>(() => getInitialConfig(domain));
	const [turnstileSecretKey, setTurnstileSecretKey] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const resetKey = open && domain ? domain.id : null;
	const [lastResetKey, setLastResetKey] = useState<string | null>(resetKey);

	if (lastResetKey !== resetKey) {
		setLastResetKey(resetKey);
		if (resetKey && domain) {
			setConfig(getInitialConfig(domain));
			setTurnstileSecretKey("");
		}
	}

	const handleOpenChange = (nextOpen: boolean) => {
		if (nextOpen && domain) {
			setConfig(getInitialConfig(domain));
			setTurnstileSecretKey("");
		}
		onOpenChange(nextOpen);
	};

	if (!domain) return null;

	const handleSocialProviderToggle = (providerId: string, checked: boolean) => {
		setConfig((prev) => ({
			...prev,
			socialProvidersEnabled: checked
				? [...prev.socialProvidersEnabled, providerId]
				: prev.socialProvidersEnabled.filter((p) => p !== providerId),
		}));
	};

	const handleSave = async () => {
		setIsSaving(true);
		// Pass the secret key only if it was entered (non-empty)
		await onSave(domain.id, config, turnstileSecretKey || undefined).catch(() => undefined);
		setIsSaving(false);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent>
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
					{/* Email/Password */}
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
								setConfig((prev) => ({ ...prev, emailPasswordEnabled: checked }))
							}
						/>
					</div>

					<Separator />

					{/* Social Providers */}
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
								<div key={provider.id} className="flex items-center space-x-2">
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

					{/* SSO */}
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="sso">
								{t("settings.enterprise.domains.sso", "Single Sign-On (SSO)")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t("settings.enterprise.domains.ssoHelp", "Allow OIDC-based enterprise sign-in")}
							</p>
						</div>
						<Switch
							id="sso"
							checked={config.ssoEnabled}
							onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, ssoEnabled: checked }))}
						/>
					</div>

					<Separator />

					{/* Passkey */}
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
							onCheckedChange={(checked) =>
								setConfig((prev) => ({ ...prev, passkeyEnabled: checked }))
							}
						/>
					</div>

					<Separator />

					{/* Cloudflare Turnstile */}
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
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button onClick={handleSave} disabled={isSaving}>
						{isSaving
							? t("common.saving", "Saving…")
							: t("settings.enterprise.domains.saveConfiguration", "Save Configuration")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
