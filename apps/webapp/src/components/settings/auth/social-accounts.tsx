"use client";

import { IconCheck, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { queryKeys } from "@/lib/query/keys";
import { SOCIAL_PROVIDERS, type SocialProviderId } from "@/lib/social-providers";

/**
 * A linked sign-in account of the current user. The provider's subject id
 * (`accountId`) is deliberately not read: it is an opaque identifier, not
 * something the user recognizes, and it stays out of the UI.
 */
interface ConnectedAccount {
	id: string;
	providerId: string;
	createdAt: Date | string | null | undefined;
}

/** The day an account was linked, in the reader's language and time zone; null when unknown. */
function formatConnectedOn(
	createdAt: ConnectedAccount["createdAt"],
	locale: string,
	timezone: string,
): string | null {
	if (!createdAt) return null;
	try {
		// The auth client hands back a Date or an ISO string; convert at this boundary.
		const instant = instantFromDate(createdAt instanceof Date ? createdAt : new Date(createdAt));
		return formatInstant(instant, { locale, timezone, timeFormat: "24h" }, "dateMedium");
	} catch {
		return null;
	}
}

interface SocialAccountsProps {
	enabledProviderIds: SocialProviderId[];
}

export function SocialAccounts({ enabledProviderIds }: SocialAccountsProps) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const timezone = useUserTimezone();
	const queryClient = useQueryClient();
	const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
	const [accountToUnlink, setAccountToUnlink] = useState<{
		accountRowId: string;
		providerName: string;
	} | null>(null);
	const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

	// Query for connected accounts
	const accountsQuery = useQuery({
		queryKey: queryKeys.auth.accounts(),
		queryFn: async () => {
			const result = await authClient.listAccounts();
			if (result.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						t("settings.socialAccounts.loadFailed", "Failed to load connected accounts"),
					),
				);
			}
			return (result.data || []) as ConnectedAccount[];
		},
		staleTime: 30 * 1000, // 30 seconds
	});

	// Mutation for unlinking an account
	const unlinkMutation = useMutation({
		mutationFn: async ({ accountRowId }: { accountRowId: string }) => {
			const result = await authClient.unlinkAccount({ accountId: accountRowId });
			if (result.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						t("settings.socialAccounts.disconnectFailed", "Failed to disconnect account"),
					),
				);
			}
			return result;
		},
		onSuccess: () => {
			toast.success(
				t("settings.socialAccounts.disconnectSuccess", "Account disconnected successfully"),
			);
			setUnlinkDialogOpen(false);
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.accounts() });
		},
		// A failure is shown inside the confirmation dialog, which stays open for a retry.
	});

	const handleConnect = (providerId: SocialProviderId) => {
		setConnectingProvider(providerId);

		void authClient
			.linkSocial({
				provider: providerId,
				callbackURL: "/settings/security",
			})
			.then((result) => {
				if (result.error) {
					throw new Error(
						getAuthErrorMessage(
							result.error,
							t("settings.socialAccounts.connectFailed", "Failed to connect account"),
						),
					);
				}
			})
			.catch((error: unknown) => {
				setConnectingProvider(null);
				toast.error(t("settings.socialAccounts.connectFailed", "Failed to connect account"), {
					description:
						error instanceof Error
							? error.message
							: t("settings.socialAccounts.unexpectedError", "An unexpected error occurred"),
				});
			});
	};

	const handleUnlink = () => {
		if (!accountToUnlink || unlinkMutation.isPending) return;
		unlinkMutation.mutate({ accountRowId: accountToUnlink.accountRowId });
	};

	const confirmUnlink = (accountRowId: string, providerName: string) => {
		if (unlinkMutation.isPending) return;
		unlinkMutation.reset();
		setAccountToUnlink({ accountRowId, providerName });
		setUnlinkDialogOpen(true);
	};

	const accounts = accountsQuery.data || [];
	const isPending = accountsQuery.isLoading || unlinkMutation.isPending;
	const visibleProviderIds = new Set([
		...enabledProviderIds,
		...accounts.map((account) => account.providerId as SocialProviderId),
	]);
	const visibleProviders = SOCIAL_PROVIDERS.filter((provider) =>
		visibleProviderIds.has(provider.id),
	);

	const getConnectedAccount = (providerId: string) => {
		return accounts.find((account) => account.providerId === providerId);
	};

	// Nothing to link or unlink: no provider is configured and none is connected.
	if (visibleProviders.length === 0 && !accountsQuery.isError) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle as="h2">{t("settings.socialAccounts.title", "Social Accounts")}</CardTitle>
				<CardDescription>
					{t("settings.socialAccounts.description", "Link your social accounts for easier sign-in")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{accountsQuery.isError && !accountsQuery.data ? (
					<div className="flex flex-col items-start gap-3">
						<p className="text-sm" role="alert">
							{t("settings.socialAccounts.loadFailed", "Failed to load connected accounts")}
						</p>
						<Button
							variant="outline"
							onClick={() => void accountsQuery.refetch()}
							disabled={accountsQuery.isFetching}
						>
							<IconRefresh className="size-4" aria-hidden="true" />
							{t("common.retry", "Retry")}
						</Button>
					</div>
				) : (
					<ul className="divide-y rounded-lg border">
						{visibleProviders.map((provider) => {
							const connectedAccount = getConnectedAccount(provider.id);
							const isConnected = Boolean(connectedAccount);
							const Icon = provider.icon;
							const connectedOn = connectedAccount
								? formatConnectedOn(connectedAccount.createdAt, locale, timezone)
								: null;
							const statusText =
								isConnected && connectedAccount
									? connectedOn
										? t("settings.socialAccounts.connectedOn", "Connected on {date}", {
												date: connectedOn,
											})
										: t("settings.socialAccounts.linkedForSignIn", "Linked for sign-in")
									: t(
											"settings.socialAccounts.connectProvider",
											"Connect your {provider} account",
											{
												provider: provider.name,
											},
										);

							return (
								<li
									key={provider.id}
									className="flex flex-wrap items-center justify-between gap-3 p-4"
								>
									<div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
										<div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
											<Icon aria-hidden="true" className="size-5" />
										</div>
										<div className="min-w-0">
											<p className="truncate font-medium">{provider.name}</p>
											<p className="truncate text-sm text-muted-foreground" title={statusText}>
												{statusText}
											</p>
										</div>
									</div>
									<div className="flex flex-wrap items-center gap-2">
										{isConnected && connectedAccount ? (
											<>
												<Badge variant="secondary">
													<IconCheck aria-hidden="true" />
													{t("settings.socialAccounts.connected", "Connected")}
												</Badge>
												<Button
													variant="outline"
													size="sm"
													onClick={() => confirmUnlink(connectedAccount.id, provider.name)}
													disabled={isPending}
												>
													{t("settings.socialAccounts.disconnect", "Disconnect")}
												</Button>
											</>
										) : (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleConnect(provider.id)}
												disabled={isPending || connectingProvider === provider.id}
											>
												{connectingProvider === provider.id
													? t("settings.socialAccounts.connecting", "Connecting…")
													: t("settings.socialAccounts.connect", "Connect")}
											</Button>
										)}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</CardContent>

			{/* Unlink Confirmation Dialog */}
			<ConfirmActionDialog
				open={unlinkDialogOpen}
				onOpenChange={setUnlinkDialogOpen}
				title={t("settings.socialAccounts.disconnectProviderTitle", "Disconnect {provider}?", {
					provider: accountToUnlink?.providerName ?? "",
				})}
				description={t(
					"settings.socialAccounts.disconnectDescription",
					"This will remove the link to your social account. You can reconnect it at any time.",
				)}
				confirmLabel={t("settings.socialAccounts.disconnect", "Disconnect")}
				isPending={unlinkMutation.isPending}
				error={
					unlinkMutation.isError
						? unlinkMutation.error.message ||
							t("settings.socialAccounts.disconnectFailed", "Failed to disconnect account")
						: null
				}
				onConfirm={handleUnlink}
			/>
		</Card>
	);
}
