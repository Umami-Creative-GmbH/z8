import {
	IconCheck,
	IconPlus,
	IconRefresh,
	IconSettings,
	IconTrash,
	IconWorld,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthConfig } from "@/lib/domain";

export interface CustomDomain {
	id: string;
	domain: string;
	domainVerified: boolean;
	isPrimary: boolean;
	verificationToken: string | null;
	verificationTokenExpiresAt: Date | null;
	authConfig: AuthConfig;
	createdAt: Date;
}

interface CustomDomainSummaryProps {
	domain: CustomDomain | null;
	onAdd: () => void;
	onConfigure: (domain: CustomDomain) => void;
	onDelete: (domain: CustomDomain) => void;
	onVerify: (domain: CustomDomain) => void;
}

export function CustomDomainSummary({
	domain,
	onAdd,
	onConfigure,
	onDelete,
	onVerify,
}: CustomDomainSummaryProps) {
	const { t } = useTranslate();

	if (!domain) {
		return (
			<div className="text-center py-8">
				<div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center mb-4">
					<IconWorld className="size-6 text-muted-foreground" />
				</div>
				<p className="text-muted-foreground mb-4">
					{t("settings.enterprise.domains.empty", "No custom domain configured yet.")}
				</p>
				<Button onClick={onAdd}>
					<IconPlus className="mr-2 size-4" />
					{t("settings.enterprise.domains.add", "Add Custom Domain")}
				</Button>
			</div>
		);
	}

	const hasTurnstileSiteKey = Boolean(domain.authConfig.turnstileSiteKey?.trim());
	const hasCookieConsentScript = Boolean(domain.authConfig.cookieConsentScript?.trim());

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between p-4 border rounded-lg">
				<div className="flex items-center gap-4">
					<div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
						<IconWorld className="size-5 text-primary" />
					</div>
					<div>
						<p className="font-medium">{domain.domain}</p>
						<div className="flex items-center gap-2 mt-1">
							{domain.domainVerified ? (
								<Badge variant="default" className="bg-green-600">
									<IconCheck className="mr-1 size-3" />
									{t("settings.enterprise.domains.status.verified", "Verified")}
								</Badge>
							) : (
								<Badge variant="destructive">
									<IconX className="mr-1 size-3" />
									{t("settings.enterprise.domains.status.pending", "Pending Verification")}
								</Badge>
							)}
						</div>
					</div>
				</div>
				<div className="flex gap-2">
					{!domain.domainVerified ? (
						<Button variant="outline" size="sm" onClick={() => onVerify(domain)}>
							<IconRefresh className="mr-1 size-4" />
							{t("settings.enterprise.domains.verify", "Verify")}
						</Button>
					) : null}
					<Button
						aria-label={t(
							"settings.enterprise.domains.editAuthSettingsAria",
							"Edit authentication settings for {domain}",
							{ domain: domain.domain },
						)}
						variant="outline"
						size="sm"
						onClick={() => onConfigure(domain)}
					>
						<IconSettings className="size-4" aria-hidden="true" />
					</Button>
					<Button
						aria-label={t(
							"settings.enterprise.domains.deleteAria",
							"Delete custom domain {domain}",
							{ domain: domain.domain },
						)}
						variant="outline"
						size="sm"
						onClick={() => onDelete(domain)}
					>
						<IconTrash className="size-4 text-destructive" aria-hidden="true" />
					</Button>
				</div>
			</div>

		<div className="p-4 bg-muted/50 rounded-lg">
			<p className="text-sm font-medium mb-2">
				{t("settings.enterprise.domains.enabledAuthMethods", "Enabled Auth Methods")}
			</p>
			<div className="flex flex-wrap gap-2">
				{domain.authConfig.emailPasswordEnabled ? (
					<Badge variant="outline">
						{t("settings.enterprise.domains.authMethod.emailPassword", "Email/Password")}
					</Badge>
				) : null}
				{domain.authConfig.ssoEnabled ? (
					<Badge variant="outline">{t("settings.enterprise.domains.authMethod.sso", "SSO")}</Badge>
				) : null}
				{domain.authConfig.socialProvidersEnabled.length > 0 ? (
					<Badge variant="outline">
						{t("settings.enterprise.domains.authMethod.social", "Social ({providers})", {
							providers: domain.authConfig.socialProvidersEnabled.join(", "),
						})}
					</Badge>
				) : null}
				{domain.authConfig.passkeyEnabled ? (
					<Badge variant="outline">
						{t("settings.enterprise.domains.authMethod.passkey", "Passkey")}
					</Badge>
				) : null}
			</div>
		</div>

		<div className="p-4 bg-muted/50 rounded-lg">
			<p className="text-sm font-medium mb-2">
				{t("settings.enterprise.domains.domainPageSettings", "Domain Page Settings")}
			</p>
			<div className="flex flex-wrap gap-2">
				<Badge variant={hasTurnstileSiteKey ? "outline" : "secondary"}>
					{t("settings.enterprise.domains.turnstileSiteKeyStatus", "Turnstile site key {status}", {
						status: hasTurnstileSiteKey
							? t("settings.enterprise.domains.configured", "configured")
							: t("settings.enterprise.domains.notConfigured", "not configured"),
					})}
				</Badge>
				<Badge variant={hasCookieConsentScript ? "outline" : "secondary"}>
					{t("settings.enterprise.domains.cookieConsentStatus", "Cookie consent {status}", {
						status: hasCookieConsentScript
							? t("settings.enterprise.domains.configured", "configured")
							: t("settings.enterprise.domains.notConfigured", "not configured"),
					})}
				</Badge>
			</div>
		</div>
	</div>
	);
}
