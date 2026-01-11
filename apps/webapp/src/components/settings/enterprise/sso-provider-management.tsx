"use client";

import { IconCheck, IconExternalLink, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { deleteSSOProviderAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
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
	createdAt: Date | null;
}

interface SSOProviderManagementProps {
	initialProviders: SSOProvider[];
}

export function SSOProviderManagement({ initialProviders }: SSOProviderManagementProps) {
	const [providers, setProviders] = useState<SSOProvider[]>(initialProviders);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [deleteDialog, setDeleteDialog] = useState<{
		isOpen: boolean;
		provider: SSOProvider | null;
	}>({ isOpen: false, provider: null });

	const handleProviderAdded = (newProvider: SSOProvider) => {
		setProviders((prev) => [...prev, newProvider]);
		setIsAddDialogOpen(false);
		toast.success("SSO provider added successfully");
	};

	const handleDelete = async () => {
		if (!deleteDialog.provider) return;

		try {
			await deleteSSOProviderAction(deleteDialog.provider.id);
			setProviders((prev) => prev.filter((p) => p.id !== deleteDialog.provider?.id));
			toast.success("SSO provider deleted");
		} catch (_error) {
			toast.error("Failed to delete SSO provider");
		} finally {
			setDeleteDialog({ isOpen: false, provider: null });
		}
	};

	const getProviderDisplayName = (issuer: string) => {
		if (issuer.includes("okta")) return "Okta";
		if (issuer.includes("azure") || issuer.includes("microsoft")) return "Microsoft Entra ID";
		if (issuer.includes("google")) return "Google Workspace";
		if (issuer.includes("auth0")) return "Auth0";
		if (issuer.includes("onelogin")) return "OneLogin";
		if (issuer.includes("ping")) return "PingIdentity";
		return "OIDC Provider";
	};

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div>
						<CardTitle>Identity Providers</CardTitle>
						<CardDescription>
							Add OIDC identity providers to enable SSO for your organization.
						</CardDescription>
					</div>
					<Button onClick={() => setIsAddDialogOpen(true)}>
						<IconPlus className="mr-2 h-4 w-4" />
						Add Provider
					</Button>
				</CardHeader>
				<CardContent>
					{providers.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
							<p>No SSO providers configured yet.</p>
							<p className="text-sm">Add an OIDC provider to enable enterprise single sign-on.</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Provider</TableHead>
									<TableHead>Domain</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Issuer URL</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{providers.map((provider) => (
									<TableRow key={provider.id}>
										<TableCell className="font-medium">
											{getProviderDisplayName(provider.issuer)}
										</TableCell>
										<TableCell>{provider.domain}</TableCell>
										<TableCell>
											{provider.domainVerified ? (
												<Badge variant="default" className="bg-green-600">
													<IconCheck className="mr-1 h-3 w-3" />
													Verified
												</Badge>
											) : (
												<Badge variant="secondary">
													<IconX className="mr-1 h-3 w-3" />
													Pending
												</Badge>
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
												<IconExternalLink className="ml-1 h-3 w-3" />
											</a>
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="outline"
												size="sm"
												onClick={() => setDeleteDialog({ isOpen: true, provider })}
											>
												<IconTrash className="h-4 w-4 text-destructive" />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<div className="mt-6 p-4 bg-muted rounded-lg">
				<h3 className="font-medium mb-2">Setup Instructions</h3>
				<ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
					<li>Create an OIDC application in your identity provider (Okta, Azure AD, etc.)</li>
					<li>
						Configure the callback URL:{" "}
						<code className="bg-background px-1 rounded">
							{typeof window !== "undefined"
								? `${window.location.origin}/api/auth/callback/sso`
								: "/api/auth/callback/sso"}
						</code>
					</li>
					<li>Copy the Issuer URL, Client ID, and Client Secret from your IdP</li>
					<li>Add the provider here and verify the email domain via DNS TXT record</li>
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
						<AlertDialogTitle>Delete SSO Provider</AlertDialogTitle>
						<AlertDialogDescription>
							Are you sure you want to delete this SSO provider? Users will no longer be able to
							sign in using this identity provider.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
