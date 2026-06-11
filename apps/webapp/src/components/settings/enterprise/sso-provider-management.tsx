"use client";

import {
	IconCheck,
	IconExternalLink,
	IconKey,
	IconPlus,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteSSOProviderAction,
	requestSSODomainVerificationAction,
	verifySSODomainAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { SSOProviderDialog } from "./sso-provider-dialog";

interface SSOProvider {
	id: string;
	issuer: string;
	domain: string;
	providerId: string;
	domainVerified: boolean | null;
	domainVerificationToken: string | null;
	createdAt: Date | null;
}

interface SSOProviderManagementProps {
	initialProviders: SSOProvider[];
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

export function SSOProviderManagement({ initialProviders }: SSOProviderManagementProps) {
	const { t } = useTranslate();
	const [providers, setProviders] = useState<SSOProvider[]>(initialProviders);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [tokenByProviderId, setTokenByProviderId] = useState<Record<string, string>>(() =>
		initialProviders.reduce<Record<string, string>>((tokens, provider) => {
			if (provider.domainVerificationToken) {
				tokens[provider.providerId] = provider.domainVerificationToken;
			}
			return tokens;
		}, {}),
	);
	const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
	const [deleteDialog, setDeleteDialog] = useState<{
		isOpen: boolean;
		provider: SSOProvider | null;
	}>({ isOpen: false, provider: null });

	const handleProviderAdded = (newProvider: SSOProvider) => {
		setProviders((prev) => [...prev, newProvider]);
		if (newProvider.domainVerificationToken) {
			setTokenByProviderId((prev) => ({
				...prev,
				[newProvider.providerId]: newProvider.domainVerificationToken as string,
			}));
		}
		setIsAddDialogOpen(false);
	};

	const handleRequestVerificationToken = async (provider: SSOProvider) => {
		setBusyProviderId(provider.id);
		const result = await requestSSODomainVerificationAction(provider.id).then(
			(response) => ({ ok: true as const, response }),
			(error) => ({ ok: false as const, error }),
		);

		if (!result.ok || !result.response.domainVerificationToken) {
			toast.error(
				t("settings.enterprise.sso.tokenError", "Failed to generate domain verification token"),
			);
			setBusyProviderId(null);
			return;
		}

		setTokenByProviderId((prev) => ({
			...prev,
			[provider.providerId]: result.response.domainVerificationToken,
		}));
		toast.success(t("settings.enterprise.sso.tokenGenerated", "Verification token generated"));
		setBusyProviderId(null);
	};

	const handleVerifyDomain = async (provider: SSOProvider) => {
		setBusyProviderId(provider.id);
		const verified = await verifySSODomainAction(provider.id)
			.then(() => true)
			.catch(() => false);

		if (!verified) {
			toast.error(
				t(
					"settings.enterprise.sso.verifyError",
					"Domain verification failed. Check your DNS TXT record and retry.",
				),
			);
			setBusyProviderId(null);
			return;
		}

		setProviders((prev) =>
			prev.map((entry) =>
				entry.id === provider.id
					? { ...entry, domainVerified: true, domainVerificationToken: null }
					: entry,
			),
		);
		setTokenByProviderId((prev) => {
			const next = { ...prev };
			delete next[provider.providerId];
			return next;
		});
		toast.success(t("settings.enterprise.sso.domainVerified", "Domain verified"));
		setBusyProviderId(null);
	};

	const handleDelete = async () => {
		const provider = deleteDialog.provider;
		if (!provider) return;

		const didDelete = await deleteSSOProviderAction(provider.id)
			.then(() => true)
			.catch(() => false);

		if (didDelete) {
			setProviders((prev) => prev.filter((p) => p.id !== provider.id));
			setTokenByProviderId((prev) => {
				const next = { ...prev };
				delete next[provider.providerId];
				return next;
			});
			toast.success(t("settings.enterprise.sso.deleteSuccess", "SSO provider deleted"));
		} else {
			toast.error(t("settings.enterprise.sso.deleteError", "Failed to delete SSO provider"));
		}

		setDeleteDialog({ isOpen: false, provider: null });
	};

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div>
						<CardTitle>{t("settings.enterprise.sso.title", "Identity Providers")}</CardTitle>
						<CardDescription>
							{t(
								"settings.enterprise.sso.description",
								"Add OIDC identity providers to enable SSO for your organization.",
							)}
						</CardDescription>
					</div>
					<Button onClick={() => setIsAddDialogOpen(true)}>
						<IconPlus className="mr-2 size-4" />
						{t("settings.enterprise.addProvider", "Add Provider")}
					</Button>
				</CardHeader>
				<CardContent>
					{providers.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							<p>{t("settings.enterprise.sso.empty", "No SSO providers configured yet.")}</p>
							<p className="text-sm">
								{t(
									"settings.enterprise.sso.emptyDescription",
									"Add an OIDC provider to enable enterprise single sign-on.",
								)}
							</p>
						</div>
					) : (
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
											<TableCell className="font-medium">
												{getProviderDisplayName(provider.issuer)}
											</TableCell>
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
												{!provider.domainVerified && dnsToken && (
													<p className="mt-1 text-xs text-muted-foreground">
														{t("settings.enterprise.sso.txtToken", "TXT token:")}{" "}
														<code className="bg-muted px-1 rounded">{dnsToken}</code>
													</p>
												)}
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
													{!provider.domainVerified && (
														<>
															<Button
																variant="outline"
																size="sm"
																disabled={busyProviderId === provider.id}
																onClick={() => handleRequestVerificationToken(provider)}
															>
																<IconKey className="mr-1 size-4" />
																{t("settings.enterprise.sso.token", "Token")}
															</Button>
															<Button
																variant="outline"
																size="sm"
																disabled={busyProviderId === provider.id}
																onClick={() => handleVerifyDomain(provider)}
															>
																<IconRefresh className="mr-1 size-4" />
																{t("settings.enterprise.sso.verify", "Verify")}
															</Button>
														</>
													)}
													<Button
														variant="outline"
														size="sm"
														onClick={() => setDeleteDialog({ isOpen: true, provider })}
													>
														<IconTrash className="size-4 text-destructive" />
													</Button>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<div className="mt-6 p-4 bg-muted rounded-lg">
				<h3 className="font-medium mb-2">
					{t("settings.enterprise.sso.setupInstructions", "Setup Instructions")}
				</h3>
				<ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
					<li>
						{t(
							"settings.enterprise.sso.instructions.createApp",
							"Create an OIDC application in your identity provider (Okta, Azure AD, etc.)",
						)}
					</li>
					<li>
						{t("settings.enterprise.configureCallbackUrl", "Configure the callback URL:")}{" "}
						<code className="bg-background px-1 rounded">
							{typeof window !== "undefined"
								? `${window.location.origin}/api/auth/sso/callback`
								: "/api/auth/sso/callback"}
						</code>
					</li>
					<li>
						{t(
							"settings.enterprise.sso.instructions.copyCredentials",
							"Copy the Issuer URL, Client ID, and Client Secret from your IdP",
						)}
					</li>
					<li>
						{t(
							"settings.enterprise.sso.instructions.verifyDomain",
							"Add the provider here and verify the email domain via DNS TXT record",
						)}
					</li>
				</ol>
			</div>

			<SSOProviderDialog
				open={isAddDialogOpen}
				onOpenChange={setIsAddDialogOpen}
				onProviderAdded={handleProviderAdded}
			/>

			<AlertDialog
				open={deleteDialog.isOpen}
				onOpenChange={(open) => setDeleteDialog({ isOpen: open, provider: deleteDialog.provider })}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.enterprise.sso.deleteDialogTitle", "Delete SSO Provider")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.enterprise.sso.deleteDialogDescription",
								"Are you sure you want to delete this SSO provider? Users will no longer be able to sign in using this identity provider.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
