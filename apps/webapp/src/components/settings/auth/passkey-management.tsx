"use client";

import { IconLoader2, IconRefresh, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant, localeDefaultTimeFormat } from "@/lib/datetime/temporal-format";
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
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";

interface Passkey {
	id: string;
	name: string | null;
	createdAt: Date;
}

type BaseUIPreventableEvent = { preventBaseUIHandler?: () => void };

export function PasskeyManagement({
	variant = "inline",
}: {
	/**
	 * `card` renders a page section (Card with an h2 title), like the other
	 * sections of the security settings page. `inline` (default) renders an h3
	 * block for hosts that already provide the section heading, such as /mfa.
	 */
	variant?: "card" | "inline";
} = {}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const queryClient = useQueryClient();
	const [passkeyToDelete, setPasskeyToDelete] = useState<Passkey | null>(null);

	// Query for passkeys list
	const passkeysQuery = useQuery({
		queryKey: queryKeys.auth.passkeys(),
		queryFn: async () => {
			const result = await authClient.passkey.listUserPasskeys();
			if (result.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						t("settings.passkeys.loadError", "Failed to load passkeys"),
					),
				);
			}
			return (result.data || []) as Passkey[];
		},
		staleTime: 30 * 1000, // 30 seconds
	});

	// Mutation for adding a passkey
	const addPasskeyMutation = useMutation({
		mutationFn: async () => {
			const result = await authClient.passkey.addPasskey({
				name: t("settings.passkeys.defaultName", "Passkey {date}", {
					date: new Date().toLocaleDateString(),
				}),
			});
			if (result.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						t("settings.passkeys.addError", "Failed to add passkey"),
					),
				);
			}
			return result;
		},
		onSuccess: () => {
			toast.success(t("settings.passkeys.addSuccess", "Passkey added successfully"));
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.passkeys() });
		},
		onError: (error) => {
			toast.error(t("settings.passkeys.addError", "Failed to add passkey"), {
				description:
					error instanceof Error
						? error.message
						: t("common.unexpectedError", "An unexpected error occurred"),
			});
		},
	});

	// Mutation for deleting a passkey
	const deletePasskeyMutation = useMutation({
		mutationFn: async (id: string) => {
			const result = await authClient.passkey.deletePasskey({ id });
			if (result.error) {
				throw new Error(
					getAuthErrorMessage(
						result.error,
						t("settings.passkeys.deleteError", "Failed to delete passkey"),
					),
				);
			}
			return result;
		},
		onSuccess: () => {
			toast.success(t("settings.passkeys.deleteSuccess", "Passkey deleted successfully"));
			setPasskeyToDelete(null);
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.passkeys() });
		},
		onError: (error) => {
			toast.error(t("settings.passkeys.deleteError", "Failed to delete passkey"), {
				description:
					error instanceof Error
						? error.message
						: t("common.unexpectedError", "An unexpected error occurred"),
			});
		},
	});

	const passkeyName = (passkey: Passkey) =>
		passkey.name || t("settings.passkeys.unnamed", "Unnamed Passkey");
	const passkeys = passkeysQuery.data ?? [];
	const isPending = passkeysQuery.isLoading || deletePasskeyMutation.isPending;
	const title = t("settings.passkeys.title", "Passkeys");
	const description = t(
		"settings.passkeys.description",
		"Manage passkeys for passwordless authentication",
	);
	const addButton = (
		<Button
			onClick={() => addPasskeyMutation.mutate()}
			disabled={addPasskeyMutation.isPending || isPending}
		>
			{addPasskeyMutation.isPending
				? t("common.adding", "Adding…")
				: t("settings.passkeys.add", "Add Passkey")}
		</Button>
	);

	let list: ReactNode;
	if (passkeysQuery.isLoading) {
		list = (
			<div
				role="status"
				aria-label={t("settings.passkeys.loading", "Loading passkeys")}
				className="space-y-2"
			>
				<Skeleton aria-hidden="true" className="h-16 w-full rounded-lg" />
				<Skeleton aria-hidden="true" className="h-16 w-full rounded-lg" />
			</div>
		);
	} else if (passkeysQuery.isError) {
		list = (
			<div
				role="alert"
				className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 p-4"
			>
				<p className="min-w-0 text-sm text-destructive">
					{passkeysQuery.error instanceof Error
						? passkeysQuery.error.message
						: t("settings.passkeys.loadError", "Failed to load passkeys")}
				</p>
				<Button
					variant="outline"
					size="sm"
					onClick={() => passkeysQuery.refetch()}
					disabled={passkeysQuery.isFetching}
				>
					{passkeysQuery.isFetching ? (
						<IconLoader2 aria-hidden="true" className="motion-safe:animate-spin" />
					) : (
						<IconRefresh aria-hidden="true" />
					)}
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	} else if (passkeys.length === 0) {
		list = (
			<div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
				<p>{t("settings.passkeys.empty", "No passkeys configured")}</p>
				<p>
					{t(
						"settings.passkeys.emptyDescription",
						"Add a passkey to enable passwordless authentication",
					)}
				</p>
			</div>
		);
	} else {
		list = (
			<ul className="divide-y rounded-lg border">
				{passkeys.map((passkey) => (
					<li key={passkey.id} className="flex items-center justify-between gap-3 p-3">
						<div className="min-w-0">
							<p className="truncate text-sm font-medium" title={passkeyName(passkey)}>
								{passkeyName(passkey)}
							</p>
							<p className="text-sm text-muted-foreground">
								{t("settings.passkeys.addedOn", "Added on {date}", {
									date: formatInstant(
										instantFromDate(passkey.createdAt),
										{
											locale,
											timezone: Temporal.Now.timeZoneId(),
											timeFormat: localeDefaultTimeFormat(locale),
										},
										"dateMedium",
									),
								})}
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => setPasskeyToDelete(passkey)}
							aria-label={`${t("common.delete", "Delete")}: ${passkeyName(passkey)}`}
							disabled={isPending}
						>
							<IconTrash aria-hidden="true" className="size-4 text-destructive" />
						</Button>
					</li>
				))}
			</ul>
		);
	}

	const deleteDialog = (
		<AlertDialog
			open={passkeyToDelete !== null}
			onOpenChange={(open) => {
				// Keep the dialog while the deletion runs so its result stays in context.
				if (!open && !deletePasskeyMutation.isPending) setPasskeyToDelete(null);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.passkeys.deleteDialogTitle", "Delete Passkey?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{passkeyToDelete ? (
							<span className="mb-2 block break-words font-medium text-foreground">
								{passkeyName(passkeyToDelete)}
							</span>
						) : null}
						{t(
							"settings.passkeys.deleteDialogDescription",
							"This passkey will no longer be able to access your account. This action cannot be undone.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={deletePasskeyMutation.isPending}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					<AlertDialogAction
						onClick={(event) => {
							event.preventDefault();
							(event as unknown as BaseUIPreventableEvent).preventBaseUIHandler?.();
							if (!passkeyToDelete || deletePasskeyMutation.isPending) return;
							deletePasskeyMutation.mutate(passkeyToDelete.id);
						}}
						disabled={deletePasskeyMutation.isPending}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{deletePasskeyMutation.isPending ? (
							<IconLoader2 aria-hidden="true" className="motion-safe:animate-spin" />
						) : null}
						{t("common.delete", "Delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);

	if (variant === "card") {
		return (
			<Card>
				<CardHeader>
					<CardTitle as="h2">{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
					<CardAction>{addButton}</CardAction>
				</CardHeader>
				<CardContent>{list}</CardContent>
				{deleteDialog}
			</Card>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<h3 className="text-lg font-medium">{title}</h3>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
				{addButton}
			</div>
			{list}
			{deleteDialog}
		</div>
	);
}
