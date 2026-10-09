"use client";

import {
	ClockCaptureControls,
	type ClockCaptureMode,
} from "@/components/offline/offline-capture-actions";

import {
	IconCheck,
	IconClock,
	IconClockPause,
	IconLoader2,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
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
import {
	type BookedProjectTask,
	projectTaskRefusalMessage,
} from "@/lib/projects/project-task-model";
import type { AssignedProject } from "@/lib/query/use-assigned-projects";
import { namedTaskId, taskIdToSend } from "@/lib/time-tracking/task-attribution";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import {
	getTimeFormatDateTimeOptions,
	type TimeFormat,
} from "@/lib/user-preferences/time-format";
import { showAppendReviewRequiredToast } from "./append-review-toast";
import { billableChoice } from "./billable-choice";
import { BillableWorkSwitch } from "./billable-work-switch";
import { showSavedClockToast } from "./saved-clock-toast";
import { WorkLocationSelector } from "./clock-in-out-widget-parts";
import { ProjectSelectorView } from "./project-selector";
import { QuickBreakPopover } from "./quick-break-popover";
import { TaskSelectorView } from "./task-selector";
import type { WorkCategory } from "./use-available-work-categories";
import { useQuickBreakHandler } from "./use-quick-break-handler";
import { useTimeClockPopoverState } from "./use-time-clock-popover-state";
import { WorkCategorySelectorView } from "./work-category-selector";

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
	captureMode: ClockCaptureMode;
	onClockIn: () => Promise<void>;
	onClockOut: () => Promise<void>;
	activeStartTime: string | Date | null;
	elapsedSeconds: number;
	employeeId: string | null | undefined;
	isClockedIn: boolean;
	isClockingOut: boolean;
	isMutating: boolean;
	onClockAction: () => void;
	onProjectChange: (value: string | undefined) => void;
	billable: boolean | undefined;
	onBillableChange: (value: boolean) => void;
	onTaskChange: (value: string | undefined) => void;
	onWorkCategoryChange: (value: string | undefined) => void;
	onWorkLocationChange: (value: WorkLocationType) => void;
	projects: AssignedProject[];
	projectsIsError: boolean;
	projectsIsLoading: boolean;
	selectedProjectId: string | undefined;
	selectedTaskId: string | undefined;
	/** The running work's task (#874), shown while its project is chosen. */
	currentTask: BookedProjectTask | null;
	selectedWorkCategoryId: string | undefined;
	t: Translate;
	timeFormatter: Intl.DateTimeFormat;
	workCategories: WorkCategory[];
	workCategoriesIsError: boolean;
	workCategoriesIsLoading: boolean;
	workLocationType: WorkLocationType;
}

function ClockControlsView({
	captureMode,
	onClockIn,
	onClockOut,
	activeStartTime,
	elapsedSeconds,
	employeeId,
	isClockedIn,
	isClockingOut,
	isMutating,
	onClockAction,
	onProjectChange,
	billable,
	onBillableChange,
	onTaskChange,
	onWorkCategoryChange,
	onWorkLocationChange,
	projects,
	projectsIsError,
	projectsIsLoading,
	selectedProjectId,
	selectedTaskId,
	currentTask,
	selectedWorkCategoryId,
	t,
	timeFormatter,
	workCategories,
	workCategoriesIsError,
	workCategoriesIsLoading,
	workLocationType,
}: ClockControlsViewProps) {
	// Offline controls cannot trust the last server status, so both ends stay open.
	const isLocalCapture = captureMode !== "server";
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
			{(isClockedIn || isLocalCapture) && (
				<ProjectSelectorView
					value={selectedProjectId}
					onValueChange={onProjectChange}
					disabled={isMutating}
					projects={projects}
					isLoading={projectsIsLoading}
					isError={projectsIsError}
				/>
			)}
			{/* Server and frozen clock-outs carry a task; the legacy review queue keeps the project only. */}
			{(isClockedIn || isLocalCapture) &&
				captureMode !== "local-review" &&
				!projectsIsLoading &&
				!projectsIsError && (
				<TaskSelectorView
					projectId={selectedProjectId}
					projects={projects}
					value={selectedTaskId}
					onValueChange={onTaskChange}
					currentTask={currentTask}
					disabled={isMutating}
				/>
			)}
			{(isClockedIn || isLocalCapture) && (
				<BillableWorkSwitch
					choice={billableChoice({
						project: projects.find((project) => project.id === selectedProjectId),
						explicit: billable,
					})}
					onChange={onBillableChange}
					disabled={isMutating}
				/>
			)}
			{(isClockedIn || isLocalCapture) && employeeId && (
				<WorkCategorySelectorView
					employeeId={employeeId}
					value={selectedWorkCategoryId}
					onValueChange={onWorkCategoryChange}
					disabled={isMutating}
					categories={workCategories}
					isLoading={workCategoriesIsLoading}
					isError={workCategoriesIsError}
				/>
			)}
			{(!isClockedIn || isLocalCapture) && (
				<WorkLocationSelector
					value={workLocationType}
					onChange={onWorkLocationChange}
					t={t}
				/>
			)}
			<ClockCaptureControls
				mode={captureMode}
				onClockIn={onClockIn}
				onClockOut={onClockOut}
				disabled={isMutating}
			>
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
			</ClockCaptureControls>
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
		captureMode,
	} = useTimeClock();
	const { uiState, dispatch, assignedProjects, availableWorkCategories } =
		useTimeClockPopoverState({ employeeId, isClockedIn });
	const handleAddBreak = useQuickBreakHandler(addBreak, t);

	// The running work's task shows while its project is chosen and no other choice
	// was made; the clock-out then keeps it (#874).
	const currentTask = isClockedIn ? (activeWorkPeriod?.currentTask ?? null) : null;
	const followsCurrentTask =
		uiState.selectedTaskId === undefined &&
		currentTask !== null &&
		currentTask.projectId === uiState.selectedProjectId;
	const shownTaskId = followsCurrentTask ? currentTask?.id : (uiState.selectedTaskId ?? undefined);

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

			// Saved on this device, not confirmed on the server
			if (!showSavedClockToast(result, "clock_in", t)) {
				toast.success(
					t("timeTracking.clockInSuccess", "Clocked in successfully"),
				);
			}
			setOpen(false);
		} else if (!showAppendReviewRequiredToast(result, t)) {
			const holidayName =
				"holidayName" in result ? result.holidayName : undefined;
			const errorMessage = holidayName
				? t(
						"timeTracking.errors.holidayBlockedClockIn",
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
		// Untouched or left on the running work's task, the clock-out names no task and
		// the server keeps it while the project stays; any other choice is explicit.
		const taskId =
			uiState.selectedTaskId === undefined
				? undefined
				: taskIdToSend({
						projectId: uiState.selectedProjectId,
						taskId: uiState.selectedTaskId,
						current: { projectId: currentTask?.projectId, taskId: currentTask?.id },
					});
		const result = await clockOut({
			projectId: uiState.selectedProjectId,
			workCategoryId: uiState.selectedWorkCategoryId,
			// The legacy review queue carries no task (#874), so it shows no task picker.
			...(captureMode !== "local-review" ? namedTaskId(taskId) : {}),
			...(uiState.billable === undefined ? {} : { billable: uiState.billable }),
		});

		if (result.success) {
			// Saved on this device, not confirmed on the server
			if (showSavedClockToast(result, "clock_out", t)) {
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
			// A refused task names its stable reason (#873), worded here.
			const taskRefusal = projectTaskRefusalMessage(
				"code" in result && typeof result.code === "string" ? result.code : null,
			);
			const taskMessage = taskRefusal ? t(taskRefusal[0], taskRefusal[1]) : null;
			const errorMessage = holidayName
				? t(
						"timeTracking.errors.holidayBlocked",
						"Cannot clock out on {holidayName}",
						{
							holidayName,
						},
					)
				: taskMessage ||
					result.error ||
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
								captureMode={captureMode}
								onClockIn={handleClockIn}
								onClockOut={handleClockOut}
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
								billable={uiState.billable}
								onBillableChange={(value) => dispatch({ type: "setBillable", value })}
								onTaskChange={(value) =>
									dispatch({ type: "setSelectedTaskId", value: value ?? null })
								}
								onWorkCategoryChange={(value) =>
									dispatch({ type: "setSelectedWorkCategoryId", value })
								}
								onWorkLocationChange={(value) =>
									dispatch({ type: "setWorkLocationType", value })
								}
								projects={assignedProjects.projects}
								projectsIsError={assignedProjects.isError}
								projectsIsLoading={assignedProjects.isLoading}
								selectedProjectId={uiState.selectedProjectId}
								selectedTaskId={shownTaskId}
								currentTask={currentTask}
								selectedWorkCategoryId={uiState.selectedWorkCategoryId}
								t={t}
								timeFormatter={timeFormatter}
								workCategories={availableWorkCategories.categories}
								workCategoriesIsError={availableWorkCategories.isError}
								workCategoriesIsLoading={availableWorkCategories.isLoading}
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
