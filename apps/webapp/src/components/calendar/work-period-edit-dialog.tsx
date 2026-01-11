"use client";

import {
	IconCheck,
	IconLoader2,
	IconPencil,
	IconScissors,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { updateWorkPeriodNotes } from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";

interface WorkPeriodEditDialogProps {
	event: CalendarEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNotesUpdated?: () => void;
	onSplitClick?: () => void;
	onDeleteClick?: () => void;
}

export function WorkPeriodEditDialog({
	event,
	open,
	onOpenChange,
	onNotesUpdated,
	onSplitClick,
	onDeleteClick,
}: WorkPeriodEditDialogProps) {
	const { t } = useTranslate();

	// Get metadata with defaults
	const metadata = event.metadata as {
		durationMinutes: number;
		employeeName: string;
		notes?: string;
	};

	// Edit state
	const [isEditing, setIsEditing] = useState(false);
	const [notes, setNotes] = useState(metadata.notes || "");
	const [isSaving, setIsSaving] = useState(false);

	// Format duration
	const formatDuration = (minutes: number) => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	};

	// Format time range
	const formatTimeRange = () => {
		const startTime = format(event.date, "p"); // e.g., "9:00 AM"
		const endTime = event.endDate ? format(event.endDate, "p") : "—";
		return `${startTime} - ${endTime}`;
	};

	const handleSaveNotes = useCallback(async () => {
		setIsSaving(true);
		try {
			const result = await updateWorkPeriodNotes(event.id, notes.trim());
			if (result.success) {
				toast.success(t("calendar.edit.notesSaved", "Notes saved"));
				// Trigger refetch via callback
				onNotesUpdated?.();
				setIsEditing(false);
			} else {
				toast.error(result.error || t("calendar.edit.notesSaveFailed", "Failed to save notes"));
			}
		} finally {
			setIsSaving(false);
		}
	}, [event.id, notes, onNotesUpdated, t]);

	const handleCancelEdit = useCallback(() => {
		setNotes(metadata.notes || "");
		setIsEditing(false);
	}, [metadata.notes]);

	const handleStartEdit = useCallback(() => {
		setNotes(metadata.notes || "");
		setIsEditing(true);
	}, [metadata.notes]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<div className="w-3 h-3 rounded-full" style={{ backgroundColor: event.color }} />
						<DialogTitle>{t("calendar.edit.title", "Work Period")}</DialogTitle>
					</div>
					<DialogDescription>
						{format(event.date, "PPP")} {/* e.g., "January 1, 2024" */}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Employee name */}
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.employee", "Employee")}
						</span>
						<p className="font-medium">{metadata.employeeName}</p>
					</div>

					{/* Time range */}
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.time", "Time")}
						</span>
						<p className="font-medium">{formatTimeRange()}</p>
					</div>

					{/* Duration */}
					<div>
						<span className="text-sm text-muted-foreground">
							{t("calendar.details.duration", "Duration")}
						</span>
						<p className="font-medium">{formatDuration(metadata.durationMinutes)}</p>
					</div>

					{/* Notes section */}
					<div>
						<div className="flex items-center justify-between mb-1">
							<span className="text-sm text-muted-foreground">
								{t("calendar.details.notes", "Notes")}
							</span>
							{!isEditing && (
								<Button variant="ghost" size="sm" onClick={handleStartEdit} className="h-7 px-2">
									<IconPencil className="size-4 mr-1" />
									{t("common.edit", "Edit")}
								</Button>
							)}
						</div>

						{isEditing ? (
							<div className="space-y-2">
								<Textarea
									placeholder={t("timeTracking.notesPlaceholder", "What did you work on?")}
									value={notes}
									onChange={(e) => setNotes(e.target.value)}
									rows={3}
									className="resize-none"
									autoFocus
								/>
								<div className="flex gap-2">
									<Button
										size="sm"
										onClick={handleSaveNotes}
										disabled={isSaving}
										className="flex-1"
									>
										{isSaving ? (
											<IconLoader2 className="size-4 animate-spin mr-1" />
										) : (
											<IconCheck className="size-4 mr-1" />
										)}
										{t("common.save", "Save")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										onClick={handleCancelEdit}
										disabled={isSaving}
									>
										<IconX className="size-4 mr-1" />
										{t("common.cancel", "Cancel")}
									</Button>
								</div>
							</div>
						) : (
							<p className="text-sm">
								{metadata.notes || (
									<span className="text-muted-foreground italic">
										{t("calendar.edit.noNotes", "No notes added")}
									</span>
								)}
							</p>
						)}
					</div>
				</div>

				<DialogFooter className="flex-col sm:flex-row gap-2">
					{/* Split and Delete buttons - for future phases */}
					<div className="flex gap-2 w-full sm:w-auto">
						<Button
							variant="outline"
							size="sm"
							onClick={onSplitClick}
							disabled={!onSplitClick}
							className="flex-1 sm:flex-none"
						>
							<IconScissors className="size-4 mr-1" />
							{t("calendar.edit.split", "Split")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={onDeleteClick}
							disabled={!onDeleteClick}
							className="flex-1 sm:flex-none text-destructive hover:text-destructive"
						>
							<IconTrash className="size-4 mr-1" />
							{t("calendar.edit.convertToBreak", "Convert to Break")}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
