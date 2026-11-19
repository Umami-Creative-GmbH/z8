"use client";

import { IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteSocialOAuthConfigAction,
	type SocialOAuthConfigResponse,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import { actionData, enterpriseErrorMessage } from "@/components/settings/enterprise/action-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Apple } from "@/components/ui/svgs/apple";
import { GithubDark } from "@/components/ui/svgs/githubDark";
import { Google } from "@/components/ui/svgs/google";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { SocialOAuthProvider } from "@/db/schema";
import { useServerDataState } from "@/hooks/use-server-data-state";
import {
	EnterpriseDeleteConfirmDialog,
	useConfirmedRemoval,
} from "./enterprise-delete-confirm-dialog";
import { SocialOAuthDialog } from "./social-oauth-dialog";

interface SocialOAuthManagementProps {
	initialConfigs: SocialOAuthConfigResponse[];
	callbackBaseUrl: string;
}

const PROVIDER_INFO: Record<SocialOAuthProvider, { name: string; icon: typeof Google }> = {
	google: { name: "Google", icon: Google },
	github: { name: "GitHub", icon: GithubDark },
	linkedin: { name: "LinkedIn", icon: Linkedin },
	apple: { name: "Apple", icon: Apple },
};

export function SocialOAuthManagement({
	initialConfigs,
	callbackBaseUrl,
}: SocialOAuthManagementProps) {
	const { t } = useTranslate();
	const [configs, setConfigs] = useServerDataState<SocialOAuthConfigResponse[]>(initialConfigs);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [editConfig, setEditConfig] = useState<SocialOAuthConfigResponse | null>(null);
	const removal = useConfirmedRemoval<SocialOAuthConfigResponse>();

	// Determine which providers are already configured
	const configuredProviders = new Set(configs.map((c) => c.provider));
	const availableProviders = (Object.keys(PROVIDER_INFO) as SocialOAuthProvider[]).filter(
		(p) => !configuredProviders.has(p),
	);

	const handleConfigAdded = (newConfig: SocialOAuthConfigResponse) => {
		setConfigs((prev) => [...prev, newConfig]);
		setIsAddDialogOpen(false);
		toast.success(
			t("settings.enterprise.socialOAuth.configured", "{provider} OAuth configured successfully", {
				provider: PROVIDER_INFO[newConfig.provider].name,
			}),
		);
	};

	const handleConfigUpdated = (updatedConfig: SocialOAuthConfigResponse) => {
		setConfigs((prev) => prev.map((c) => (c.id === updatedConfig.id ? updatedConfig : c)));
		setEditConfig(null);
		toast.success(
			t("settings.enterprise.socialOAuth.updated", "{provider} OAuth updated successfully", {
				provider: PROVIDER_INFO[updatedConfig.provider].name,
			}),
		);
	};

	const handleDelete = () =>
		removal.confirm(
			async (configToDelete) => {
				await actionData(deleteSocialOAuthConfigAction({ configId: configToDelete.id }));
				setConfigs((prev) => prev.filter((c) => c.id !== configToDelete.id));
				toast.success(
					t("settings.enterprise.socialOAuth.removed", "{provider} OAuth removed", {
						provider: PROVIDER_INFO[configToDelete.provider].name,
					}),
				);
			},
			(error) =>
				enterpriseErrorMessage(t, error, [
					"settings.enterprise.socialOAuth.deleteError",
					"Failed to delete OAuth config",
				]),
		);

	const callbackUrl = `${callbackBaseUrl.replace(/\/$/, "")}/api/auth/callback/social-org/[provider]`;
	const columns = [
		{ id: "provider", label: t("settings.enterprise.provider", "Provider") },
		{ id: "clientId", label: t("settings.enterprise.clientId", "Client ID") },
		{
			id: "authentication",
			label: t(
				"settings/enterprise:settings.enterprise.socialOAuth.authentication",
				"Authentication",
			),
		},
		{ id: "active", label: t("common.active", "Active") },
		{ id: "actions", label: t("common.actions", "Actions"), className: "text-right" },
	];

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.enterprise.socialOAuth.title", "Social Login Providers")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.enterprise.socialOAuth.description",
							"Configure your own OAuth credentials for social login. This allows your users to sign in using your organization's OAuth apps instead of shared credentials.",
						)}
					</CardDescription>
					{availableProviders.length > 0 && (
						<CardAction>
							<Button onClick={() => setIsAddDialogOpen(true)}>
								<IconPlus className="size-4" aria-hidden="true" />
								{t("settings.enterprise.addProvider", "Add Provider")}
							</Button>
						</CardAction>
					)}
				</CardHeader>
				<CardContent>
					{configs.length === 0 ? (
						<div className="rounded-lg border border-dashed p-4 text-sm">
							<p className="font-medium">
								{t(
									"settings.enterprise.socialOAuth.empty",
									"No custom social OAuth providers configured.",
								)}
							</p>
							<p className="text-muted-foreground">
								{t(
									"settings.enterprise.socialOAuth.emptyDescription",
									"Add your own OAuth credentials to replace the shared credentials.",
								)}
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									{columns.map((column) => (
										<TableHead key={column.id} className={column.className}>
											{column.label}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{configs.map((config) => {
									const provider = PROVIDER_INFO[config.provider];
									return (
										<TableRow key={config.id}>
											<TableCell className="font-medium">
												<div className="flex items-center gap-2">
													<provider.icon className="size-5 shrink-0" aria-hidden="true" />
													{provider.name}
												</div>
											</TableCell>
											<TableCell>
												<code
													className="text-sm bg-muted px-1 py-0.5 rounded"
													title={config.clientId}
												>
													{config.clientId.length > 16
														? `${config.clientId.slice(0, 16)}…`
														: config.clientId}
												</code>
											</TableCell>
											<TableCell>
												<Badge variant="secondary">
													{t(
														"settings/enterprise:settings.enterprise.socialOAuth.unverified",
														"Unverified",
													)}
												</Badge>
											</TableCell>
											<TableCell>
												<Switch
													checked={config.isActive}
													disabled
													aria-label={
														config.isActive
															? t("common.active", "Active")
															: t("common.inactive", "Inactive")
													}
												/>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex flex-wrap justify-end gap-2">
													<Button
														variant="outline"
														size="sm"
														aria-label={t(
															"settings.enterprise.socialOAuth.editAria",
															"Edit {provider} sign-in",
															{ provider: provider.name },
														)}
														onClick={() => setEditConfig(config)}
													>
														<IconPencil className="size-4" aria-hidden="true" />
													</Button>
													<Button
														variant="outline"
														size="sm"
														aria-label={t(
															"settings.enterprise.socialOAuth.removeAria",
															"Remove {provider} sign-in",
															{ provider: provider.name },
														)}
														onClick={() => removal.request(config)}
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
					)}
				</CardContent>
			</Card>

			<section className="rounded-lg border p-4">
				<h3 className="font-medium mb-2">
					{t("settings.enterprise.socialOAuth.howItWorks", "How it Works")}
				</h3>
				<ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
					<li>
						{t(
							"settings.enterprise.socialOAuth.instructions.createApp",
							"Create an OAuth app in the provider's developer console",
						)}
					</li>
					<li>
						{t("settings.enterprise.configureCallbackUrl", "Configure the callback URL:")}{" "}
						<code className="break-all rounded bg-muted px-1">{callbackUrl}</code>
					</li>
					<li>
						{t(
							"settings.enterprise.socialOAuth.instructions.copyCredentials",
							"Copy the Client ID and Client Secret",
						)}
					</li>
					<li>
						{t(
							"settings.enterprise.socialOAuth.instructions.addProvider",
							"Add the provider here with your credentials",
						)}
					</li>
					<li>
						{t(
							"settings.enterprise.socialOAuth.instructions.customDomain",
							"Users signing in via your custom domain will use your OAuth app",
						)}
					</li>
				</ol>
			</section>

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

			<EnterpriseDeleteConfirmDialog
				open={removal.open}
				onOpenChange={removal.onOpenChange}
				title={
					removal.target
						? t(
								"settings.enterprise.socialOAuth.removeDialogTitleNamed",
								"Remove {provider} sign-in?",
								{ provider: PROVIDER_INFO[removal.target.provider].name },
							)
						: t(
								"settings.enterprise.socialOAuth.removeDialogTitle",
								"Remove Social OAuth Provider",
							)
				}
				description={t(
					"settings.enterprise.socialOAuth.removeDialogDescription",
					"Are you sure you want to remove this OAuth configuration? Users will fall back to the shared OAuth credentials (if available).",
				)}
				confirmLabel={t("common.remove", "Remove")}
				isPending={removal.isPending}
				error={removal.error}
				onConfirm={handleDelete}
			/>
		</div>
	);
}
