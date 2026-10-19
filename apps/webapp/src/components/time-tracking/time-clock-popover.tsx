"use client";

import {
	IconCheck,
	IconLoader2,
	IconPlayerPause,
	IconPlayerPlay,
	IconPlayerStop,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { DrivingAuthorizationAdvisory } from "@/components/driving-licence/operational-status";
import {
	ClockCaptureControls,
	type ClockCaptureMode,
} from "@/components/offline/offline-capture-actions";
import { useUserTimezone } from "@/components/providers/user-preferences-provider";
import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
	type BookedProjectTask,
	projectTaskRefusalMessage,
} from "@/lib/projects/project-task-model";
import { isTaskRequirementActive } from "@/lib/projects/task-requirement";
import { useElapsedTimer, useTimeClock } from "@/lib/query";
import type { AssignedProject } from "@/lib/query/use-assigned-projects";
import {
	namedTaskId,
	taskIdToSend,
} from "@/lib/time-tracking/task-attribution";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";
import type { WorkLocationType } from "@/lib/time-tracking/work-location";
import {
	getTimeFormatDateTimeOptions,
	type TimeFormat,
} from "@/lib/user-preferences/time-format";
import { showAppendReviewRequiredToast } from "./append-review-toast";
import { billableChoice } from "./billable-choice";
import { BillableWorkSwitch } from "./billable-work-switch";
import {
	BreakConnectionNote,
	OnBreakActions,
	StartBreakButton,
} from "./break-in-progress-actions";
import { breakInProgressHandlers } from "./break-in-progress-handlers";
import { BreakInProgressNotice } from "./break-in-progress-notice";
import { toastClockCommandError } from "./clock-command-error-toast";
import { ClockConnectionNotice } from "./clock-connection-notice";
import { WorkLocationSelector } from "./clock-in-out-widget-parts";
import {
	BreakVehicleReading,
	ClockInVehicleUse,
	ClockOutVehicleUse,
	type ClockVehicleUseState,
	useClockVehicleUse,
} from "./clock-vehicle-use";
import { warnVehicleUseLeftOut } from "./clock-vehicle-use-notice";
import { ProjectSelectorView } from "./project-selector";
import { QuickBreakPopover } from "./quick-break-popover";
import { showSavedClockToast } from "./saved-clock-toast";
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
	/** The last clock command needs a connection in this organization (#845). */
	connectionRequired: boolean;
	onClockIn: () => Promise<void>;
	onClockOut: () => Promise<void>;
	activeStartTime: string | Date | null;
	/** An open break in progress (#861), read-only. */
	breakInProgress: { since: Date; zone: string | null } | null;
	timeFormat: TimeFormat;
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
	/** Vehicle use asked at this clock event (#1122). */
	vehicleUse: ClockVehicleUseState;
	/** The chosen project requires a task and none is chosen or kept (#884). */
	clockOutNeedsTask: boolean;
	/** Start Break and Resume (#888); online only. */
	onStartBreak: () => void;
	onResumeBreak: () => void;
	isStartingBreak: boolean;
	isResumingBreak: boolean;
	isOffline: boolean;
}

function ActiveClockSummary({
	activeStartTime,
	breakInProgress,
	elapsedSeconds,
	t,
	timeFormat,
	timeFormatter,
}: Pick<
	ClockControlsViewProps,
	"breakInProgress" | "elapsedSeconds" | "t" | "timeFormat" | "timeFormatter"
> & { activeStartTime: string | Date }) {
	return (
		<div className="flex flex-col gap-1">
			<div className="font-bold text-2xl tabular-nums">
				{formatDurationWithSeconds(elapsedSeconds)}
			</div>
			<div className="text-muted-foreground text-sm">
				{t("timeTracking.startedAt", "Started at")}{" "}
				{timeFormatter.format(new Date(activeStartTime))}
			</div>
			{breakInProgress ? (
				<BreakInProgressNotice
					since={breakInProgress.since}
					zone={breakInProgress.zone}
					timeFormat={timeFormat}
				/>
			) : null}
		</div>
	);
}

function ClockBookingChoices({
	billable,
	captureMode,
	currentTask,
	employeeId,
	isMutating,
	onBillableChange,
	onProjectChange,
	onTaskChange,
	onWorkCategoryChange,
	projects,
	projectsIsError,
	projectsIsLoading,
	selectedProjectId,
	selectedTaskId,
	selectedWorkCategoryId,
	workCategories,
	workCategoriesIsError,
	workCategoriesIsLoading,
}: Pick<
	ClockControlsViewProps,
	| "billable"
	| "captureMode"
	| "currentTask"
	| "employeeId"
	| "isMutating"
	| "onBillableChange"
	| "onProjectChange"
	| "onTaskChange"
	| "onWorkCategoryChange"
	| "projects"
	| "projectsIsError"
	| "projectsIsLoading"
	| "selectedProjectId"
	| "selectedTaskId"
	| "selectedWorkCategoryId"
	| "workCategories"
	| "workCategoriesIsError"
	| "workCategoriesIsLoading"
>) {
	return (
		<>
			<ProjectSelectorView
				value={selectedProjectId}
				onValueChange={onProjectChange}
				disabled={isMutating}
				projects={projects}
				isLoading={projectsIsLoading}
				isError={projectsIsError}
			/>
			{/* Server and frozen clock-outs carry a task; the legacy review queue keeps the project only. */}
			{captureMode !== "local-review" &&
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
			<BillableWorkSwitch
				choice={billableChoice({
					project: projects.find((project) => project.id === selectedProjectId),
					explicit: billable,
				})}
				onChange={onBillableChange}
				disabled={isMutating}
			/>
			{employeeId && (
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
		</>
	);
}

function ClockVehicleUseField({
	captureMode,
	isClockedIn,
	isMutating,
	t,
	vehicleUse,
}: Pick<
	ClockControlsViewProps,
	"captureMode" | "isClockedIn" | "isMutating" | "t" | "vehicleUse"
>) {
	// The legacy review queue keeps no vehicle use; it carries no attribution beyond a project.
	if (captureMode === "local-review") return null;
	return isClockedIn ? (
		<ClockOutVehicleUse state={vehicleUse} disabled={isMutating} t={t} />
	) : (
		<ClockInVehicleUse state={vehicleUse} disabled={isMutating} t={t} />
	);
}

function ClockControlsView(props: ClockControlsViewProps) {
	const {
		captureMode,
		connectionRequired,
		activeStartTime,
		isClockedIn,
		onWorkLocationChange,
		t,
		workLocationType,
	} = props;
	// Offline controls cannot trust the last server status, so both ends stay open.
	const isLocalCapture = captureMode !== "server";
	const showBookingChoices = isClockedIn || isLocalCapture;
	return (
		<>
			<div className="font-medium">
				{props.breakInProgress
					? t("timeTracking.breakInProgress.description", "You're on a break")
					: isClockedIn
						? t("timeTracking.currentlyClockedIn", "You're currently clocked in")
						: t("timeTracking.readyToClockIn", "Ready to start working?")}
			</div>
			{isClockedIn && activeStartTime && (
				<ActiveClockSummary {...props} activeStartTime={activeStartTime} />
			)}
			{showBookingChoices && <ClockBookingChoices {...props} />}
			{(!isClockedIn || isLocalCapture) && (
				<WorkLocationSelector
					value={workLocationType}
					onChange={onWorkLocationChange}
					t={t}
				/>
			)}
			<ClockVehicleUseField {...props} />
			<DrivingAuthorizationAdvisory />
			<ClockConnectionNotice show={connectionRequired} />
			<ClockActionButtons {...props} />
			<BreakConnectionNote show={props.isOffline && isClockedIn} t={t} />
		</>
	);
}

function useTimeClockPopoverController({
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
		startBreak,
		resumeBreak,
		updateNotes,
		isClockingOut,
		isAddingBreak,
		isStartingBreak,
		isResumingBreak,
		isUpdatingNotes,
		isMutating,
		isOffline,
		captureMode,
		connectionRequired,
	} = useTimeClock();
	const { uiState, dispatch, assignedProjects, availableWorkCategories } =
		useTimeClockPopoverState({ employeeId, isClockedIn });
	const vehicleUse = useClockVehicleUse({ enabled: hasEmployee });
	const handleAddBreak = useQuickBreakHandler(addBreak, t, vehicleUse);
	const { handleStartBreak, handleResumeBreak } = breakInProgressHandlers(
		{ startBreak, resumeBreak },
		t,
	);
	const isOnBreak = isClockedIn && Boolean(activeWorkPeriod?.breakStartedAt);

	// The running work's task shows while its project is chosen and no other choice
	// was made; the clock-out then keeps it (#874).
	const currentTask = isClockedIn
		? (activeWorkPeriod?.currentTask ?? null)
		: null;
	const followsCurrentTask =
		uiState.selectedTaskId === undefined &&
		currentTask !== null &&
		currentTask.projectId === uiState.selectedProjectId;
	const shownTaskId = followsCurrentTask
		? currentTask?.id
		: (uiState.selectedTaskId ?? undefined);
	// A project with an active task requirement holds a server clock-out until a
	// task is chosen or kept (#884); the server refusal stays the backstop. A
	// clock-out saved on this device is accepted without one, and so is a break.
	const chosenProject = assignedProjects.projects.find(
		(project) => project.id === uiState.selectedProjectId,
	);
	const clockOutNeedsTask =
		isClockedIn &&
		captureMode === "server" &&
		chosenProject !== undefined &&
		isTaskRequirementActive({
			requiresTask: chosenProject.requiresTask,
			hasOpenTask: chosenProject.tasks.length > 0,
		}) &&
		!shownTaskId;

	// Separate timer hook to isolate per-second re-renders to this component only
	const elapsedSeconds = useElapsedTimer(activeWorkPeriod?.startTime ?? null);

	const handleClockIn = async () => {
		// Vehicle use never holds the clock-in: what cannot be sent is left out (#1122).
		const vehicle = vehicleUse.clockIn;
		const result = await clockIn({
			workLocationType: uiState.workLocationType,
			...(vehicle.ok && vehicle.vehicleUse
				? { vehicleUse: vehicle.vehicleUse }
				: {}),
		});

		if (result.success) {
			if (typeof window !== "undefined") {
				localStorage.setItem("z8-work-location-type", uiState.workLocationType);
			}
			warnVehicleUseLeftOut(vehicle, t, result);
			vehicleUse.reset();

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

			toastClockCommandError(result, errorMessage, {
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
						current: {
							projectId: currentTask?.projectId,
							taskId: currentTask?.id,
						},
					});
		const vehicle = vehicleUse.clockOut;
		const result = await clockOut({
			projectId: uiState.selectedProjectId,
			workCategoryId: uiState.selectedWorkCategoryId,
			// The legacy review queue carries no task (#874), so it shows no task picker.
			...(captureMode !== "local-review" ? namedTaskId(taskId) : {}),
			...(uiState.billable === undefined ? {} : { billable: uiState.billable }),
			...(vehicle.ok && vehicle.vehicleUse
				? { vehicleUse: vehicle.vehicleUse }
				: {}),
		});

		if (result.success) {
			warnVehicleUseLeftOut(vehicle, t, result);
			vehicleUse.reset();
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
				"code" in result && typeof result.code === "string"
					? result.code
					: null,
			);
			const taskMessage = taskRefusal
				? t(taskRefusal[0], taskRefusal[1])
				: null;
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

			toastClockCommandError(result, errorMessage, {
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
	return {
		isLoading,
		t,
		hasEmployee,
		open,
		setOpen,
		isClockedIn,
		elapsedSeconds,
		uiState,
		isUpdatingNotes,
		handleDismissNotes,
		dispatch,
		handleSaveNotes,
		captureMode,
		connectionRequired,
		handleClockIn,
		handleClockOut,
		activeWorkPeriod,
		employeeId,
		isClockingOut,
		isMutating,
		assignedProjects,
		shownTaskId,
		currentTask,
		timeFormatter,
		availableWorkCategories,
		handleAddBreak,
		isAddingBreak,
		vehicleUse,
		clockOutNeedsTask,
		handleStartBreak,
		handleResumeBreak,
		isStartingBreak,
		isResumingBreak,
		isOffline,
		isOnBreak,
	};
}

type TimeClockPopoverController = ReturnType<
	typeof useTimeClockPopoverController
>;

function TimeClockLoadingButton({ t }: { t: Translate }) {
	return (
		<Button aria-label={t("header.clock-in", "Clock In")} size="sm" disabled>
			<IconLoader2 className="size-4 animate-spin" />
			<span className="hidden sm:inline">
				{t("header.clock-in", "Clock In")}
			</span>
		</Button>
	);
}

function TimeClockTriggerContent({
	elapsedSeconds,
	isClockedIn,
	isOnBreak,
	label,
}: {
	elapsedSeconds: number;
	isClockedIn: boolean;
	isOnBreak: boolean;
	label: string;
}) {
	// The clock's state as a player: stopped, playing, or paused for a break (#888).
	const Icon = isOnBreak ? IconPlayerPause : isClockedIn ? IconPlayerStop : IconPlayerPlay;
	return (
		<>
			<Icon aria-hidden="true" className="size-4" />
			<span className="hidden sm:inline">{label}</span>
			{isClockedIn && (
				<span className="hidden md:inline text-xs tabular-nums opacity-80">
					{formatDurationWithSeconds(elapsedSeconds)}
				</span>
			)}
		</>
	);
}

function TimeClockPopoverPanel({
	controller,
	timeFormat,
}: {
	controller: TimeClockPopoverController;
	timeFormat: TimeFormat;
}) {
	const {
		t,
		isClockedIn,
		elapsedSeconds,
		uiState,
		isUpdatingNotes,
		handleDismissNotes,
		dispatch,
		handleSaveNotes,
		captureMode,
		connectionRequired,
		handleClockIn,
		handleClockOut,
		activeWorkPeriod,
		employeeId,
		isClockingOut,
		isMutating,
		assignedProjects,
		shownTaskId,
		currentTask,
		timeFormatter,
		availableWorkCategories,
		vehicleUse,
		clockOutNeedsTask,
		handleStartBreak,
		handleResumeBreak,
		isStartingBreak,
		isResumingBreak,
		isOffline,
	} = controller;

	if (uiState.showNotesInput) {
		return (
			<ClockOutNotesView
				isUpdatingNotes={isUpdatingNotes}
				notesText={uiState.notesText}
				onDismiss={handleDismissNotes}
				onNotesChange={(value) => dispatch({ type: "setNotesText", value })}
				onSave={handleSaveNotes}
				t={t}
			/>
		);
	}

	return (
		<ClockControlsView
			captureMode={captureMode}
			connectionRequired={connectionRequired}
			onClockIn={handleClockIn}
			onClockOut={handleClockOut}
			activeStartTime={activeWorkPeriod?.startTime ?? null}
			breakInProgress={
				isClockedIn && activeWorkPeriod?.breakStartedAt
					? {
							since: activeWorkPeriod.breakStartedAt,
							zone: activeWorkPeriod.breakStartedZone ?? null,
						}
					: null
			}
			timeFormat={timeFormat}
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
			vehicleUse={vehicleUse}
			clockOutNeedsTask={clockOutNeedsTask}
			onStartBreak={() => void handleStartBreak()}
			onResumeBreak={() => void handleResumeBreak()}
			isStartingBreak={isStartingBreak}
			isResumingBreak={isResumingBreak}
			isOffline={isOffline}
		/>
	);
}

export function TimeClockPopover({
	timeFormat = "24h",
}: {
	timeFormat?: TimeFormat;
}) {
	const controller = useTimeClockPopoverController({ timeFormat });
	const {
		isLoading,
		t,
		hasEmployee,
		open,
		setOpen,
		isClockedIn,
		elapsedSeconds,
		isMutating,
		handleAddBreak,
		isAddingBreak,
		vehicleUse,
		isOnBreak,
	} = controller;
	if (isLoading) {
		return <TimeClockLoadingButton t={t} />;
	}

	// Don't render if user doesn't have an employee profile
	if (!hasEmployee) {
		return null;
	}

	const triggerLabel = isOnBreak
		? t("timeTracking.breakInProgress.trigger", "On break")
		: isClockedIn
			? t("header.clock-out", "Clock Out")
			: t("header.clock-in", "Clock In");

	return (
		<div className="flex items-center gap-2">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						aria-label={triggerLabel}
						size="sm"
						variant={isClockedIn ? "destructive" : "default"}
						className={isClockedIn ? "rounded-r-none" : undefined}
					>
						<TimeClockTriggerContent
							elapsedSeconds={elapsedSeconds}
							isClockedIn={isClockedIn}
							isOnBreak={isOnBreak}
							label={triggerLabel}
						/>
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-72" align="end">
					<div className="flex flex-col gap-3">
						<TimeClockPopoverPanel
							controller={controller}
							timeFormat={timeFormat}
						/>
					</div>
				</PopoverContent>
			</Popover>
			{/* No other break runs while a break is in progress (#861). */}
			{isClockedIn && !isOnBreak ? (
				<QuickBreakPopover
					onAddBreak={handleAddBreak}
					isAddingBreak={isAddingBreak}
					isDisabled={isMutating}
					t={t}
					buttonClassName="-ml-2 h-8 rounded-l-none border-l-0 px-2.5"
					iconOnly
				>
					<BreakVehicleReading
						state={vehicleUse}
						disabled={isAddingBreak}
						t={t}
					/>
				</QuickBreakPopover>
			) : null}
		</div>
	);
}

function ClockActionButtons({
	captureMode,
	onClockIn,
	onClockOut,
	isMutating,
	isClockedIn,
	onClockAction,
	isClockingOut,
	clockOutNeedsTask,
	breakInProgress,
	onStartBreak,
	onResumeBreak,
	isStartingBreak,
	isResumingBreak,
	isOffline,
	t,
}: Pick<
	Parameters<typeof ClockControlsView>[0],
	| "captureMode"
	| "onClockIn"
	| "onClockOut"
	| "isMutating"
	| "isClockedIn"
	| "onClockAction"
	| "isClockingOut"
	| "clockOutNeedsTask"
	| "breakInProgress"
	| "onStartBreak"
	| "onResumeBreak"
	| "isStartingBreak"
	| "isResumingBreak"
	| "isOffline"
	| "t"
>) {
	return (
		<ClockCaptureControls
			mode={captureMode}
			onClockIn={onClockIn}
			onClockOut={onClockOut}
			disabled={isMutating}
		>
			{/* Resume, or end the day at the break's start (#888). */}
			{breakInProgress ? (
				<OnBreakActions
					onResume={onResumeBreak}
					onEndDay={onClockOut}
					disabled={isMutating}
					resumeDisabled={isOffline}
					endDayDisabled={clockOutNeedsTask}
					isResuming={isResumingBreak}
					isEndingDay={isClockingOut}
					t={t}
				/>
			) : (
				<ClockAndBreakButtons
					isMutating={isMutating}
					isClockedIn={isClockedIn}
					onClockAction={onClockAction}
					isClockingOut={isClockingOut}
					clockOutNeedsTask={clockOutNeedsTask}
					onStartBreak={onStartBreak}
					isStartingBreak={isStartingBreak}
					isResumingBreak={isResumingBreak}
					isOffline={isOffline}
					t={t}
				/>
			)}
		</ClockCaptureControls>
	);
}

/** Clock In or Clock Out, and Start Break while working. */
function ClockAndBreakButtons({
	isMutating,
	isClockedIn,
	onClockAction,
	isClockingOut,
	clockOutNeedsTask,
	onStartBreak,
	isStartingBreak,
	isResumingBreak,
	isOffline,
	t,
}: Pick<
	Parameters<typeof ClockControlsView>[0],
	| "isMutating"
	| "isClockedIn"
	| "onClockAction"
	| "isClockingOut"
	| "clockOutNeedsTask"
	| "onStartBreak"
	| "isStartingBreak"
	| "isResumingBreak"
	| "isOffline"
	| "t"
>) {
	// The clock button's own progress; a break command shows its own.
	const isClocking = isMutating && !isStartingBreak && !isResumingBreak;
	return (
		<div className="flex flex-col gap-2">
			<Button
				size="default"
				variant={isClockedIn ? "destructive" : "default"}
				onClick={onClockAction}
				disabled={isMutating || clockOutNeedsTask}
				className="w-full"
			>
				<ClockButtonLabel
					isClocking={isClocking}
					isClockingOut={isClockingOut}
					isClockedIn={isClockedIn}
					t={t}
				/>
			</Button>
			{isClockedIn ? (
				<StartBreakButton
					onClick={onStartBreak}
					disabled={isMutating || isOffline}
					pending={isStartingBreak}
					t={t}
				/>
			) : null}
		</div>
	);
}

function ClockButtonLabel({
	isClocking,
	isClockingOut,
	isClockedIn,
	t,
}: {
	isClocking: boolean;
	isClockingOut: boolean;
	isClockedIn: boolean;
	t: Translate;
}) {
	if (isClocking) {
		return (
			<>
				<IconLoader2 className="size-4 animate-spin" />
				{isClockingOut
					? t("timeTracking.clockingOut", "Clocking Out…")
					: t("timeTracking.clockingIn", "Clocking In…")}
			</>
		);
	}
	if (isClockedIn) {
		return (
			<>
				<IconPlayerStop aria-hidden="true" className="size-4" />
				{t("timeTracking.clockOut", "Clock Out")}
			</>
		);
	}
	return (
		<>
			<IconPlayerPlay aria-hidden="true" className="size-4" />
			{t("timeTracking.clockIn", "Clock In")}
		</>
	);
}