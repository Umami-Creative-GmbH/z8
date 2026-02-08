"use client";

import { IconAlertTriangle, IconRestore, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	deleteOrganization,
	recoverOrganization,
} from "@/app/[locale]/(app)/settings/organizations/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type * as authSchema from "@/db/auth-schema";
import { useRouter } from "@/navigation";

interface OrganizationDangerZoneCardProps {
	organization: typeof authSchema.organization.$inferSelect;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationDangerZoneCard({
	organization,
	currentMemberRole,
}: OrganizationDangerZoneCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [recoverDialogOpen, setRecoverDialogOpen] = useState(false);
	const [confirmationName, setConfirmationName] = useState("");
	const [isPending, startTransition] = useTransition();

	const canManage = currentMemberRole === "owner" || currentMemberRole === "admin";
	const isDeleted = !!organization.deletedAt;
	const isConfirmationValid = confirmationName === organization.name;

	// Calculate remaining time until permanent deletion
	const permanentDeletionDate = organization.deletedAt
		? DateTime.fromJSDate(new Date(organization.deletedAt)).plus({ days: 5 })
		: null;
	const remainingDays = permanentDeletionDate
		? Math.max(0, Math.ceil(permanentDeletionDate.diffNow("days").days))
		: 0;

	const handleDelete = () => {
		if (!isConfirmationValid) return;

		startTransition(async () => {
			const result = await deleteOrganization(organization.id, confirmationName);

			if (result.success) {
				toast.success(
					t(
						"organization.delete.scheduledSuccess",
						"Organization scheduled for deletion. You have 5 days to recover it.",
					),
				);
				setDeleteDialogOpen(false);
				setConfirmationName("");
				router.refresh();
			} else {
				toast.error(
					result.error || t("organization.delete.failed", "Failed to delete organization"),
				);
			}
		});
	};

	const handleRecover = () => {
		startTransition(async () => {
			const result = await recoverOrganization(organization.id);

			if (result.success) {
				toast.success(t("organization.recover.success", "Organization recovered successfully"));
				setRecoverDialogOpen(false);
				router.refresh();
			} else {
				toast.error(
					result.error || t("organization.recover.failed", "Failed to recover organization"),
				);
			}
		});
	};

	if (!canManage) {
		return null;
	}

	// Show recovery UI if organization is scheduled for deletion
	if (isDeleted) {
		return (
			<>
				<Card className="border-amber-500/50">
					<CardHeader>
						<CardTitle className="flex items-center gap-2 text-amber-600">
							<IconAlertTriangle className="size-5" />
							{t("organization.delete.pendingDeletion", "Pending Deletion")}
						</CardTitle>
						<CardDescription>
							{t(
								"organization.delete.pendingDescription",
								"This organization is scheduled for permanent deletion",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="rounded-lg border border-amber-500/30 bg-amber-50 dark:bg-amber-950/20 p-4">
							<div className="space-y-4">
								<div className="flex items-center justify-between">
									<div>
										<p className="font-medium text-amber-800 dark:text-amber-200">
											{t("organization.delete.timeRemaining", "Time remaining to recover:")}
										</p>
										<p className="text-2xl font-bold text-amber-600">
											{t(
												"organization.delete.daysRemaining",
												"{count, plural, one {# day} other {# days}}",
												{ count: remainingDays },
											)}
										</p>
									</div>
									<div className="text-right text-sm text-muted-foreground">
										<p>{t("organization.delete.permanentDeletionOn", "Permanent deletion on:")}</p>
										<p className="font-medium">
											{permanentDeletionDate?.toLocaleString(DateTime.DATETIME_MED)}
										</p>
									</div>
								</div>

								<div className="text-sm text-amber-800 dark:text-amber-200">
									<p>
										{t(
											"organization.delete.recoveryNote",
											"All organization data will be permanently deleted after this date. Click the button below to cancel deletion and recover the organization.",
										)}
									</p>
								</div>

								<Button
									variant="default"
									onClick={() => setRecoverDialogOpen(true)}
									className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
								>
									<IconRestore className="size-4 mr-2" />
									{t("organization.recover.button", "Recover Organization")}
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>

				<AlertDialog open={recoverDialogOpen} onOpenChange={setRecoverDialogOpen}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle className="flex items-center gap-2 text-green-600">
								<IconRestore className="size-5" />
								{t("organization.recover.confirmTitle", "Recover Organization?")}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{t(
									"organization.recover.confirmDescription",
									"This will cancel the scheduled deletion and restore the organization. All data will be preserved.",
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
							<AlertDialogAction
								onClick={handleRecover}
								disabled={isPending}
								className="bg-green-600 text-white hover:bg-green-700"
							>
								{isPending
									? t("common.recovering", "Recovering...")
									: t("organization.recover.confirmButton", "Recover Organization")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</>
		);
	}

	// Show delete UI for active organization
	return (
		<>
			<Card className="border-destructive/50">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-destructive">
						<IconAlertTriangle className="size-5" />
						{t("organization.delete.dangerZone", "Danger Zone")}
					</CardTitle>
					<CardDescription>
						{t(
							"organization.delete.description",
							"Permanently delete this organization and all its data",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
						<div className="space-y-4">
							<div>
								<h4 className="font-medium text-destructive">
									{t("organization.delete.title", "Delete Organization")}
								</h4>
								<p className="text-sm text-muted-foreground mt-1">
									{t(
										"organization.delete.warning",
										"This will schedule the organization for deletion. You will have 5 days to recover it before all data is permanently deleted.",
									)}
								</p>
								<ul className="text-sm text-muted-foreground list-disc list-inside mt-2 space-y-1">
									<li>{t("organization.delete.data.members", "All members and invitations")}</li>
									<li>{t("organization.delete.data.employees", "All employees and teams")}</li>
									<li>
										{t("organization.delete.data.timeEntries", "All time entries and work periods")}
									</li>
									<li>
										{t("organization.delete.data.absences", "All absences and vacation data")}
									</li>
									<li>
										{t(
											"organization.delete.data.settings",
											"All organization settings and configurations",
										)}
									</li>
								</ul>
							</div>
							<Button
								variant="destructive"
								onClick={() => setDeleteDialogOpen(true)}
								className="w-full sm:w-auto"
							>
								<IconTrash className="size-4 mr-2" />
								{t("organization.delete.button", "Delete Organization")}
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="flex items-center gap-2 text-destructive">
							<IconAlertTriangle className="size-5" />
							{t("organization.delete.confirmTitle", "Delete Organization?")}
						</AlertDialogTitle>
						<AlertDialogDescription asChild>
							<div className="space-y-4">
								<p>
									{t(
										"organization.delete.confirmDescription",
										"This will schedule the organization for deletion. You will have 5 days to recover it before all data is permanently deleted.",
									)}
								</p>
								<div className="space-y-2">
									<Label htmlFor="confirmationName">
										{t("organization.delete.confirmLabel", 'Type "{name}" to confirm', {
											name: organization.name,
										})}
									</Label>
									<Input
										id="confirmationName"
										value={confirmationName}
										onChange={(e) => setConfirmationName(e.target.value)}
										placeholder={organization.name}
										className="font-mono"
										autoComplete="off"
									/>
								</div>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setConfirmationName("")}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							disabled={!isConfirmationValid || isPending}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{isPending
								? t("common.deleting", "Deleting...")
								: t("organization.delete.confirmButton", "Delete Organization")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
