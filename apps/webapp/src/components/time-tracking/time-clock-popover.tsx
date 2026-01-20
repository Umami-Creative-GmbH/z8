"use client";

import { IconCheck, IconClock, IconClockPause, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useElapsedTimer, useTimeClock } from "@/lib/query";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";
import { ProjectSelector } from "./project-selector";
import { WorkCategorySelector } from "./work-category-selector";

// Hoist DateTimeFormat to avoid recreation on each render (js-hoist-regexp)
const timeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});

export function TimeClockPopover() {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);

	const {
		hasEmployee,
		employeeId,
		isClockedIn,
		activeWorkPeriod,
		isLoading,
		clockIn,
		clockOut,
		updateNotes,
		isClockingOut,
		isUpdatingNotes,
		isMutating,
	} = useTimeClock();

	// Separate timer hook to isolate per-second re-renders to this component only
	const elapsedSeconds = useElapsedTimer(activeWorkPeriod?.startTime ?? null);

	// State for showing notes input after clock-out
	const [showNotesInput, setShowNotesInput] = useState(false);
	const [lastClockOutEntryId, setLastClockOutEntryId] = useState<string | null>(null);
	const [notesText, setNotesText] = useState("");
	// State for project selection
	const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined);
	// State for work category selection
	const [selectedWorkCategoryId, setSelectedWorkCategoryId] = useState<string | undefined>(undefined);

	const handleClockIn = async () => {
		const result = await clockIn();

		if (result.success) {
			toast.success(t("timeTracking.clockInSuccess", "Clocked in successfully"));
			setOpen(false);
		} else {
			const errorMessage = result.holidayName
				? t("timeTracking.errors.holidayBlocked", "Cannot clock in on {holidayName}", {
						holidayName: result.holidayName,
					})
				: result.error || t("timeTracking.errors.clockInFailed", "Failed to clock in");

			toast.error(errorMessage, {
				description: result.holidayName
					? t(
							"timeTracking.errors.holidayBlockedDesc",
							"This day is marked as a holiday and time entries are not allowed",
						)
					: undefined,
			});
		}
	};

	const handleClockOut = async () => {
		const result = await clockOut({
			projectId: selectedProjectId,
			workCategoryId: selectedWorkCategoryId,
		});

		if (result.success) {
			toast.success(t("timeTracking.clockOutSuccess", "Clocked out successfully"));
			// Reset selections after successful clock out
			setSelectedProjectId(undefined);
			setSelectedWorkCategoryId(undefined);
			// Show notes input and store the entry ID for patching
			if (result.data?.id) {
				setLastClockOutEntryId(result.data.id);
				setShowNotesInput(true);
				setNotesText("");
			} else {
				setOpen(false);
			}
		} else {
			const errorMessage = result.holidayName
				? t("timeTracking.errors.holidayBlocked", "Cannot clock out on {holidayName}", {
						holidayName: result.holidayName,
					})
				: result.error || t("timeTracking.errors.clockOutFailed", "Failed to clock out");

			toast.error(errorMessage, {
				description: result.holidayName
					? t(
							"timeTracking.errors.holidayBlockedDesc",
							"This day is marked as a holiday and time entries are not allowed",
						)
					: undefined,
			});
		}
	};

	const handleSaveNotes = async () => {
		if (!lastClockOutEntryId || !notesText.trim()) {
			setShowNotesInput(false);
			setOpen(false);
			return;
		}

		const result = await updateNotes({ entryId: lastClockOutEntryId, notes: notesText.trim() });

		if (result.success) {
			toast.success(t("timeTracking.notesSaved", "Notes saved"));
		} else {
			toast.error(result.error || t("timeTracking.errors.notesSaveFailed", "Failed to save notes"));
		}

		setShowNotesInput(false);
		setLastClockOutEntryId(null);
		setNotesText("");
		setOpen(false);
	};

	const handleDismissNotes = () => {
		setShowNotesInput(false);
		setLastClockOutEntryId(null);
		setNotesText("");
		setOpen(false);
	};

	// Don't render if still loading initial state
	if (isLoading) {
		return (
			<Button size="sm" disabled>
				<IconLoader2 className="size-4 animate-spin" />
				<span className="hidden sm:inline">{t("header.clock-in", "Clock In")}</span>
			</Button>
		);
	}

	// Don't render if user doesn't have an employee profile
	if (!hasEmployee) {
		return null;
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button size="sm" variant={isClockedIn ? "destructive" : "default"}>
					{isClockedIn ? <IconClockPause className="size-4" /> : <IconClock className="size-4" />}
					<span className="hidden sm:inline">
						{isClockedIn ? t("header.clock-out", "Clock Out") : t("header.clock-in", "Clock In")}
					</span>
					{isClockedIn && (
						<span className="hidden md:inline text-xs tabular-nums opacity-80">
							{formatDurationWithSeconds(elapsedSeconds)}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72" align="end">
				<div className="flex flex-col gap-3">
					{/* Notes input after clock-out */}
					{showNotesInput ? (
						<div className="flex flex-col gap-3 animate-in fade-in slide-in-from-top-2 duration-200">
							<div className="font-medium">
								{t("timeTracking.clockedOutSuccess", "You've clocked out!")}
							</div>
							<div className="text-sm text-muted-foreground">
								{t("timeTracking.addNotePrompt", "Add a note about your work (optional)")}
							</div>
							<Textarea
								name="notes"
								autoComplete="off"
								placeholder={t("timeTracking.notesPlaceholder", "What did you work on?")}
								value={notesText}
								onChange={(e) => setNotesText(e.target.value)}
								rows={3}
								className="resize-none"
								autoFocus
							/>
							<div className="flex gap-2">
								<Button
									size="sm"
									onClick={handleSaveNotes}
									disabled={isUpdatingNotes}
									className="flex-1"
								>
									{isUpdatingNotes ? (
										<IconLoader2 className="size-4 animate-spin" />
									) : (
										<IconCheck className="size-4" />
									)}
									{t("common.save", "Save")}
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={handleDismissNotes}
									disabled={isUpdatingNotes}
								>
									<IconX className="size-4" />
									{t("common.skip", "Skip")}
								</Button>
							</div>
						</div>
					) : (
						<>
							<div className="font-medium">
								{isClockedIn
									? t("timeTracking.currentlyClockedIn", "You're currently clocked in")
									: t("timeTracking.readyToClockIn", "Ready to start working?")}
							</div>

							{isClockedIn && activeWorkPeriod && (
								<div className="flex flex-col gap-1">
									<div className="font-bold text-2xl tabular-nums">
										{formatDurationWithSeconds(elapsedSeconds)}
									</div>
									<div className="text-muted-foreground text-sm">
										{t("timeTracking.startedAt", "Started at")}{" "}
										{timeFormatter.format(new Date(activeWorkPeriod.startTime))}
									</div>
								</div>
							)}

							{/* Project selector - only shown when clocked in */}
							{isClockedIn && (
								<ProjectSelector
									value={selectedProjectId}
									onValueChange={setSelectedProjectId}
									disabled={isMutating}
								/>
							)}

							{/* Work category selector - only shown when clocked in */}
							{isClockedIn && employeeId && (
								<WorkCategorySelector
									employeeId={employeeId}
									value={selectedWorkCategoryId}
									onValueChange={setSelectedWorkCategoryId}
									disabled={isMutating}
								/>
							)}

							<Button
								size="default"
								variant={isClockedIn ? "destructive" : "default"}
								onClick={isClockedIn ? handleClockOut : handleClockIn}
								disabled={isMutating}
								className="w-full"
							>
								{isMutating ? (
									<>
										<IconLoader2 className="size-4 animate-spin" />
										{isClockingOut
											? t("timeTracking.clockingOut", "Clocking Out…")
											: t("timeTracking.clockingIn", "Clocking In…")}
									</>
								) : isClockedIn ? (
									<>
										<IconClockPause className="size-4" />
										{t("timeTracking.clockOut", "Clock Out")}
									</>
								) : (
									<>
										<IconClock className="size-4" />
										{t("timeTracking.clockIn", "Clock In")}
									</>
								)}
							</Button>
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	);
}
