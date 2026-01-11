"use client";

import { Trash2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
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

interface Passkey {
	id: string;
	name: string | null;
	createdAt: Date;
}

export function PasskeyManagement() {
	const [isPending, startTransition] = useTransition();
	const [isAdding, setIsAdding] = useState(false);
	const [passkeys, setPasskeys] = useState<Passkey[]>([]);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [passkeyToDelete, setPasskeyToDelete] = useState<string | null>(null);

	const loadPasskeys = () => {
		startTransition(async () => {
			try {
				const result = await passkey.listUserPasskeys();

				if (result.data) {
					setPasskeys(result.data);
				} else if (result.error) {
					toast.error("Failed to load passkeys", {
						description: result.error.message,
					});
				}
			} catch (error) {
				toast.error("Failed to load passkeys", {
					description: error instanceof Error ? error.message : "An unexpected error occurred",
				});
			}
		});
	};

	useEffect(() => {
		loadPasskeys();
	}, [loadPasskeys]);

	const handleAddPasskey = async () => {
		setIsAdding(true);

		try {
			const result = await passkey.addPasskey({
				name: `Passkey ${new Date().toLocaleDateString()}`,
			});

			if (result.error) {
				toast.error("Failed to add passkey", {
					description: result.error.message,
				});
			} else {
				toast.success("Passkey added successfully");
				loadPasskeys();
			}
		} catch (error) {
			toast.error("Failed to add passkey", {
				description: error instanceof Error ? error.message : "An unexpected error occurred",
			});
		} finally {
			setIsAdding(false);
		}
	};

	const handleDeletePasskey = () => {
		if (!passkeyToDelete) return;

		startTransition(async () => {
			try {
				const result = await passkey.deletePasskey({
					id: passkeyToDelete,
				});

				if (result.error) {
					toast.error("Failed to delete passkey", {
						description: result.error.message,
					});
				} else {
					toast.success("Passkey deleted successfully");
					setDeleteDialogOpen(false);
					setPasskeyToDelete(null);
					loadPasskeys();
				}
			} catch (error) {
				toast.error("Failed to delete passkey", {
					description: error instanceof Error ? error.message : "An unexpected error occurred",
				});
			}
		});
	};

	const confirmDelete = (passkeyId: string) => {
		setPasskeyToDelete(passkeyId);
		setDeleteDialogOpen(true);
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-medium">Passkeys</h3>
					<p className="text-sm text-muted-foreground">
						Manage passkeys for passwordless authentication
					</p>
				</div>
				<Button onClick={handleAddPasskey} disabled={isAdding || isPending}>
					{isAdding ? "Adding..." : "Add Passkey"}
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
						<AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeletePasskey}
							disabled={isPending}
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
