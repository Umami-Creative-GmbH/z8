"use client";

import {
	IconCheck,
	IconClock,
	IconClockPause,
	IconLoader2,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useReducer, useState } from "react";
import { toast } from "sonner";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useElapsedTimer, useTimeClock } from "@/lib/query";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";
import {
	normalizeWorkLocationType,
	type WorkLocationType,
} from "@/lib/time-tracking/work-location";
import {
	getTimeFormatDateTimeOptions,
	type TimeFormat,
} from "@/lib/user-preferences/time-format";
import { WorkLocationSelector } from "./clock-in-out-widget-parts";
import { ProjectSelector } from "./project-selector";
import { QuickBreakPopover } from "./quick-break-popover";
import { useQuickBreakHandler } from "./use-quick-break-handler";
import { WorkCategorySelector } from "./work-category-selector";

interface TimeClockPopoverState {
	showNotesInput: boolean;
	lastClockOutEntryId: string | null;
	notesText: string;
	selectedProjectId: string | undefined;
	selectedWorkCategoryId: string | undefined;
	workLocationType: WorkLocationType;
}

type TimeClockPopoverAction =
	| { type: "setNotesText"; value: string }
	| { type: "setSelectedProjectId"; value: string | undefined }
	| { type: "setSelectedWorkCategoryId"; value: string | undefined }
	| { type: "setWorkLocationType"; value: WorkLocationType }
	| { type: "openNotesInput"; entryId: string }
	| { type: "closeNotesInput" }
	| { type: "resetClockOutSelections" };

function getInitialWorkLocationType(): WorkLocationType {
	if (typeof window === "undefined") {
		return "office";
	}

	return normalizeWorkLocationType(
		localStorage.getItem("z8-work-location-type"),
	);
}

function createInitialState(): TimeClockPopoverState {
	return {
		showNotesInput: false,
		lastClockOutEntryId: null,
		notesText: "",
		selectedProjectId: undefined,
		selectedWorkCategoryId: undefined,
		workLocationType: getInitialWorkLocationType(),
	};
}

function timeClockPopoverReducer(
	state: TimeClockPopoverState,
	action: TimeClockPopoverAction,
): TimeClockPopoverState {
	switch (action.type) {
		case "setNotesText":
			return { ...state, notesText: action.value };
		case "setSelectedProjectId":
			return { ...state, selectedProjectId: action.value };
		case "setSelectedWorkCategoryId":
			return { ...state, selectedWorkCategoryId: action.value };
		case "setWorkLocationType":
			return { ...state, workLocationType: action.value };
		case "openNotesInput":
			return {
				...state,
				showNotesInput: true,
				lastClockOutEntryId: action.entryId,
				notesText: "",
			};
		case "closeNotesInput":
			return {
				...state,
				showNotesInput: false,
				lastClockOutEntryId: null,
				notesText: "",
			};
		case "resetClockOutSelections":
			return {
				...state,
				selectedProjectId: undefined,
				selectedWorkCategoryId: undefined,
			};
	}
}

type Translate = ReturnType<typeof useTranslate>["t"];

interface ClockOutNotesViewProps {
	isUpdatingNotes: boolean;
	notesText: string;
	onDismiss: () => void;
	onNotesChange: (value: string) => void;
	onSave: () => void;
	t: Translate;
}

function ClockOutNotesView({
	isUpdatingNotes,
	notesText,
	onDismiss,
	onNotesChange,
	onSave,
	t,
}: ClockOutNotesViewProps) {
	return (
		<div className="flex flex-col gap-3 transition-[opacity,transform] animate-in fade-in slide-in-from-top-2 duration-200">
			<div className="font-medium">
				{t("timeTracking.clockedOutSuccess", "You've clocked out!")}
			</div>
			<div className="text-sm text-muted-foreground">
				{t(
					"timeTracking.addNotePrompt",
					"Add a note about your work (optional)",
				)}
			</div>
			<Textarea
				name="notes"
				autoComplete="off"
				placeholder={t(
					"timeTracking.notesPlaceholder",
					"What did you work on?",
				)}
				value={notesText}
				onChange={(event) => onNotesChange(event.target.value)}
				rows={3}
				className="resize-none"
			/>
			<div className="flex gap-2">
				<Button
					size="sm"
					onClick={onSave}
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
					onClick={onDismiss}
					disabled={isUpdatingNotes}
				>
					<IconX className="size-4" />
					{t("common.skip", "Skip")}
				</Button>
			</div>
		</div>
	);
}

interface ClockControlsViewProps {
	activeStartTime: string | Date | null;
	elapsedSeconds: number;
	employeeId: string | null | undefined;
	isClockedIn: boolean;
	isClockingOut: boolean;
	isMutating: boolean;
	onClockAction: () => void;
	onProjectChange: (value: string | undefined) => void;
	onWorkCategoryChange: (value: string | undefined) => void;
	onWorkLocationChange: (value: WorkLocationType) => void;
	selectedProjectId: string | undefined;
	selectedWorkCategoryId: string | undefined;
	t: Translate;
	timeFormatter: Intl.DateTimeFormat;
	workLocationType: WorkLocationType;
}

function ClockControlsView({
	activeStartTime,
	elapsedSeconds,
	employeeId,
	isClockedIn,
	isClockingOut,
	isMutating,
	onClockAction,
	onProjectChange,
	onWorkCategoryChange,
	onWorkLocationChange,
	selectedProjectId,
	selectedWorkCategoryId,
	t,
	timeFormatter,
	workLocationType,
}: ClockControlsViewProps) {
	return (
		<>
			<div className="font-medium">
				{isClockedIn
					? t("timeTracking.currentlyClockedIn", "You're currently clocked in")
					: t("timeTracking.readyToClockIn", "Ready to start working?")}
			</div>
			{isClockedIn && activeStartTime && (
				<div className="flex flex-col gap-1">
					<div className="font-bold text-2xl tabular-nums">
						{formatDurationWithSeconds(elapsedSeconds)}
					</div>
					<div className="text-muted-foreground text-sm">
						{t("timeTracking.startedAt", "Started at")}{" "}
						{timeFormatter.format(new Date(activeStartTime))}
					</div>
				</div>
			)}
			{isClockedIn && (
				<ProjectSelector
					value={selectedProjectId}
					onValueChange={onProjectChange}
					disabled={isMutating}
				/>
			)}
			{isClockedIn && employeeId && (
				<WorkCategorySelector
					employeeId={employeeId}
					value={selectedWorkCategoryId}
					onValueChange={onWorkCategoryChange}
					disabled={isMutating}
				/>
			)}
			{!isClockedIn && (
				<WorkLocationSelector
					value={workLocationType}
					onChange={onWorkLocationChange}
					t={t}
				/>
			)}
			<div className="flex gap-2">
				<Button
					size="default"
					variant={isClockedIn ? "destructive" : "default"}
					onClick={onClockAction}
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
			</div>
		</>
	);
}

export function TimeClockPopover({
	timeFormat = "24h",
}: {
	timeFormat?: TimeFormat;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timezone = useUserTimezone();
	const [open, setOpen] = useState(false);
	const [uiState, dispatch] = useReducer(
		timeClockPopoverReducer,
		undefined,
		createInitialState,
	);
	const timeFormatter = Intl.DateTimeFormat(locale, {
		...getTimeFormatDateTimeOptions(timeFormat),
		timeZone: timezone,
	});

	const {
		hasEmployee,
		employeeId,
		isClockedIn,
		activeWorkPeriod,
		isLoading,
		clockIn,
		clockOut,
		addBreak,
		updateNotes,
		isClockingOut,
		isAddingBreak,
		isUpdatingNotes,
		isMutating,
	} = useTimeClock();
	const handleAddBreak = useQuickBreakHandler(addBreak, t);

	// Separate timer hook to isolate per-second re-renders to this component only
	const elapsedSeconds = useElapsedTimer(activeWorkPeriod?.startTime ?? null);

	const handleClockIn = async () => {
		const result = await clockIn({
			workLocationType: uiState.workLocationType,
		});

		if (result.success) {
			if (typeof window !== "undefined") {
				localStorage.setItem("z8-work-location-type", uiState.workLocationType);
			}

			// Check if this was an offline queued request
			if ("queued" in result && result.queued) {
				toast.info(t("timeTracking.clockInQueued", "Clock-in queued for sync"));
			} else {
				toast.success(
					t("timeTracking.clockInSuccess", "Clocked in successfully"),
				);
			}
			setOpen(false);
		} else {
			const holidayName =
				"holidayName" in result ? result.holidayName : undefined;
			const errorMessage = holidayName
				? t(
						"timeTracking.errors.holidayBlocked",
						"Cannot clock in on {holidayName}",
						{
							holidayName,
						},
					)
				: result.error ||
					t("timeTracking.errors.clockInFailed", "Failed to clock in");

			toast.error(errorMessage, {
				description: holidayName
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
			projectId: uiState.selectedProjectId,
			workCategoryId: uiState.selectedWorkCategoryId,
		});

		if (result.success) {
			// Check if this was an offline queued request
			if ("queued" in result && result.queued) {
				toast.info(
					t("timeTracking.clockOutQueued", "Clock-out queued for sync"),
				);
				dispatch({ type: "resetClockOutSelections" });
				setOpen(false);
				return;
			}

			toast.success(
				t("timeTracking.clockOutSuccess", "Clocked out successfully"),
			);
			// Reset selections after successful clock out
			dispatch({ type: "resetClockOutSelections" });
			// Show notes input and store the entry ID for patching (only for non-queued)
			if ("data" in result && result.data?.id) {
				dispatch({ type: "openNotesInput", entryId: result.data.id });
			} else {
				setOpen(false);
			}
		} else {
			const holidayName =
				"holidayName" in result ? result.holidayName : undefined;
			const errorMessage = holidayName
				? t(
						"timeTracking.errors.holidayBlocked",
						"Cannot clock out on {holidayName}",
						{
							holidayName,
						},
					)
				: result.error ||
					t("timeTracking.errors.clockOutFailed", "Failed to clock out");

			toast.error(errorMessage, {
				description: holidayName
					? t(
							"timeTracking.errors.holidayBlockedDesc",
							"This day is marked as a holiday and time entries are not allowed",
						)
					: undefined,
			});
		}
	};

	const handleSaveNotes = async () => {
		if (!uiState.lastClockOutEntryId || !uiState.notesText.trim()) {
			dispatch({ type: "closeNotesInput" });
			setOpen(false);
			return;
		}

		const result = await updateNotes({
			entryId: uiState.lastClockOutEntryId,
			notes: uiState.notesText.trim(),
		});

		if (result.success) {
			toast.success(t("timeTracking.notesSaved", "Notes saved"));
		} else {
			toast.error(
				result.error ||
					t("timeTracking.errors.notesSaveFailed", "Failed to save notes"),
			);
		}

		dispatch({ type: "closeNotesInput" });
		setOpen(false);
	};

	const handleDismissNotes = () => {
		dispatch({ type: "closeNotesInput" });
		setOpen(false);
	};

	// Don't render if still loading initial state
	if (isLoading) {
		return (
			<Button aria-label={t("header.clock-in", "Clock In")} size="sm" disabled>
				<IconLoader2 className="size-4 animate-spin" />
				<span className="hidden sm:inline">
					{t("header.clock-in", "Clock In")}
				</span>
			</Button>
		);
	}

	// Don't render if user doesn't have an employee profile
	if (!hasEmployee) {
		return null;
	}

	return (
		<div className="flex items-center gap-2">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						aria-label={
							isClockedIn
								? t("header.clock-out", "Clock Out")
								: t("header.clock-in", "Clock In")
						}
						size="sm"
						variant={isClockedIn ? "destructive" : "default"}
						className={isClockedIn ? "rounded-r-none" : undefined}
					>
						{isClockedIn ? (
							<IconClockPause className="size-4" />
						) : (
							<IconClock className="size-4" />
						)}
						<span className="hidden sm:inline">
							{isClockedIn
								? t("header.clock-out", "Clock Out")
								: t("header.clock-in", "Clock In")}
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
						{uiState.showNotesInput ? (
							<ClockOutNotesView
								isUpdatingNotes={isUpdatingNotes}
								notesText={uiState.notesText}
								onDismiss={handleDismissNotes}
								onNotesChange={(value) =>
									dispatch({ type: "setNotesText", value })
								}
								onSave={handleSaveNotes}
								t={t}
							/>
						) : (
							<ClockControlsView
								activeStartTime={activeWorkPeriod?.startTime ?? null}
								elapsedSeconds={elapsedSeconds}
								employeeId={employeeId}
								isClockedIn={isClockedIn}
								isClockingOut={isClockingOut}
								isMutating={isMutating}
								onClockAction={isClockedIn ? handleClockOut : handleClockIn}
								onProjectChange={(value) =>
									dispatch({ type: "setSelectedProjectId", value })
								}
								onWorkCategoryChange={(value) =>
									dispatch({ type: "setSelectedWorkCategoryId", value })
								}
								onWorkLocationChange={(value) =>
									dispatch({ type: "setWorkLocationType", value })
								}
								selectedProjectId={uiState.selectedProjectId}
								selectedWorkCategoryId={uiState.selectedWorkCategoryId}
								t={t}
								timeFormatter={timeFormatter}
								workLocationType={uiState.workLocationType}
							/>
						)}
					</div>
				</PopoverContent>
			</Popover>
			{isClockedIn ? (
				<QuickBreakPopover
					onAddBreak={handleAddBreak}
					isAddingBreak={isAddingBreak}
					isDisabled={isMutating}
					t={t}
					buttonClassName="-ml-2 h-8 rounded-l-none border-l-0 px-2.5"
					iconOnly
				/>
			) : null}
		</div>
	);
}
