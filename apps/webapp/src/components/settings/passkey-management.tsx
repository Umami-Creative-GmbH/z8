"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
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
import { passkey } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query/keys";

interface Passkey {
	id: string;
	name: string | null;
	createdAt: Date;
}

export function PasskeyManagement() {
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [passkeyToDelete, setPasskeyToDelete] = useState<string | null>(null);

	// Query for passkeys list
	const passkeysQuery = useQuery({
		queryKey: queryKeys.auth.passkeys(),
		queryFn: async () => {
			const result = await passkey.listUserPasskeys();
			if (result.error) {
				throw new Error(result.error.message);
			}
			return (result.data || []) as Passkey[];
		},
		staleTime: 30 * 1000, // 30 seconds
	});

	// Mutation for adding a passkey
	const addPasskeyMutation = useMutation({
		mutationFn: async () => {
			const result = await passkey.addPasskey({
				name: `Passkey ${new Date().toLocaleDateString()}`,
			});
			if (result.error) {
				throw new Error(result.error.message);
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Passkey added successfully");
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.passkeys() });
		},
		onError: (error) => {
			toast.error("Failed to add passkey", {
				description: error instanceof Error ? error.message : "An unexpected error occurred",
			});
		},
	});

	// Mutation for deleting a passkey
	const deletePasskeyMutation = useMutation({
		mutationFn: async (id: string) => {
			const result = await passkey.deletePasskey({ id });
			if (result.error) {
				throw new Error(result.error.message);
			}
			return result;
		},
		onSuccess: () => {
			toast.success("Passkey deleted successfully");
			setDeleteDialogOpen(false);
			setPasskeyToDelete(null);
			queryClient.invalidateQueries({ queryKey: queryKeys.auth.passkeys() });
		},
		onError: (error) => {
			toast.error("Failed to delete passkey", {
				description: error instanceof Error ? error.message : "An unexpected error occurred",
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
					<h3 className="text-lg font-medium">Passkeys</h3>
					<p className="text-sm text-muted-foreground">
						Manage passkeys for passwordless authentication
					</p>
				</div>
				<Button
					onClick={() => addPasskeyMutation.mutate()}
					disabled={addPasskeyMutation.isPending || isPending}
				>
					{addPasskeyMutation.isPending ? "Adding..." : "Add Passkey"}
				</Button>
			</div>

			{passkeys.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<p className="text-sm text-muted-foreground text-center">
							No passkeys configured
							<br />
							Add a passkey to enable passwordless authentication
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
										<CardTitle className="text-base">{passkey.name || "Unnamed Passkey"}</CardTitle>
										<CardDescription>
											Added on {new Date(passkey.createdAt).toLocaleDateString()}
										</CardDescription>
									</div>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => confirmDelete(passkey.id)}
										disabled={isPending}
									>
										<Trash2 className="h-4 w-4 text-destructive" />
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
						<AlertDialogTitle>Delete Passkey?</AlertDialogTitle>
						<AlertDialogDescription>
							This passkey will no longer be able to access your account. This action cannot be
							undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletePasskeyMutation.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeletePasskey}
							disabled={deletePasskeyMutation.isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
