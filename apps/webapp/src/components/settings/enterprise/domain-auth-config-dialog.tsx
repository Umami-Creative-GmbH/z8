"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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

export function DomainAuthConfigDialog({
	open,
	onOpenChange,
	domain,
	organizationId,
	onSave,
}: DomainAuthConfigDialogProps) {
	const [config, setConfig] = useState<AuthConfig>({
		emailPasswordEnabled: true,
		socialProvidersEnabled: [],
		ssoEnabled: false,
		passkeyEnabled: true,
	});
	const [turnstileSecretKey, setTurnstileSecretKey] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (domain) {
			setConfig(domain.authConfig);
			// Clear secret key when domain changes (we don't fetch it back for security)
			setTurnstileSecretKey("");
		}
	}, [domain]);

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
		try {
			// Pass the secret key only if it was entered (non-empty)
			await onSave(domain.id, config, turnstileSecretKey || undefined);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Auth Configuration</DialogTitle>
					<DialogDescription>
						Configure which authentication methods are available for users signing in via{" "}
						{domain.domain}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					{/* Email/Password */}
					<div className="flex items-center justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="email-password">Email & Password</Label>
							<p className="text-sm text-muted-foreground">
								Allow users to sign in with email and password
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
							<Label>Social Providers</Label>
							<p className="text-sm text-muted-foreground">
								Enable social login options for this domain
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
							<Label htmlFor="sso">Single Sign-On (SSO)</Label>
							<p className="text-sm text-muted-foreground">Allow OIDC-based enterprise sign-in</p>
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
							<Label htmlFor="passkey">Passkey</Label>
							<p className="text-sm text-muted-foreground">
								Allow passwordless sign-in with passkeys
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
							<Label>Cloudflare Turnstile</Label>
							<p className="text-sm text-muted-foreground">
								Bot protection for auth forms. Required for enterprise domains.
							</p>
						</div>
						<div className="space-y-3">
							<div className="space-y-1.5">
								<Label htmlFor="turnstile-site-key">Site Key</Label>
								<Input
									id="turnstile-site-key"
									value={config.turnstileSiteKey ?? ""}
									onChange={(e) =>
										setConfig((prev) => ({ ...prev, turnstileSiteKey: e.target.value || undefined }))
									}
									placeholder="0x4AAA..."
								/>
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="turnstile-secret-key">Secret Key</Label>
								<Input
									id="turnstile-secret-key"
									type="password"
									value={turnstileSecretKey}
									onChange={(e) => setTurnstileSecretKey(e.target.value)}
									placeholder={config.turnstileSiteKey ? "••••••••••••••••" : "Enter secret key"}
								/>
								<p className="text-xs text-muted-foreground">
									{config.turnstileSiteKey
										? "Leave empty to keep existing secret key"
										: "Required when setting a site key"}
								</p>
							</div>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={isSaving}>
						{isSaving ? "Saving..." : "Save Configuration"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
