"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppleIcon, GitHubIcon, GoogleIcon, LinkedInIcon } from "@/components/icons/provider-icons";
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
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";

interface ConnectedAccount {
	id: string;
	providerId: string;
	accountId: string;
	createdAt: Date;
}

interface Provider {
	id: string;
	name: string;
	icon: React.ComponentType<{ className?: string }>;
}

const providers: Provider[] = [
	{
		id: "google",
		name: "Google",
		icon: GoogleIcon,
	},
	{
		id: "github",
		name: "GitHub",
		icon: GitHubIcon,
	},
	{
		id: "linkedin",
		name: "LinkedIn",
		icon: LinkedInIcon,
	},
	{
		id: "apple",
		name: "Apple",
		icon: AppleIcon,
	},
];

export function SocialAccounts() {
	const queryClient = useQueryClient();
	const [unlinkDialogOpen, setUnlinkDialogOpen] = useState(false);
	const [accountToUnlink, setAccountToUnlink] = useState<{
		providerId: string;
		accountId: string;
	} | null>(null);
	const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

	// Query for connected accounts
	const accountsQuery = useQuery({
		queryKey: queryKeys.auth.accounts(),
		queryFn: async () => {
			const result = await authClient.listAccounts();
			if (result.error) {
				throw new Error(result.error.message);
			}
			return (result.data || []) as ConnectedAccount[];
		},
		staleTime: 30 * 1000, // 30 seconds
	});

	// Mutation for unlinking an account
	const unlinkMutation = useMutation({
		mutationFn: async ({ providerId, accountId }: { providerId: string; accountId: string }) => {
			const result = await authClient.unlinkAccount({ providerId, accountId });
			if (result.error) {
				throw new Error(result.error.message);
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Account disconnected successfully");
			setUnlinkDialogOpen(false);
			setAccountToUnlink(null);
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.accounts() });
		},
		onError: (error) => {
			toast.error("Failed to disconnect account", {
				description: error instanceof Error ? error.message : "An unexpected error occurred",
			});
		},
	});

	const handleConnect = (providerId: string) => {
		setConnectingProvider(providerId);
		// Redirect to OAuth flow
		const callbackUrl = encodeURIComponent("/settings/security");
		window.location.href = `/api/auth/signin/${providerId}?callbackUrl=${callbackUrl}`;
	};

	const handleUnlink = () => {
		if (!accountToUnlink) return;
		unlinkMutation.mutate(accountToUnlink);
	};

	const confirmUnlink = (providerId: string, accountId: string) => {
		setAccountToUnlink({ providerId, accountId });
		setUnlinkDialogOpen(true);
	};

	const accounts = accountsQuery.data || [];
	const isPending = accountsQuery.isLoading || unlinkMutation.isPending;

	const getConnectedAccount = (providerId: string) => {
		return accounts.find((account) => account.providerId === providerId);
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Social Accounts</h3>
				<p className="text-sm text-muted-foreground">
					Link your social accounts for easier sign-in
				</p>
			</div>

			<div className="space-y-2">
				{providers.map((provider) => {
					const connectedAccount = getConnectedAccount(provider.id);
					const isConnected = Boolean(connectedAccount);
					const Icon = provider.icon;

					return (
						<Card key={provider.id}>
							<CardHeader className="pb-3">
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
											<Icon className="h-5 w-5" />
										</div>
										<div>
											<CardTitle className="text-base">{provider.name}</CardTitle>
											<CardDescription>
												{isConnected && connectedAccount
													? `Connected as ${connectedAccount.accountId}`
													: `Connect your ${provider.name} account`}
											</CardDescription>
										</div>
									</div>
									<div className="flex items-center gap-2">
										{isConnected && connectedAccount ? (
											<>
												<Badge variant="default">Connected</Badge>
												<Button
													variant="outline"
													size="sm"
													onClick={() =>
														confirmUnlink(connectedAccount.providerId, connectedAccount.id)
													}
													disabled={isPending}
												>
													Disconnect
												</Button>
											</>
										) : (
											<Button
												variant="outline"
												size="sm"
												onClick={() => handleConnect(provider.id)}
												disabled={isPending || connectingProvider === provider.id}
											>
												{connectingProvider === provider.id ? "Connecting..." : "Connect"}
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
						<AlertDialogTitle>Disconnect Account?</AlertDialogTitle>
						<AlertDialogDescription>
							This will remove the link to your social account. You can reconnect it at any time.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={unlinkMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleUnlink}
							disabled={unlinkMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Disconnect
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
