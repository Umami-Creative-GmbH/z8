"use client";

import {
	IconCheck,
	IconCopy,
	IconKey,
	IconLoader2,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { memo, useCallback, useState } from "react";
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
import { Card, CardContent } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
	listApiKeys,
	deleteApiKey,
} from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import type { ApiKeyResponse, CreateApiKeyResponse } from "@/lib/validations/api-key";
import { MAX_API_KEYS_PER_ORG } from "@/lib/validations/api-key";
import dynamic from "next/dynamic";

// Dynamically import dialogs - they're only shown on user interaction
const ApiKeyCreateDialog = dynamic(() =>
	import("./api-key-create-dialog").then((mod) => mod.ApiKeyCreateDialog),
);
const ApiKeyShowDialog = dynamic(() =>
	import("./api-key-show-dialog").then((mod) => mod.ApiKeyShowDialog),
);
const ApiKeyEditDialog = dynamic(() =>
	import("./api-key-edit-dialog").then((mod) => mod.ApiKeyEditDialog),
);

interface ApiKeyPageClientProps {
	organizationId: string;
	initialApiKeys: ApiKeyResponse[];
	currentUserId: string;
}

export function ApiKeyPageClient({
	organizationId,
	initialApiKeys,
	currentUserId,
}: ApiKeyPageClientProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editingKey, setEditingKey] = useState<ApiKeyResponse | null>(null);
	const [deleteDialogKey, setDeleteDialogKey] = useState<ApiKeyResponse | null>(null);
	const [newlyCreatedKey, setNewlyCreatedKey] = useState<CreateApiKeyResponse | null>(null);
	const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);

	// Query for API keys
	const { data: apiKeysResult, isLoading } = useQuery({
		queryKey: ["apiKeys", organizationId],
		queryFn: () => listApiKeys(organizationId),
		initialData: { success: true, data: initialApiKeys },
	});

	const apiKeys = apiKeysResult?.success ? apiKeysResult.data : [];
	const keyCount = apiKeys.length;
	const canCreateMore = keyCount < MAX_API_KEYS_PER_ORG;

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: async (keyId: string) => {
			const result = await deleteApiKey(organizationId, keyId);
			if (!result.success) throw new Error(result.error || "Failed to delete");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["apiKeys", organizationId] });
			toast.success(t("settings.apiKeys.deleted", "API key deleted"));
			setDeleteDialogKey(null);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const handleCopyPrefix = async (prefix: string, keyId: string) => {
		await navigator.clipboard.writeText(prefix);
		setCopiedKeyId(keyId);
		toast.success(t("settings.apiKeys.prefixCopied", "Key prefix copied"));
		setTimeout(() => setCopiedKeyId(null), 2000);
	};

	const handleKeyCreated = (key: CreateApiKeyResponse) => {
		setNewlyCreatedKey(key);
		setCreateDialogOpen(false);
		queryClient.invalidateQueries({ queryKey: ["apiKeys", organizationId] });
	};

	const formatDate = (dateStr: string | null | undefined) => {
		if (!dateStr) return "-";
		return DateTime.fromISO(dateStr).toLocaleString(DateTime.DATE_SHORT);
	};

	const formatScopes = (scopes: string[]) => {
		if (scopes.length === 0) return "No permissions";
		if (scopes.length <= 2) return scopes.join(", ");
		return `${scopes.slice(0, 2).join(", ")} +${scopes.length - 2}`;
	};

	const getExpirationStatus = (expiresAt: string | null) => {
		if (!expiresAt)
			return { status: "never", label: "Never expires", variant: "secondary" as const };

		const now = DateTime.now();
		const expiry = DateTime.fromISO(expiresAt);
		const daysUntilExpiry = Math.ceil(expiry.diff(now, "days").days);

		if (daysUntilExpiry < 0) {
			return { status: "expired", label: "Expired", variant: "destructive" as const };
		}
		if (daysUntilExpiry <= 7) {
			return {
				status: "expiring",
				label: `Expires in ${daysUntilExpiry}d`,
				variant: "warning" as const,
			};
		}
		return { status: "active", label: formatDate(expiresAt), variant: "secondary" as const };
	};

	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl">
				<div className="mb-6 flex items-start justify-between">
					<div>
						<h1 className="text-2xl font-semibold">
							{t("settings.apiKeys.title", "API Keys")}
						</h1>
						<p className="text-muted-foreground">
							{t(
								"settings.apiKeys.description",
								"Create and manage API keys for programmatic access to your organization data.",
							)}
						</p>
						<p className="mt-1 text-sm text-muted-foreground">
							{t("settings.apiKeys.usage", "{count} of {max} keys used", {
								count: keyCount,
								max: MAX_API_KEYS_PER_ORG,
							})}
						</p>
					</div>
					<Button onClick={() => setCreateDialogOpen(true)} disabled={!canCreateMore}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.apiKeys.create", "Create Key")}
					</Button>
				</div>
					<div className="space-y-6">
					<Card>
						<CardContent className="pt-6">
						{isLoading ? (
							<div className="flex items-center justify-center py-8">
								<IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
							</div>
						) : apiKeys.length === 0 ? (
							<div className="text-center py-12">
								<IconKey className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
								<h3 className="text-lg font-medium mb-2">
									{t("settings.apiKeys.empty.title", "No API Keys")}
								</h3>
								<p className="text-muted-foreground mb-4">
									{t(
										"settings.apiKeys.empty.description",
										"Create your first API key to enable programmatic access to your organization.",
									)}
								</p>
								<Button onClick={() => setCreateDialogOpen(true)}>
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.apiKeys.create", "Create Key")}
								</Button>
							</div>
						) : (
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("settings.apiKeys.name", "Name")}</TableHead>
										<TableHead>{t("settings.apiKeys.prefix", "Key Prefix")}</TableHead>
										<TableHead>{t("settings.apiKeys.scopes", "Permissions")}</TableHead>
										<TableHead>{t("settings.apiKeys.expires", "Expires")}</TableHead>
										<TableHead>{t("settings.apiKeys.lastUsed", "Last Used")}</TableHead>
										<TableHead>{t("settings.apiKeys.status", "Status")}</TableHead>
										<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{apiKeys.map((apiKey) => {
										const expStatus = getExpirationStatus(apiKey.expiresAt);
										return (
											<TableRow key={apiKey.id}>
												<TableCell>
													<div className="font-medium">{apiKey.name}</div>
													<div className="text-xs text-muted-foreground">
														{t("settings.apiKeys.createdOn", "Created {date}", {
															date: formatDate(apiKey.createdAt),
														})}
													</div>
												</TableCell>
												<TableCell>
													<div className="flex items-center gap-2">
														<code className="font-mono text-sm bg-muted px-2 py-1 rounded">
															{apiKey.prefix || "z8_org_***"}
														</code>
														<Tooltip>
															<TooltipTrigger asChild>
																<Button
																	variant="ghost"
																	size="sm"
																	className="h-6 w-6 p-0"
																	onClick={() => handleCopyPrefix(apiKey.prefix || "", apiKey.id)}
																>
																	{copiedKeyId === apiKey.id ? (
																		<IconCheck className="h-4 w-4 text-green-600" />
																	) : (
																		<IconCopy className="h-4 w-4" />
																	)}
																</Button>
															</TooltipTrigger>
															<TooltipContent>
																{t("settings.apiKeys.copyPrefix", "Copy prefix")}
															</TooltipContent>
														</Tooltip>
													</div>
												</TableCell>
												<TableCell>
													<Tooltip>
														<TooltipTrigger>
															<span className="text-sm">{formatScopes(apiKey.scopes)}</span>
														</TooltipTrigger>
														<TooltipContent>
															<div className="space-y-1">
																{apiKey.scopes.map((scope) => (
																	<div key={scope}>{scope}</div>
																))}
															</div>
														</TooltipContent>
													</Tooltip>
												</TableCell>
												<TableCell>
													<Badge
														variant={
															expStatus.variant as
																| "default"
																| "secondary"
																| "destructive"
																| "outline"
														}
													>
														{expStatus.label}
													</Badge>
												</TableCell>
												<TableCell>
													{apiKey.lastRequest ? formatDate(apiKey.lastRequest) : "-"}
												</TableCell>
												<TableCell>
													<Badge variant={apiKey.enabled ? "default" : "secondary"}>
														{apiKey.enabled
															? t("settings.apiKeys.active", "Active")
															: t("settings.apiKeys.disabled", "Disabled")}
													</Badge>
												</TableCell>
												<TableCell className="text-right">
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																aria-label={t("common.moreActions", "More actions")}
															>
																•••
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => setEditingKey(apiKey)}>
																{t("common.edit", "Edit")}
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() => setDeleteDialogKey(apiKey)}
																className="text-destructive"
															>
																{t("common.delete", "Delete")}
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						)}
					</CardContent>
				</Card>

				{/* Security Notice */}
				<Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
					<CardContent>
						<div className="flex gap-3">
							<IconKey className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
							<div>
								<h4 className="font-medium text-amber-800 dark:text-amber-200">
									{t("settings.apiKeys.security.title", "Security Notice")}
								</h4>
								<p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
									{t(
										"settings.apiKeys.security.description",
										"API keys provide full access to your organization data within their permission scope. Keep them secure and never share them in public repositories or client-side code.",
									)}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
				</div>
			</div>

			{/* Create Dialog */}
			<ApiKeyCreateDialog
				organizationId={organizationId}
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onKeyCreated={handleKeyCreated}
			/>

			{/* Show Key Dialog (after creation) */}
			<ApiKeyShowDialog
				apiKey={newlyCreatedKey}
				open={!!newlyCreatedKey}
				onOpenChange={(open) => !open && setNewlyCreatedKey(null)}
			/>

			{/* Edit Dialog */}
			<ApiKeyEditDialog
				organizationId={organizationId}
				apiKey={editingKey}
				open={!!editingKey}
				onOpenChange={(open) => !open && setEditingKey(null)}
			/>

			{/* Delete Confirmation Dialog */}
			<AlertDialog
				open={!!deleteDialogKey}
				onOpenChange={(open) => !open && setDeleteDialogKey(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.apiKeys.deleteTitle", "Delete API Key")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.apiKeys.deleteDescription",
								'Are you sure you want to delete the API key "{name}"? Any applications using this key will immediately lose access. This action cannot be undone.',
								{ name: deleteDialogKey?.name || "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteDialogKey && deleteMutation.mutate(deleteDialogKey.id)}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteMutation.isPending ? (
								<IconLoader2 className="h-4 w-4 animate-spin mr-2" />
							) : (
								<IconTrash className="h-4 w-4 mr-2" />
							)}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
