"use client";

import { IconAlertTriangle, IconLoader2, IconTrash, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { deleteWorkPeriod } from "@/app/[locale]/(app)/time-tracking/actions";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";

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
	const [isDeleting, setIsDeleting] = useState(false);

	// Get metadata with defaults
	const metadata = event.metadata as {
		durationMinutes: number;
		employeeName: string;
		notes?: string;
	};

	// Format duration
	const formatDuration = (minutes: number) => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	};

	const handleDelete = useCallback(async () => {
		setIsDeleting(true);
		try {
			const result = await deleteWorkPeriod(event.id);

			if (result.success) {
				toast.success(t("calendar.delete.success", "Work period converted to break"));
				onDeleteComplete?.();
				onOpenChange(false);
			} else {
				toast.error(result.error || t("calendar.delete.failed", "Failed to delete work period"));
			}
		} finally {
			setIsDeleting(false);
		}
	}, [event.id, onDeleteComplete, onOpenChange, t]);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<div className="flex items-center gap-2 text-destructive">
						<IconAlertTriangle className="size-5" />
						<AlertDialogTitle>{t("calendar.delete.title", "Convert to Break?")}</AlertDialogTitle>
					</div>
					<AlertDialogDescription className="space-y-3">
						<p>
							{t(
								"calendar.delete.description",
								"This will permanently delete this work period. The gap will appear as a break in the calendar.",
							)}
						</p>

						{/* Work period details */}
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

						<p className="text-sm text-muted-foreground">
							{t(
								"calendar.delete.auditNote",
								"Time entries will be marked as deleted for audit purposes.",
							)}
						</p>
					</AlertDialogDescription>
				</AlertDialogHeader>

				<AlertDialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDeleting}>
						<IconX className="size-4 mr-1" />
						{t("common.cancel", "Cancel")}
					</Button>
					<Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
						{isDeleting ? (
							<IconLoader2 className="size-4 animate-spin mr-1" />
						) : (
							<IconTrash className="size-4 mr-1" />
						)}
						{t("calendar.delete.confirm", "Convert to Break")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
