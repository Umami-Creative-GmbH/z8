"use client";

import { IconAlertTriangle, IconLoader2, IconTrash, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { requestTimeEntryDeletion } from "@/app/[locale]/(app)/time-tracking/actions/corrections";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";
import { formatDuration, getWorkPeriodDialogMetadata } from "./work-period-dialog-utils";

interface DeleteWorkPeriodDialogProps {
	event: CalendarEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDeleteComplete?: () => void;
}

export function DeleteWorkPeriodDialog({
	event,
	open,
	onOpenChange,
	onDeleteComplete,
}: DeleteWorkPeriodDialogProps) {
	const { t } = useTranslate();
	const reasonId = useId();
	const [isDeleting, setIsDeleting] = useState(false);
	const [reason, setReason] = useState("");

	// Get metadata with defaults
	const metadata = getWorkPeriodDialogMetadata(event);

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen) {
			setReason("");
		}

		onOpenChange(nextOpen);
	};

	const handleDelete = async () => {
		const trimmedReason = reason.trim();

		if (!trimmedReason) {
			toast.error(t("calendar.delete.reasonRequired", "Reason is required"));
			return;
		}

		setIsDeleting(true);
		const result = await requestTimeEntryDeletion({
			workPeriodId: event.id,
			reason: trimmedReason,
		}).catch(() => null);

		if (!result) {
			toast.error(t("calendar.delete.failed", "Failed to delete work period"));
		} else if (result.success) {
			toast.success(
				t("calendar.delete.success", "Deletion request submitted for manager approval"),
			);
			onDeleteComplete?.();
			setReason("");
			onOpenChange(false);
		} else {
			toast.error(result.error || t("calendar.delete.failed", "Failed to delete work period"));
		}

		setIsDeleting(false);
	};

	return (
		<AlertDialog open={open} onOpenChange={handleOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<div className="flex items-center gap-2 text-destructive">
						<IconAlertTriangle className="size-5" aria-hidden="true" />
						<AlertDialogTitle>{t("calendar.delete.title", "Request deletion?")}</AlertDialogTitle>
					</div>
					<AlertDialogDescription>
						{t(
							"calendar.delete.description",
							"This will hide the time entry after manager approval. The audit history and time-entry chain will be preserved.",
						)}
					</AlertDialogDescription>

					<div className="space-y-3 text-sm">
						<div className="rounded-lg bg-muted p-3 space-y-1">
							<div className="font-medium">
								{format(event.date, "PPP")} {/* e.g., "January 1, 2024" */}
							</div>
							<div className="text-sm">
								{format(event.date, "p")} - {event.endDate ? format(event.endDate, "p") : "—"}
								<span className="ml-2 text-muted-foreground">
									({formatDuration(metadata.durationMinutes)})
								</span>
							</div>
							{metadata.notes && (
								<div className="text-sm text-muted-foreground mt-2 border-t pt-2">
									{metadata.notes}
								</div>
							)}
						</div>

						<div className="space-y-2">
							<Label htmlFor={reasonId}>
								{t("calendar.delete.reasonLabel", "Reason for deletion")}
							</Label>
							<Textarea
								id={reasonId}
								name="deletionReason"
								autoComplete="off"
								aria-label={t("calendar.delete.reasonLabel", "Reason for deletion")}
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								required
								rows={3}
							/>
						</div>

						<p className="text-sm text-muted-foreground">
							{t(
								"calendar.delete.auditNote",
								"Time entries will be marked as deleted for audit purposes.",
							)}
						</p>
					</div>
				</AlertDialogHeader>

				<AlertDialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isDeleting}>
						<IconX className="size-4 mr-1" aria-hidden="true" />
						{t("common.cancel", "Cancel")}
					</Button>
					<Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
						{isDeleting ? (
							<IconLoader2 className="size-4 animate-spin mr-1" aria-hidden="true" />
						) : (
							<IconTrash className="size-4 mr-1" aria-hidden="true" />
						)}
						{t("calendar.delete.confirm", "Delete entry")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
