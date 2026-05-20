"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthErrorMessage } from "@/lib/auth/error-message";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";

interface Passkey {
	id: string;
	name: string | null;
	createdAt: Date;
}

export function PasskeyManagement() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [passkeyToDelete, setPasskeyToDelete] = useState<string | null>(null);

	// Query for passkeys list
	const passkeysQuery = useQuery({
		queryKey: queryKeys.auth.passkeys(),
		queryFn: async () => {
			const result = await authClient.passkey.listUserPasskeys();
			if (result.error) {
				throw new Error(getAuthErrorMessage(result.error, t("settings.passkeys.loadError", "Failed to load passkeys")));
			}
			return (result.data || []) as Passkey[];
		},
		staleTime: 30 * 1000, // 30 seconds
	});

	// Mutation for adding a passkey
	const addPasskeyMutation = useMutation({
		mutationFn: async () => {
			const result = await authClient.passkey.addPasskey({
				name: t("settings.passkeys.defaultName", "Passkey {date}", { date: new Date().toLocaleDateString() }),
			});
			if (result.error) {
				throw new Error(getAuthErrorMessage(result.error, t("settings.passkeys.addError", "Failed to add passkey")));
			}
			return result;
		},
		onSuccess: () => {
			toast.success(t("settings.passkeys.addSuccess", "Passkey added successfully"));
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.passkeys() });
		},
		onError: (error) => {
			toast.error(t("settings.passkeys.addError", "Failed to add passkey"), {
				description: error instanceof Error ? error.message : t("common.unexpectedError", "An unexpected error occurred"),
			});
		},
	});

	// Mutation for deleting a passkey
	const deletePasskeyMutation = useMutation({
		mutationFn: async (id: string) => {
			const result = await authClient.passkey.deletePasskey({ id });
			if (result.error) {
				throw new Error(getAuthErrorMessage(result.error, t("settings.passkeys.deleteError", "Failed to delete passkey")));
			}
			return result;
		},
		onSuccess: () => {
			toast.success(t("settings.passkeys.deleteSuccess", "Passkey deleted successfully"));
			setDeleteDialogOpen(false);
			setPasskeyToDelete(null);
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.passkeys() });
		},
		onError: (error) => {
			toast.error(t("settings.passkeys.deleteError", "Failed to delete passkey"), {
				description: error instanceof Error ? error.message : t("common.unexpectedError", "An unexpected error occurred"),
			});
		},
	});

	const handleDeletePasskey = () => {
		if (!passkeyToDelete) return;
		deletePasskeyMutation.mutate(passkeyToDelete);
	};

	const confirmDelete = (passkeyId: string) => {
		setPasskeyToDelete(passkeyId);
		setDeleteDialogOpen(true);
	};

	const passkeys = passkeysQuery.data || [];
	const isPending = passkeysQuery.isLoading || deletePasskeyMutation.isPending;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-medium">{t("settings.passkeys.title", "Passkeys")}</h3>
					<p className="text-sm text-muted-foreground">
						{t("settings.passkeys.description", "Manage passkeys for passwordless authentication")}
					</p>
				</div>
				<Button
					onClick={() => addPasskeyMutation.mutate()}
					disabled={addPasskeyMutation.isPending || isPending}
				>
					{addPasskeyMutation.isPending ? t("common.adding", "Adding...") : t("settings.passkeys.add", "Add Passkey")}
				</Button>
			</div>

			{passkeys.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<p className="text-sm text-muted-foreground text-center">
							{t("settings.passkeys.empty", "No passkeys configured")}
							<br />
							{t("settings.passkeys.emptyDescription", "Add a passkey to enable passwordless authentication")}
						</p>
					</CardContent>
				</Card>
			) : (
				<div className="space-y-2">
					{passkeys.map((passkey) => (
						<Card key={passkey.id}>
							<CardHeader className="pb-3">
								<div className="flex items-center justify-between">
									<div>
							<CardTitle className="text-base">{passkey.name || t("settings.passkeys.unnamed", "Unnamed Passkey")}</CardTitle>
							<CardDescription>
								{t("settings.passkeys.addedOn", "Added on {date}", { date: new Date(passkey.createdAt).toLocaleDateString() })}
										</CardDescription>
									</div>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => confirmDelete(passkey.id)}
										disabled={isPending}
									>
										<IconTrash className="size-4 text-destructive" />
									</Button>
								</div>
							</CardHeader>
						</Card>
					))}
				</div>
			)}

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("settings.passkeys.deleteDialogTitle", "Delete Passkey?")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("settings.passkeys.deleteDialogDescription", "This passkey will no longer be able to access your account. This action cannot be undone.")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletePasskeyMutation.isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeletePasskey}
							disabled={deletePasskeyMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
