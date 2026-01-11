"use client";

import { IconLoader2, IconScissors, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { splitWorkPeriod } from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEvent } from "@/lib/calendar/types";
import { format } from "@/lib/datetime/luxon-utils";

interface SplitWorkPeriodDialogProps {
	event: CalendarEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSplitComplete?: () => void;
}

export function SplitWorkPeriodDialog({
	event,
	open,
	onOpenChange,
	onSplitComplete,
}: SplitWorkPeriodDialogProps) {
	const { t } = useTranslate();

	// Get metadata with defaults
	const metadata = event.metadata as {
		durationMinutes: number;
		employeeName: string;
		notes?: string;
	};

	// State for split configuration
	const [splitTime, setSplitTime] = useState("");
	const [beforeNotes, setBeforeNotes] = useState(metadata.notes || "");
	const [afterNotes, setAfterNotes] = useState("");
	const [isSaving, setIsSaving] = useState(false);

	// Format time to HH:mm
	const formatTimeToHHMM = (date: Date): string => {
		const hours = date.getHours().toString().padStart(2, "0");
		const minutes = date.getMinutes().toString().padStart(2, "0");
		return `${hours}:${minutes}`;
	};

	// Get start and end times as HH:mm
	const startTimeHHMM = formatTimeToHHMM(event.date);
	const endTimeHHMM = event.endDate ? formatTimeToHHMM(event.endDate) : "";

	// Format duration
	const formatDuration = (minutes: number) => {
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		if (hours === 0) return `${mins}m`;
		if (mins === 0) return `${hours}h`;
		return `${hours}h ${mins}m`;
	};

	// Calculate preview durations
	const previewDurations = useMemo(() => {
		if (!splitTime || !event.endDate) return null;

		const [splitHours, splitMinutes] = splitTime.split(":").map(Number);
		if (Number.isNaN(splitHours) || Number.isNaN(splitMinutes)) return null;

		const startDate = event.date;
		const endDate = event.endDate;

		// Create split date
		const splitDate = new Date(startDate);
		splitDate.setHours(splitHours, splitMinutes, 0, 0);

		// Validate split time is between start and end
		if (splitDate <= startDate || splitDate >= endDate) return null;

		// Calculate durations in minutes
		const firstDurationMs = splitDate.getTime() - startDate.getTime();
		const firstDurationMinutes = Math.floor(firstDurationMs / 60000);

		const secondDurationMs = endDate.getTime() - splitDate.getTime();
		const secondDurationMinutes = Math.floor(secondDurationMs / 60000);

		return {
			first: firstDurationMinutes,
			second: secondDurationMinutes,
		};
	}, [splitTime, event.date, event.endDate]);

	// Check if split time is valid
	const isValidSplitTime =
		previewDurations !== null && previewDurations.first > 0 && previewDurations.second > 0;

	const handleSplit = useCallback(async () => {
		if (!isValidSplitTime) return;

		setIsSaving(true);
		try {
			const result = await splitWorkPeriod(
				event.id,
				splitTime,
				beforeNotes.trim() || undefined,
				afterNotes.trim() || undefined,
			);

			if (result.success) {
				toast.success(t("calendar.split.success", "Work period split successfully"));
				onSplitComplete?.();
				onOpenChange(false);
			} else {
				toast.error(result.error || t("calendar.split.failed", "Failed to split work period"));
			}
		} finally {
			setIsSaving(false);
		}
	}, [
		event.id,
		splitTime,
		beforeNotes,
		afterNotes,
		isValidSplitTime,
		onSplitComplete,
		onOpenChange,
		t,
	]);

	const handleClose = useCallback(() => {
		setSplitTime("");
		setBeforeNotes(metadata.notes || "");
		setAfterNotes("");
		onOpenChange(false);
	}, [metadata.notes, onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<IconScissors className="size-5" />
						<DialogTitle>{t("calendar.split.title", "Split Work Period")}</DialogTitle>
					</div>
					<DialogDescription>
						{t("calendar.split.description", "Divide this work period into two separate sessions.")}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Current work period info */}
					<div className="rounded-lg bg-muted p-3">
						<div className="text-sm font-medium">
							{t("calendar.split.currentPeriod", "Current Work Period")}
						</div>
						<div className="mt-1 text-lg font-semibold">
							{format(event.date, "p")} - {event.endDate ? format(event.endDate, "p") : "—"}
						</div>
						<div className="text-sm text-muted-foreground">
							{formatDuration(metadata.durationMinutes)}
						</div>
					</div>

					{/* Split time input */}
					<div className="space-y-2">
						<Label htmlFor="splitTime">{t("calendar.split.splitAt", "Split at")}</Label>
						<Input
							id="splitTime"
							type="time"
							value={splitTime}
							onChange={(e) => setSplitTime(e.target.value)}
							min={startTimeHHMM}
							max={endTimeHHMM}
							className="w-full"
						/>
						{splitTime && !isValidSplitTime && (
							<p className="text-sm text-destructive">
								{t("calendar.split.invalidTime", "Split time must be between start and end times")}
							</p>
						)}
					</div>

					{/* Preview */}
					{isValidSplitTime && previewDurations && (
						<div className="space-y-3 rounded-lg border p-3">
							<div className="text-sm font-medium">{t("calendar.split.preview", "Preview")}</div>

							{/* First period */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">
										{t("calendar.split.firstPeriod", "First Period")}
									</span>
									<span className="text-sm text-muted-foreground">
										{format(event.date, "p")} - {splitTime}
										<span className="ml-2">({formatDuration(previewDurations.first)})</span>
									</span>
								</div>
								<Textarea
									placeholder={t("calendar.split.firstNotes", "Notes for first period (optional)")}
									value={beforeNotes}
									onChange={(e) => setBeforeNotes(e.target.value)}
									rows={2}
									className="resize-none"
								/>
							</div>

							{/* Second period */}
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">
										{t("calendar.split.secondPeriod", "Second Period")}
									</span>
									<span className="text-sm text-muted-foreground">
										{splitTime} - {event.endDate ? format(event.endDate, "p") : "—"}
										<span className="ml-2">({formatDuration(previewDurations.second)})</span>
									</span>
								</div>
								<Textarea
									placeholder={t(
										"calendar.split.secondNotes",
										"Notes for second period (optional)",
									)}
									value={afterNotes}
									onChange={(e) => setAfterNotes(e.target.value)}
									rows={2}
									className="resize-none"
								/>
							</div>
						</div>
					)}
				</div>

				<DialogFooter className="gap-2 sm:gap-0">
					<Button variant="outline" onClick={handleClose} disabled={isSaving}>
						<IconX className="size-4 mr-1" />
						{t("common.cancel", "Cancel")}
					</Button>
					<Button onClick={handleSplit} disabled={!isValidSplitTime || isSaving}>
						{isSaving ? (
							<IconLoader2 className="size-4 animate-spin mr-1" />
						) : (
							<IconScissors className="size-4 mr-1" />
						)}
						{t("calendar.split.confirm", "Split Work Period")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
