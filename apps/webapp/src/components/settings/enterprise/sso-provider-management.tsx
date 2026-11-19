"use client";

import {
	actionData,
	enterpriseErrorMessage,
} from "@/components/settings/enterprise/action-data";
import { IconPlus } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteSSOProviderAction,
	requestSSODomainVerificationAction,
	verifySSODomainAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useServerDataState } from "@/hooks/use-server-data-state";
import { getOidcCallbackUrl } from "@/lib/enterprise-identity/entra-setup";
import {
	EnterpriseDeleteConfirmDialog,
	useConfirmedRemoval,
} from "./enterprise-delete-confirm-dialog";
import { SSOProviderDialog } from "./sso-provider-dialog";
import { SsoCallbackUrl, SsoSetupNextSteps } from "./sso-provider-guide";
import {
	type SsoProvider,
	SsoProviderListCard,
} from "./sso-provider-list-card";

type SSOProvider = SsoProvider;

interface SSOProviderManagementProps {
	initialProviders: SSOProvider[];
	callbackBaseUrl: string;
}

export function SSOProviderManagement({
	initialProviders,
	callbackBaseUrl,
}: SSOProviderManagementProps) {
	const { t } = useTranslate();
	const [providers, setProviders] =
		useServerDataState<SSOProvider[]>(initialProviders);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [tokenByProviderId, setTokenByProviderId] = useState<
		Record<string, string>
	>(() =>
		initialProviders.reduce<Record<string, string>>((tokens, provider) => {
			if (provider.domainVerificationToken) {
				tokens[provider.providerId] = provider.domainVerificationToken;
			}
			return tokens;
		}, {}),
	);
	const [busyProviderId, setBusyProviderId] = useState<string | null>(null);
	const removal = useConfirmedRemoval<SSOProvider>();
	const callbackUrl = getOidcCallbackUrl(callbackBaseUrl);

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
		const result = await actionData(requestSSODomainVerificationAction({ providerId: provider.id })).then(
			(response) => ({ ok: true as const, response }),
			(error) => ({ ok: false as const, error }),
		);

		if (!result.ok || !result.response.domainVerificationToken) {
			toast.error(
				t(
					"settings.enterprise.sso.tokenError",
					"Failed to generate domain verification token",
				),
			);
			setBusyProviderId(null);
			return;
		}

		const token = result.response.domainVerificationToken;
		setTokenByProviderId((prev) => ({ ...prev, [provider.providerId]: token }));
		toast.success(
			t(
				"settings.enterprise.sso.tokenGenerated",
				"Verification token generated",
			),
		);
		setBusyProviderId(null);
	};

	const handleVerifyDomain = async (provider: SSOProvider) => {
		setBusyProviderId(provider.id);
		const verified = await actionData(verifySSODomainAction({ providerId: provider.id }))
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
		toast.success(
			t("settings.enterprise.sso.domainVerified", "Domain verified"),
		);
		setBusyProviderId(null);
	};

	const handleDelete = () =>
		removal.confirm(
			async (provider) => {
				await actionData(deleteSSOProviderAction({ providerId: provider.id }));
				setProviders((prev) => prev.filter((p) => p.id !== provider.id));
				setTokenByProviderId((prev) => {
					const next = { ...prev };
					delete next[provider.providerId];
					return next;
				});
				toast.success(
					t("settings.enterprise.sso.deleteSuccess", "SSO provider deleted"),
				);
			},
			(error) =>
				enterpriseErrorMessage(t, error, [
					"settings.enterprise.sso.deleteError",
					"Failed to delete SSO provider",
				]),
		);

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.enterprise.sso.title", "Identity Providers")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.enterprise.sso.description",
							"Add OIDC identity providers to enable SSO for your organization.",
						)}
					</CardDescription>
					<CardAction>
						<Button onClick={() => setIsAddDialogOpen(true)}>
							<IconPlus className="size-4" aria-hidden="true" />
							{t("settings.enterprise.addProvider", "Add Provider")}
						</Button>
					</CardAction>
				</CardHeader>
				<CardContent>
					{providers.length === 0 ? (
						<div className="rounded-lg border border-dashed p-4 text-sm">
							<p className="font-medium">
								{t(
									"settings.enterprise.sso.empty",
									"No SSO providers configured yet.",
								)}
							</p>
							<p className="text-muted-foreground">
								{t(
									"settings.enterprise.sso.emptyDescription",
									"Add an OIDC provider to enable enterprise single sign-on.",
								)}
							</p>
						</div>
					) : (
						<SsoProviderListCard
							busyProviderId={busyProviderId}
							providers={providers}
							tokenByProviderId={tokenByProviderId}
							onDelete={removal.request}
							onRequestVerificationToken={handleRequestVerificationToken}
							onVerifyDomain={handleVerifyDomain}
						/>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>
						{t(
							"settings.enterprise.sso.guide.getStarted",
							"Connect your team's sign-in",
						)}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.enterprise.sso.guide.getStartedDescription",
							"Follow a provider-specific walkthrough without piecing together the configuration yourself.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid min-w-0 items-start gap-6 lg:grid-cols-2">
					<div className="space-y-4 rounded-lg border bg-primary/5 p-5">
						<h3 className="font-semibold">Microsoft Entra ID</h3>
						<p className="text-sm leading-relaxed text-muted-foreground">
							{t(
								"settings.enterprise.sso.guide.entra.introduction",
								"Create a Web app registration, copy your tenant and application IDs, and add a client secret. Z8 generates the issuer URL and guides you through each step.",
							)}
						</p>
						<Button onClick={() => setIsAddDialogOpen(true)}>
							{t(
								"settings.enterprise.sso.guide.entra.start",
								"Set up Microsoft Entra ID",
							)}
						</Button>
						<p className="text-xs leading-relaxed text-muted-foreground">
							{t(
								"settings.enterprise.sso.guide.manualAvailable",
								"Using another provider? Choose manual OIDC configuration in the setup panel.",
							)}
						</p>
					</div>
					<div className="min-w-0 space-y-5">
						<SsoCallbackUrl callbackUrl={callbackUrl} />
						<SsoSetupNextSteps />
					</div>
				</CardContent>
			</Card>

			<SSOProviderDialog
				callbackUrl={callbackUrl}
				open={isAddDialogOpen}
				onOpenChange={setIsAddDialogOpen}
				onProviderAdded={handleProviderAdded}
			/>

			<EnterpriseDeleteConfirmDialog
				open={removal.open}
				onOpenChange={removal.onOpenChange}
				title={t(
					"settings.enterprise.sso.deleteDialogTitleNamed",
					"Delete SSO provider {provider}?",
					{ provider: removal.target?.providerId ?? "" },
				)}
				description={t(
					"settings.enterprise.sso.deleteDialogDescription",
					"Are you sure you want to delete this SSO provider? Users will no longer be able to sign in using this identity provider.",
				)}
				confirmLabel={t("settings.enterprise.sso.deleteConfirm", "Delete provider")}
				isPending={removal.isPending}
				error={removal.error}
				onConfirm={handleDelete}
			/>
		</div>
	);
}
