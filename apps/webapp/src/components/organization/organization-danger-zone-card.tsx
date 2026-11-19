"use client";

import { IconAlertTriangle, IconLoader2, IconRestore, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	deleteOrganization,
	recoverOrganization,
} from "@/app/[locale]/(app)/settings/organization/actions";
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
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type * as authSchema from "@/db/auth-schema";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { useRouter } from "@/navigation";

type BaseUIPreventableEvent = { preventBaseUIHandler?: () => void };

interface OrganizationDangerZoneCardProps {
	organization: typeof authSchema.organization.$inferSelect;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
}

export function OrganizationDangerZoneCard({
	organization,
	settingsAccess,
}: OrganizationDangerZoneCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [recoverDialogOpen, setRecoverDialogOpen] = useState(false);
	const [confirmationName, setConfirmationName] = useState("");
	const [deleteError, setDeleteError] = useState<string | null>(null);
	const [recoverError, setRecoverError] = useState<string | null>(null);
	const [isPending, startTransition] = useTransition();

	const canManage = meetsSettingsAccess(settingsAccess, "orgAdmin");
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
		if (!isConfirmationValid || isPending) return;

		setDeleteError(null);
		startTransition(async () => {
			let message: string;
			try {
				const result = await deleteOrganization({ confirmationName });

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
					return;
				}
				message = result.error || t("organization.delete.failed", "Failed to delete organization");
			} catch {
				message = t("organization.delete.failed", "Failed to delete organization");
			}
			// Keep the dialog open with the typed name so the admin can retry.
			setDeleteError(message);
			toast.error(message);
		});
	};

	const handleRecover = () => {
		if (isPending) return;

		setRecoverError(null);
		startTransition(async () => {
			let message: string;
			try {
				const result = await recoverOrganization();

				if (result.success) {
					toast.success(t("organization.recover.success", "Organization recovered successfully"));
					setRecoverDialogOpen(false);
					router.refresh();
					return;
				}
				message =
					result.error || t("organization.recover.failed", "Failed to recover organization");
			} catch {
				message = t("organization.recover.failed", "Failed to recover organization");
			}
			setRecoverError(message);
			toast.error(message);
		});
	};

	const handleDeleteDialogOpenChange = (open: boolean) => {
		// Escape, an outside press or Cancel must not hide a deletion that is still running.
		if (!open && isPending) return;
		setDeleteDialogOpen(open);
		if (!open) {
			setConfirmationName("");
			setDeleteError(null);
		}
	};

	const handleRecoverDialogOpenChange = (open: boolean) => {
		if (!open && isPending) return;
		setRecoverDialogOpen(open);
		if (!open) {
			setRecoverError(null);
		}
	};

	if (!canManage) {
		return null;
	}

	// Show recovery UI if organization is scheduled for deletion
	if (isDeleted) {
		return (
			<>
				<Card className="border-warning/40">
					<CardHeader>
						<CardTitle as="h2" className="flex items-center gap-2">
							<IconAlertTriangle aria-hidden="true" className="size-5 shrink-0 text-warning" />
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
						{/* Warning surface: tint and border carry the state; text stays on the
						    foreground token for body-text contrast in light and dark themes. */}
						<div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-foreground">
							<div className="space-y-4">
								<div className="flex flex-wrap items-start justify-between gap-4">
									<div>
										<p className="font-medium">
											{t("organization.delete.timeRemaining", "Time remaining to recover:")}
										</p>
										<p className="text-2xl font-semibold tabular-nums">
											{t(
												"organization.delete.daysRemaining",
												"{count, plural, one {# day} other {# days}}",
												{ count: remainingDays },
											)}
										</p>
									</div>
									<div className="text-sm text-muted-foreground sm:text-right">
										<p>{t("organization.delete.permanentDeletionOn", "Permanent deletion on:")}</p>
										<p className="font-medium">
											{permanentDeletionDate?.toLocaleString(DateTime.DATETIME_MED)}
										</p>
									</div>
								</div>

								<div className="text-sm">
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
									className="w-full sm:w-auto"
								>
									<IconRestore aria-hidden="true" className="size-4" />
									{t("organization.recover.button", "Recover Organization")}
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>

				<AlertDialog open={recoverDialogOpen} onOpenChange={handleRecoverDialogOpenChange}>
					<AlertDialogContent aria-busy={isPending}>
						<AlertDialogHeader>
							<AlertDialogTitle className="flex items-center gap-2">
								<IconRestore aria-hidden="true" className="size-5" />
								{t("organization.recover.confirmTitle", "Recover Organization?")}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{t(
									"organization.recover.confirmDescription",
									"This will cancel the scheduled deletion and restore the organization. All data will be preserved.",
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
						{recoverError && (
							<p role="alert" className="text-sm text-destructive">
								{recoverError}
							</p>
						)}
						<AlertDialogFooter>
							<AlertDialogCancel disabled={isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
							<AlertDialogAction
								onClick={(event) => {
									// Keep the dialog open so the pending state and any failure stay visible.
									event.preventDefault();
									(event as unknown as BaseUIPreventableEvent).preventBaseUIHandler?.();
									handleRecover();
								}}
								disabled={isPending}
							>
								{isPending && (
									<IconLoader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
								)}
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
					<CardTitle as="h2" className="flex items-center gap-2 text-destructive">
						<IconAlertTriangle aria-hidden="true" className="size-5 shrink-0" />
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
								<h3 className="font-medium text-destructive">
									{t("organization.delete.title", "Delete Organization")}
								</h3>
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
								<IconTrash aria-hidden="true" className="size-4" />
								{t("organization.delete.button", "Delete Organization")}
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			<AlertDialog open={deleteDialogOpen} onOpenChange={handleDeleteDialogOpenChange}>
				<AlertDialogContent aria-busy={isPending}>
					<AlertDialogHeader>
						<AlertDialogTitle className="flex items-center gap-2 text-destructive">
							<IconAlertTriangle aria-hidden="true" className="size-5" />
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
										disabled={isPending}
										aria-invalid={deleteError ? true : undefined}
										aria-describedby={deleteError ? "delete-organization-error" : undefined}
									/>
								</div>
							</div>
						</AlertDialogDescription>
					</AlertDialogHeader>
					{deleteError && (
						<p id="delete-organization-error" role="alert" className="text-sm text-destructive">
							{deleteError}
						</p>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								// Keep the dialog open so the pending state and any failure stay visible.
								event.preventDefault();
								(event as unknown as BaseUIPreventableEvent).preventBaseUIHandler?.();
								handleDelete();
							}}
							disabled={!isConfirmationValid || isPending}
							className={buttonVariants({ variant: "destructive" })}
						>
							{isPending && (
								<IconLoader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
							)}
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
