"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
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
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";
import {
	SOCIAL_PROVIDERS,
	type SocialProviderId,
} from "@/lib/social-providers";

interface ConnectedAccount {
	id: string;
	providerId: string;
	accountId: string;
	createdAt: Date;
}

interface SocialAccountsProps {
	enabledProviderIds: SocialProviderId[];
}

export function SocialAccounts({ enabledProviderIds }: SocialAccountsProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
	const accountToUnlinkRef = useRef<{
		providerId: string;
		accountId: string;
	} | null>(null);
	const [connectingProvider, setConnectingProvider] = useState<string | null>(
		null,
	);

	// Query for connected accounts
	const accountsQuery = useQuery({
		queryKey: queryKeys.auth.accounts(),
		queryFn: async () => {
			const result = await authClient.listAccounts();
			if (result.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						t(
							"settings.socialAccounts.loadFailed",
							"Failed to load connected accounts",
						),
					),
				);
			}
			return (result.data || []) as ConnectedAccount[];
		},
		staleTime: 30 * 1000, // 30 seconds
	});

	// Mutation for unlinking an account
	const unlinkMutation = useMutation({
		mutationFn: async ({
			providerId,
			accountId,
		}: {
			providerId: string;
			accountId: string;
		}) => {
			const result = await authClient.unlinkAccount({ providerId, accountId });
			if (result.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						t(
							"settings.socialAccounts.disconnectFailed",
							"Failed to disconnect account",
						),
					),
				);
			}
			return result;
		},
		onSuccess: () => {
			toast.success(
				t(
					"settings.socialAccounts.disconnectSuccess",
					"Account disconnected successfully",
				),
			);
			setUnlinkDialogOpen(false);
			accountToUnlinkRef.current = null;
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.accounts() });
		},
		onError: (error) => {
			toast.error(
				t(
					"settings.socialAccounts.disconnectFailed",
					"Failed to disconnect account",
				),
				{
					description:
						error instanceof Error
							? error.message
							: t(
									"settings.socialAccounts.unexpectedError",
									"An unexpected error occurred",
								),
				},
			);
		},
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
							t(
								"settings.socialAccounts.connectFailed",
								"Failed to connect account",
							),
						),
					);
				}
			})
			.catch((error: unknown) => {
				setConnectingProvider(null);
				toast.error(
					t(
						"settings.socialAccounts.connectFailed",
						"Failed to connect account",
					),
					{
						description:
							error instanceof Error
								? error.message
								: t(
										"settings.socialAccounts.unexpectedError",
										"An unexpected error occurred",
									),
					},
				);
			});
	};

	const handleUnlink = () => {
		if (!accountToUnlinkRef.current) return;
		unlinkMutation.mutate(accountToUnlinkRef.current);
	};

	const confirmUnlink = (providerId: string, accountId: string) => {
		accountToUnlinkRef.current = { providerId, accountId };
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

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">
					{t("settings.socialAccounts.title", "Social Accounts")}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.socialAccounts.description",
						"Link your social accounts for easier sign-in",
					)}
				</p>
			</div>

			<div className="space-y-2">
				{visibleProviders.map((provider) => {
					const connectedAccount = getConnectedAccount(provider.id);
					const isConnected = Boolean(connectedAccount);
					const Icon = provider.icon;

					return (
						<Card key={provider.id}>
							<CardHeader className="pb-3">
								<div className="flex items-center justify-between">
									<div className="flex min-w-0 items-center gap-3">
										<div className="flex size-10 items-center justify-center rounded-lg bg-muted">
											<Icon aria-hidden="true" className="size-5" />
										</div>
										<div className="min-w-0">
											<CardTitle className="truncate text-base">
												{provider.name}
											</CardTitle>
											<CardDescription className="truncate">
												{isConnected && connectedAccount
													? t(
															"settings.socialAccounts.connectedAs",
															"Connected as {accountId}",
															{
																accountId: connectedAccount.accountId,
															},
														)
													: t(
															"settings.socialAccounts.connectProvider",
															"Connect your {provider} account",
															{
																provider: provider.name,
															},
														)}
											</CardDescription>
										</div>
									</div>
									<div className="flex items-center gap-2">
										{isConnected && connectedAccount ? (
											<>
												<Badge variant="default">
													{t("settings.socialAccounts.connected", "Connected")}
												</Badge>
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														confirmUnlink(
															connectedAccount.providerId,
															connectedAccount.id,
														)
													}
													disabled={isPending}
												>
													{t(
														"settings.socialAccounts.disconnect",
														"Disconnect",
													)}
												</Button>
											</>
										) : (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleConnect(provider.id)}
												disabled={
													isPending || connectingProvider === provider.id
												}
											>
												{connectingProvider === provider.id
													? t(
															"settings.socialAccounts.connecting",
															"Connecting…",
														)
													: t("settings.socialAccounts.connect", "Connect")}
											</Button>
										)}
									</div>
								</div>
							</CardHeader>
						</Card>
					);
				})}
			</div>

			{/* Unlink Confirmation Dialog */}
			<AlertDialog open={unlinkDialogOpen} onOpenChange={setUnlinkDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"settings.socialAccounts.disconnectTitle",
								"Disconnect Account?",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.socialAccounts.disconnectDescription",
								"This will remove the link to your social account. You can reconnect it at any time.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={unlinkMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleUnlink}
							disabled={unlinkMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("settings.socialAccounts.disconnect", "Disconnect")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
