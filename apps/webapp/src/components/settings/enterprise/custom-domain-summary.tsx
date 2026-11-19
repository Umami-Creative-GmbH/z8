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
			<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-4">
				<div className="flex items-center gap-2 text-sm text-muted-foreground">
					<IconWorld className="size-4 shrink-0" aria-hidden="true" />
					<p>{t("settings.enterprise.domains.empty", "No custom domain configured yet.")}</p>
				</div>
				<Button onClick={onAdd}>
					<IconPlus className="size-4" aria-hidden="true" />
					{t("settings.enterprise.domains.add", "Add Custom Domain")}
				</Button>
			</div>
		);
	}

	const hasTurnstileSiteKey = Boolean(domain.authConfig.turnstileSiteKey?.trim());
	const hasCookieConsentScript = Boolean(domain.authConfig.cookieConsentScript?.trim());

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-4">
					<div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
						<IconWorld className="size-5 text-primary" aria-hidden="true" />
					</div>
					<div className="min-w-0">
						<p className="truncate font-medium" title={domain.domain}>
							{domain.domain}
						</p>
						<div className="flex items-center gap-2 mt-1">
							{domain.domainVerified ? (
								<Badge variant="success">
									<IconCheck className="size-3" aria-hidden="true" />
									{t("settings.enterprise.domains.status.verified", "Verified")}
								</Badge>
							) : (
								<Badge variant="outline">
									<IconX className="size-3" aria-hidden="true" />
									{t("settings.enterprise.domains.status.pending", "Pending Verification")}
								</Badge>
							)}
						</div>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{!domain.domainVerified ? (
						<Button variant="outline" size="sm" onClick={() => onVerify(domain)}>
							<IconRefresh className="size-4" aria-hidden="true" />
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
						<Badge variant="outline" className="max-w-full whitespace-normal">
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
