"use client";

import { IconLoader2, IconMailForward, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { deleteEmployeeInvitationDraft } from "@/app/[locale]/(app)/settings/employees/actions";
import { resendInvitation } from "@/app/[locale]/(app)/settings/organizations/actions";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query";
import { useRouter } from "@/navigation";

interface EmployeeDraftActionsProps {
	organizationId: string;
	encodedDraftEmployeeId: string;
	invitationId: string;
	invitationStatus: string;
}

export function EmployeeDraftActions({
	organizationId,
	encodedDraftEmployeeId,
	invitationId,
	invitationStatus,
}: EmployeeDraftActionsProps) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const queryClient = useQueryClient();
	const actionLocked = useRef(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const detailQueryKey = queryKeys.employees.detail(encodedDraftEmployeeId);

	const resendMutation = useMutation({
		mutationFn: async () => {
			const result = await resendInvitation(organizationId, invitationId);
			if (!result.success) {
				throw new Error("Resend invitation failed");
			}
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.invitations.list(organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.organization(organizationId),
				}),
				queryClient.invalidateQueries({ queryKey: detailQueryKey }),
			]);
			toast.success(
				t(
					"settings.employees.draftActions.resendSuccess",
					"Invitation resent successfully",
				),
			);
		},
		onError: () => {
			toast.error(
				t(
					"settings.employees.draftActions.resendError",
					"Failed to resend invitation",
				),
			);
		},
		onSettled: () => {
			actionLocked.current = false;
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			const result = await deleteEmployeeInvitationDraft(
				encodedDraftEmployeeId,
			);
			if (!result.success) {
				throw new Error("Delete employee draft failed");
			}
		},
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: queryKeys.invitations.list(organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: queryKeys.employees.organization(organizationId),
				}),
			]);
			queryClient.removeQueries({ queryKey: detailQueryKey, exact: true });
			setDeleteDialogOpen(false);
			push("/settings/employees");
		},
		onError: () => {
			toast.error(
				t(
					"settings.employees.draftActions.deleteError",
					"Failed to delete employee draft",
				),
			);
		},
		onSettled: () => {
			actionLocked.current = false;
		},
	});

	const isPending = resendMutation.isPending || deleteMutation.isPending;

	const handleResend = () => {
		if (actionLocked.current || isPending) return;
		actionLocked.current = true;
		resendMutation.mutate();
	};

	const handleDelete = () => {
		if (actionLocked.current || isPending) return;
		actionLocked.current = true;
		deleteMutation.mutate();
	};

	if (invitationStatus !== "pending") return null;

	return (
		<div className="flex flex-wrap gap-2 rounded-lg border bg-card p-4">
			<Button variant="outline" onClick={handleResend} disabled={isPending}>
				{resendMutation.isPending ? (
					<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
				) : (
					<IconMailForward className="size-4" aria-hidden="true" />
				)}
				{resendMutation.isPending
					? t(
							"settings.employees.draftActions.resending",
							"Resending invitation...",
						)
					: t("settings.employees.draftActions.resend", "Resend invitation")}
			</Button>
			<Button
				variant="destructive"
				onClick={() => setDeleteDialogOpen(true)}
				disabled={isPending}
			>
				<IconTrash className="size-4" aria-hidden="true" />
				{t("settings.employees.draftActions.delete", "Delete draft")}
			</Button>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t(
								"settings.employees.draftActions.deleteTitle",
								"Delete employee draft?",
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.employees.draftActions.deleteDescription",
								"This permanently deletes the prepared employee data and cancels the pending invitation. No employee history will be deleted.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deleteMutation.isPending}>
							{t("settings.employees.draftActions.cancel", "Cancel")}
						</AlertDialogCancel>
						<Button
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={handleDelete}
						>
							{deleteMutation.isPending ? (
								<IconLoader2
									className="size-4 animate-spin"
									aria-hidden="true"
								/>
							) : (
								<IconTrash className="size-4" aria-hidden="true" />
							)}
							{deleteMutation.isPending
								? t(
										"settings.employees.draftActions.deleting",
										"Deleting draft...",
									)
								: t(
										"settings.employees.draftActions.deleteConfirm",
										"Delete draft permanently",
									)}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
