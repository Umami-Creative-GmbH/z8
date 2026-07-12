import {
	IconCheck,
	IconExternalLink,
	IconKey,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

export interface SsoProvider {
	id: string;
	issuer: string;
	domain: string;
	providerId: string;
	domainVerified: boolean | null;
	domainVerificationToken: string | null;
	createdAt: Date | null;
}

interface SsoProviderListCardProps {
	busyProviderId: string | null;
	providers: SsoProvider[];
	tokenByProviderId: Record<string, string>;
	onDelete: (provider: SsoProvider) => void;
	onRequestVerificationToken: (provider: SsoProvider) => void;
	onVerifyDomain: (provider: SsoProvider) => void;
}

function getProviderDisplayName(issuer: string) {
	if (issuer.includes("okta")) return "Okta";
	if (issuer.includes("azure") || issuer.includes("microsoft")) return "Microsoft Entra ID";
	if (issuer.includes("google")) return "Google Workspace";
	if (issuer.includes("auth0")) return "Auth0";
	if (issuer.includes("onelogin")) return "OneLogin";
	if (issuer.includes("ping")) return "PingIdentity";
	return "OIDC Provider";
}

export function SsoProviderListCard({
	busyProviderId,
	providers,
	tokenByProviderId,
	onDelete,
	onRequestVerificationToken,
	onVerifyDomain,
}: SsoProviderListCardProps) {
	const { t } = useTranslate();

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{t("settings.enterprise.provider", "Provider")}</TableHead>
					<TableHead>{t("settings.enterprise.domain", "Domain")}</TableHead>
					<TableHead>{t("common.status", "Status")}</TableHead>
					<TableHead>{t("settings.enterprise.sso.issuerUrl", "Issuer URL")}</TableHead>
					<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{providers.map((provider) => {
					const dnsToken =
						tokenByProviderId[provider.providerId] ?? provider.domainVerificationToken;

					return (
						<TableRow key={provider.id}>
							<TableCell className="font-medium">{getProviderDisplayName(provider.issuer)}</TableCell>
							<TableCell>{provider.domain}</TableCell>
							<TableCell>
								{provider.domainVerified ? (
									<Badge variant="default" className="bg-green-600">
										<IconCheck className="mr-1 size-3" />
										{t("settings.enterprise.sso.verified", "Verified")}
									</Badge>
								) : (
									<Badge variant="secondary">
										<IconX className="mr-1 size-3" />
										{t("common.pending", "Pending")}
									</Badge>
								)}
								{!provider.domainVerified && dnsToken ? (
									<p className="mt-1 text-xs text-muted-foreground">
										{t("settings.enterprise.sso.txtToken", "TXT token:")} {" "}
										<code className="bg-muted px-1 rounded">{dnsToken}</code>
									</p>
								) : null}
							</TableCell>
							<TableCell>
								<a
									href={provider.issuer}
									target="_blank"
									rel="noopener noreferrer"
									className="flex items-center text-sm text-muted-foreground hover:text-foreground"
								>
									<span className="max-w-[200px] truncate">{provider.issuer}</span>
									<IconExternalLink className="ml-1 size-3" />
								</a>
							</TableCell>
							<TableCell className="text-right">
								<div className="flex justify-end gap-2">
									{!provider.domainVerified ? (
										<>
											<Button
												variant="outline"
												size="sm"
												disabled={busyProviderId === provider.id}
												onClick={() => onRequestVerificationToken(provider)}
											>
												<IconKey className="mr-1 size-4" />
												{t("settings.enterprise.sso.token", "Token")}
											</Button>
											<Button
												variant="outline"
												size="sm"
												disabled={busyProviderId === provider.id}
												onClick={() => onVerifyDomain(provider)}
											>
												<IconRefresh className="mr-1 size-4" />
												{t("settings.enterprise.sso.verify", "Verify")}
											</Button>
										</>
									) : null}
									<Button
										aria-label={t(
											"settings.enterprise.sso.deleteProviderAria",
											"Delete SSO provider {provider}",
											{ provider: provider.providerId },
										)}
										variant="outline"
										size="sm"
										onClick={() => onDelete(provider)}
									>
										<IconTrash className="size-4 text-destructive" aria-hidden="true" />
									</Button>
								</div>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
