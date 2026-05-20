"use client";

import { IconCheck, IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteSocialOAuthConfigAction,
	type SocialOAuthConfigResponse,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import type { SocialOAuthProvider } from "@/db/schema";
import { Apple } from "@/components/ui/svgs/apple";
import { GithubDark } from "@/components/ui/svgs/githubDark";
import { Google } from "@/components/ui/svgs/google";
import { Linkedin } from "@/components/ui/svgs/linkedin";
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
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { SocialOAuthDialog } from "./social-oauth-dialog";

interface SocialOAuthManagementProps {
	initialConfigs: SocialOAuthConfigResponse[];
}

const PROVIDER_INFO: Record<SocialOAuthProvider, { name: string; icon: typeof Google }> = {
	google: { name: "Google", icon: Google },
	github: { name: "GitHub", icon: GithubDark },
	linkedin: { name: "LinkedIn", icon: Linkedin },
	apple: { name: "Apple", icon: Apple },
};

export function SocialOAuthManagement({ initialConfigs }: SocialOAuthManagementProps) {
	const { t } = useTranslate();
	const [configs, setConfigs] = useState<SocialOAuthConfigResponse[]>(initialConfigs);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [editConfig, setEditConfig] = useState<SocialOAuthConfigResponse | null>(null);
	const [deleteDialog, setDeleteDialog] = useState<{
		isOpen: boolean;
		config: SocialOAuthConfigResponse | null;
	}>({ isOpen: false, config: null });

	// Determine which providers are already configured
	const configuredProviders = configs.map((c) => c.provider);
	const availableProviders = (Object.keys(PROVIDER_INFO) as SocialOAuthProvider[]).filter(
		(p) => !configuredProviders.includes(p),
	);

	const handleConfigAdded = (newConfig: SocialOAuthConfigResponse) => {
		setConfigs((prev) => [...prev, newConfig]);
		setIsAddDialogOpen(false);
		toast.success(t("settings.enterprise.socialOAuth.configured", "{provider} OAuth configured successfully", { provider: PROVIDER_INFO[newConfig.provider].name }));
	};

	const handleConfigUpdated = (updatedConfig: SocialOAuthConfigResponse) => {
		setConfigs((prev) => prev.map((c) => (c.id === updatedConfig.id ? updatedConfig : c)));
		setEditConfig(null);
		toast.success(t("settings.enterprise.socialOAuth.updated", "{provider} OAuth updated successfully", { provider: PROVIDER_INFO[updatedConfig.provider].name }));
	};

	const handleDelete = async () => {
		if (!deleteDialog.config) return;
		const configToDelete = deleteDialog.config;

		await deleteSocialOAuthConfigAction(configToDelete.id)
			.then(() => {
				setConfigs((prev) => prev.filter((c) => c.id !== configToDelete.id));
				toast.success(t("settings.enterprise.socialOAuth.removed", "{provider} OAuth removed", { provider: PROVIDER_INFO[configToDelete.provider].name }));
			})
			.catch(() => {
				toast.error(t("settings.enterprise.socialOAuth.deleteError", "Failed to delete OAuth config"));
			});

		setDeleteDialog({ isOpen: false, config: null });
	};

	const formatDate = (date: Date | null) => {
		if (!date) return t("common.never", "Never");
		return new Date(date).toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-center justify-between">
					<div>
						<CardTitle>{t("settings.enterprise.socialOAuth.title", "Social Login Providers")}</CardTitle>
						<CardDescription>
							{t("settings.enterprise.socialOAuth.description", "Configure your own OAuth credentials for social login. This allows your users to sign in using your organization's OAuth apps instead of shared credentials.")}
						</CardDescription>
					</div>
					{availableProviders.length > 0 && (
						<Button onClick={() => setIsAddDialogOpen(true)}>
							<IconPlus className="mr-2 size-4" />
							{t("settings.enterprise.addProvider", "Add Provider")}
						</Button>
					)}
				</CardHeader>
				<CardContent>
					{configs.length === 0 ? (
						<div className="text-center py-8 text-muted-foreground">
						<p>{t("settings.enterprise.socialOAuth.empty", "No custom social OAuth providers configured.")}</p>
						<p className="text-sm">
							{t("settings.enterprise.socialOAuth.emptyDescription", "Add your own OAuth credentials to replace the shared credentials.")}
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
							<TableHead>{t("settings.enterprise.provider", "Provider")}</TableHead>
							<TableHead>{t("settings.enterprise.clientId", "Client ID")}</TableHead>
							<TableHead>{t("common.status", "Status")}</TableHead>
							<TableHead>{t("settings.enterprise.socialOAuth.lastTested", "Last Tested")}</TableHead>
							<TableHead>{t("common.active", "Active")}</TableHead>
							<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{configs.map((config) => {
									const provider = PROVIDER_INFO[config.provider];
									return (
										<TableRow key={config.id}>
											<TableCell className="font-medium">
												<div className="flex items-center gap-2">
													<provider.icon className="size-5" />
													{provider.name}
												</div>
											</TableCell>
											<TableCell>
												<code className="text-sm bg-muted px-1 py-0.5 rounded">
													{config.clientId.slice(0, 16)}...
												</code>
											</TableCell>
											<TableCell>
												{config.lastTestSuccess === null ? (
								<Badge variant="secondary">{t("settings.enterprise.socialOAuth.notTested", "Not Tested")}</Badge>
												) : config.lastTestSuccess ? (
													<Badge variant="default" className="bg-green-600">
														<IconCheck className="mr-1 size-3" />
								{t("settings.enterprise.socialOAuth.working", "Working")}
													</Badge>
												) : (
													<Badge variant="destructive">
														<IconX className="mr-1 size-3" />
								{t("common.error", "Error")}
													</Badge>
												)}
											</TableCell>
											<TableCell className="text-muted-foreground text-sm">
												{formatDate(config.lastTestAt)}
											</TableCell>
											<TableCell>
												<Switch
													checked={config.isActive}
													disabled
								aria-label={config.isActive ? t("common.active", "Active") : t("common.inactive", "Inactive")}
												/>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-2">
													<Button variant="outline" size="sm" onClick={() => setEditConfig(config)}>
														<IconPencil className="size-4" />
													</Button>
													<Button
														variant="outline"
														size="sm"
														onClick={() => setDeleteDialog({ isOpen: true, config })}
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
			<h3 className="font-medium mb-2">{t("settings.enterprise.socialOAuth.howItWorks", "How it Works")}</h3>
				<ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
				<li>{t("settings.enterprise.socialOAuth.instructions.createApp", "Create an OAuth app in the provider's developer console")}</li>
				<li>
					{t("settings.enterprise.configureCallbackUrl", "Configure the callback URL:")}{" "}
						<code className="bg-background px-1 rounded">
							{typeof window !== "undefined"
								? `${window.location.origin}/api/auth/callback/social-org/[provider]`
								: "/api/auth/callback/social-org/[provider]"}
						</code>
					</li>
				<li>{t("settings.enterprise.socialOAuth.instructions.copyCredentials", "Copy the Client ID and Client Secret")}</li>
				<li>{t("settings.enterprise.socialOAuth.instructions.addProvider", "Add the provider here with your credentials")}</li>
				<li>{t("settings.enterprise.socialOAuth.instructions.customDomain", "Users signing in via your custom domain will use your OAuth app")}</li>
				</ol>
			</div>

			<SocialOAuthDialog
				open={isAddDialogOpen}
				onOpenChange={setIsAddDialogOpen}
				availableProviders={availableProviders}
				onConfigAdded={handleConfigAdded}
			/>

			{editConfig && (
				<SocialOAuthDialog
					open={true}
					onOpenChange={(open) => !open && setEditConfig(null)}
					editConfig={editConfig}
					onConfigUpdated={handleConfigUpdated}
				/>
			)}

			<AlertDialog
				open={deleteDialog.isOpen}
				onOpenChange={(open) => setDeleteDialog({ isOpen: open, config: deleteDialog.config })}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("settings.enterprise.socialOAuth.removeDialogTitle", "Remove Social OAuth Provider")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings.enterprise.socialOAuth.removeDialogDescription", "Are you sure you want to remove this OAuth configuration? Users will fall back to the shared OAuth credentials (if available).")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.remove", "Remove")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
