"use client";

import {
	IconCheck,
	IconCopy,
	IconDownload,
	IconKey,
	IconLoader2,
	IconPlus,
	IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { deleteApiKey } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
import { useDeveloperServerSnapshot } from "@/app/[locale]/(app)/settings/enterprise/api-keys/use-developer-server-snapshot";
import { readApiKeysForView } from "@/app/[locale]/(app)/settings/enterprise/api-keys/view-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	AlertDialog,
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
import { EditDeleteMenu } from "@/components/ui/edit-delete-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ServerActionResult } from "@/lib/effect/result";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { ApiKeyResponse, CreateApiKeyResponse } from "@/lib/validations/api-key";
import { MAX_API_KEYS_PER_ORG } from "@/lib/validations/api-key";
import { Link } from "@/navigation";
import { ApiKeyDocumentation } from "./api-key-documentation";

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

function formatDate(dateStr: string | null | undefined) {
	if (!dateStr) return "-";
	return Temporal.Instant.from(dateStr).toLocaleString(undefined, {
		timeZone: "UTC",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatScopes(scopes: string[], t: ReturnType<typeof useTranslate>["t"]) {
	if (scopes.length === 0) return t("settings.apiKeys.noPermissions", "No permissions");
	if (scopes.length <= 2) return scopes.join(", ");
	return `${scopes.slice(0, 2).join(", ")} +${scopes.length - 2}`;
}

function getExpirationStatus(expiresAt: string | null, t: ReturnType<typeof useTranslate>["t"]) {
	if (!expiresAt)
		return {
			status: "never",
			label: t("settings.apiKeys.neverExpires", "Never expires"),
			variant: "secondary" as const,
		};

	const now = Temporal.Now.instant();
	const expiry = Temporal.Instant.from(expiresAt);
	const daysUntilExpiry = Math.ceil(now.until(expiry).total("hours") / 24);

	if (Temporal.Instant.compare(expiry, now) <= 0) {
		return {
			status: "expired",
			label: t("settings.apiKeys.expired", "Expired"),
			variant: "destructive" as const,
		};
	}
	if (daysUntilExpiry <= 7) {
		return {
			status: "expiring",
			label: t("settings.apiKeys.expiresInDays", "Expires in {days}d", {
				days: daysUntilExpiry,
			}),
			variant: "warning" as const,
		};
	}
	return {
		status: "active",
		label: formatDate(expiresAt),
		variant: "secondary" as const,
	};
}

interface ApiKeyPageClientProps {
	organizationId: string;
	initialApiKeys: ApiKeyResponse[];
	currentUserId: string;
	initialError?: boolean;
}

function useApiKeyPageViewModel({
	organizationId,
	initialApiKeys,
	initialError,
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
	const initialData = useDeveloperServerSnapshot({
		queryKey: ["apiKeys", organizationId, currentUserId],
		snapshot: initialApiKeys,
		initialError,
	});
	const {
		data: apiKeysResult,
		isLoading,
		isError: queryError,
		refetch,
		isFetching,
	} = useQuery<ServerActionResult<ApiKeyResponse[]>>({
		queryKey: ["apiKeys", organizationId, currentUserId],
		queryFn: async () => {
			const result = await readApiKeysForView({ organizationId, userId: currentUserId });
			if (
				!result.success &&
				result.code !== "AuthorizationError" &&
				result.code !== "AuthenticationError"
			)
				throw new Error("API keys unavailable");
			return result;
		},
		initialData,
		retry: false,
	});

	const refused = !!apiKeysResult && !apiKeysResult.success;
	const isError = queryError || refused;
	const apiKeys = apiKeysResult?.success ? apiKeysResult.data : [];
	const keyCount = apiKeys.length;
	const canCreateMore = Boolean(apiKeysResult?.success) && keyCount < MAX_API_KEYS_PER_ORG;

	const lifetime = useRef<object | null>(null);
	const pending = useRef(false);
	const [isDeleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState<string | null>(null);
	useLayoutEffect(() => {
		lifetime.current = refused ? null : {};
		pending.current = false;
		setDeleting(false);
		setNewlyCreatedKey(null);
		return () => {
			lifetime.current = null;
		};
	}, [refused]);
	const deleteMutation = {
		isPending: isDeleting,
		error: deleteError,
		mutate: async (keyId: string) => {
			if (pending.current || !lifetime.current) return;
			const owner = lifetime.current;
			pending.current = true;
			setDeleting(true);
			setDeleteError(null);
			return deleteApiKey({ keyId })
				.then((result) => {
					if (lifetime.current !== owner) return;
					if (!result.success) {
						setDeleteError(actionErrorMessage(t, result));
						return;
					}
					void queryClient.invalidateQueries({ queryKey: ["apiKeys", organizationId] });
					toast.success(t("settings.apiKeys.deleted", "API key deleted"));
					setDeleteDialogKey(null);
				})
				.catch(() => {
					if (lifetime.current === owner)
						setDeleteError(
							t(
								"settings.apiKeys.revokeUnknown",
								"Could not confirm revocation. Refresh the list before trying again.",
							),
						);
				})
				.finally(() => {
					if (lifetime.current === owner) {
						pending.current = false;
						setDeleting(false);
					}
				});
		},
	};
	const changeDeleteDialog = (key: ApiKeyResponse | null) => {
		if (pending.current) return;
		setDeleteError(null);
		setDeleteDialogKey(key);
	};

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

	return {
		apiKeys,
		canCreateMore,
		copiedKeyId,
		createDialogOpen: createDialogOpen && !refused,
		deleteDialogKey: refused ? null : deleteDialogKey,
		deleteMutation,
		editingKey: refused ? null : editingKey,
		handleCopyPrefix,
		handleKeyCreated,
		isLoading,
		isError,
		isFetching,
		refetch,
		keyCount,
		newlyCreatedKey,
		organizationId,
		setCreateDialogOpen,
		setDeleteDialogKey: changeDeleteDialog,
		setEditingKey,
		setNewlyCreatedKey,
		t,
	};
}

type ApiKeyPageViewModel = ReturnType<typeof useApiKeyPageViewModel>;

function ApiKeysCard({ viewModel }: { viewModel: ApiKeyPageViewModel }) {
	const {
		apiKeys,
		copiedKeyId,
		handleCopyPrefix,
		isLoading,
		isError,
		isFetching,
		refetch,
		setCreateDialogOpen,
		setDeleteDialogKey,
		setEditingKey,
		t,
	} = viewModel;

	return (
		<Card>
			<CardContent className="space-y-4 pt-6">
				{isError ? (
					<Alert variant="destructive">
						<AlertTitle>{t("settings.apiKeys.unavailable", "API keys unavailable")}</AlertTitle>
						<AlertDescription>
							{t(
								"settings.apiKeys.retryHelp",
								"Refresh this list to confirm the current keys. Previously loaded records are retained.",
							)}
							<Button variant="outline" disabled={isFetching} onClick={() => void refetch()}>
								{t("common.retry", "Retry")}
							</Button>
						</AlertDescription>
					</Alert>
				) : null}
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : isError && apiKeys.length === 0 ? null : apiKeys.length === 0 ? (
					<div className="text-center py-12">
						<IconKey className="size-12 mx-auto text-muted-foreground mb-4" />
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
							<IconPlus className="mr-2 size-4" />
							{t("settings.apiKeys.create", "Create Key")}
						</Button>
					</div>
				) : (
					<Table mobileLayout="stacked">
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
								const expStatus = getExpirationStatus(apiKey.expiresAt, t);
								return (
									<TableRow key={apiKey.id}>
										<TableCell>
											<Link
												href={`/settings/enterprise/api-keys/${apiKey.id}`}
												className="whitespace-normal break-words font-medium hover:underline"
											>
												{apiKey.name}
											</Link>
											<div className="text-xs text-muted-foreground">
												{t("settings.apiKeys.createdOn", "Created {date}", {
													date: formatDate(apiKey.createdAt),
												})}
											</div>
											{apiKey.creator ? (
												<div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
													<span>
														{t("settings.apiKeys.createdBy", "by {name}", {
															name:
																apiKey.creator.name ||
																apiKey.creator.email ||
																t("settings.apiKeys.unknownCreator", "a former admin"),
														})}
													</span>
													{apiKey.creator.departed ? (
														<Badge variant="outline" className="text-[10px]">
															{t("settings.apiKeys.creatorDeparted", "Departed")}
														</Badge>
													) : null}
												</div>
											) : null}
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
															className="size-8 p-0"
															aria-label={t("settings.apiKeys.copyPrefix", "Copy prefix")}
															onClick={() => handleCopyPrefix(apiKey.prefix || "", apiKey.id)}
														>
															{copiedKeyId === apiKey.id ? (
																<IconCheck className="size-4 text-green-600" />
															) : (
																<IconCopy className="size-4" />
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
													<span className="text-sm">{formatScopes(apiKey.scopes, t)}</span>
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
													expStatus.variant as "default" | "secondary" | "destructive" | "outline"
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
											<EditDeleteMenu
												onEdit={() => setEditingKey(apiKey)}
												onDelete={() => setDeleteDialogKey(apiKey)}
											/>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function ApiKeyDialogs({ viewModel }: { viewModel: ApiKeyPageViewModel }) {
	const {
		createDialogOpen,
		deleteDialogKey,
		deleteMutation,
		editingKey,
		handleKeyCreated,
		newlyCreatedKey,
		organizationId,
		setCreateDialogOpen,
		setDeleteDialogKey,
		setEditingKey,
		setNewlyCreatedKey,
		t,
	} = viewModel;

	return (
		<>
			<ApiKeyCreateDialog
				organizationId={organizationId}
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onKeyCreated={handleKeyCreated}
			/>
			<ApiKeyShowDialog
				apiKey={newlyCreatedKey}
				open={!!newlyCreatedKey}
				onOpenChange={(open: boolean) => !open && setNewlyCreatedKey(null)}
			/>
			<ApiKeyEditDialog
				key={JSON.stringify([
					editingKey?.id,
					viewModel.apiKeys.find((key) => key.id === editingKey?.id)?.scopes,
				])}
				organizationId={organizationId}
				apiKey={viewModel.apiKeys.find((key) => key.id === editingKey?.id) ?? null}
				open={!!editingKey}
				onOpenChange={(open: boolean) => !open && setEditingKey(null)}
			/>
			<AlertDialog
				open={!!deleteDialogKey}
				onOpenChange={(open) => !open && !deleteMutation.isPending && setDeleteDialogKey(null)}
			>
				<AlertDialogContent
					onEscapeKeyDown={(event) => {
						if (deleteMutation.isPending) event.preventDefault();
					}}
				>
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
					{deleteMutation.error ? (
						<p role="alert" className="text-sm text-destructive">
							{deleteMutation.error}
						</p>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<Button
							disabled={deleteMutation.isPending}
							onClick={() => deleteDialogKey && deleteMutation.mutate(deleteDialogKey.id)}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteMutation.isPending ? (
								<IconLoader2 className="size-4 animate-spin mr-2" />
							) : (
								<IconTrash className="size-4 mr-2" />
							)}
							{t("common.delete", "Delete")}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function ApiKeyPageView({ viewModel }: { viewModel: ReturnType<typeof useApiKeyPageViewModel> }) {
	const { canCreateMore, keyCount, setCreateDialogOpen, isError, isLoading, t } = viewModel;

	return (
		<div className="min-w-0">
			<div className="mx-auto max-w-7xl">
				<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold">{t("settings.apiKeys.title", "API Keys")}</h2>
						<p className="text-muted-foreground">
							{t(
								"settings.apiKeys.description",
								"Create and manage API keys for programmatic access to your organization data.",
							)}
						</p>
						<p className="mt-1 text-sm text-muted-foreground" hidden={isError || isLoading}>
							{t("settings.apiKeys.usage", "{count} of {max} keys used", {
								count: keyCount,
								max: MAX_API_KEYS_PER_ORG,
							})}
						</p>
					</div>
					<Button onClick={() => setCreateDialogOpen(true)} disabled={!canCreateMore || isError}>
						<IconPlus className="mr-2 size-4" />
						{t("settings.apiKeys.create", "Create Key")}
					</Button>
				</div>
				<div className="space-y-6">
					<ApiKeysCard viewModel={viewModel} />
					<ApiKeyDocumentation>
						<Button variant="outline" asChild>
							<a href="/api/v1/openapi.json" download="z8-public-api-v1.openapi.json">
								<IconDownload className="size-4" aria-hidden="true" />
								{t("settings.apiKeys.downloadOpenApi", "Download OpenAPI spec")}
							</a>
						</Button>
					</ApiKeyDocumentation>

					{/* Security Notice */}
					<Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950">
						<CardContent>
							<div className="flex gap-3">
								<IconKey className="size-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
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

			<ApiKeyDialogs viewModel={viewModel} />
		</div>
	);
}

export function ApiKeyPageClient(props: ApiKeyPageClientProps) {
	const viewModel = useApiKeyPageViewModel(props);
	return <ApiKeyPageView viewModel={viewModel} />;
}
