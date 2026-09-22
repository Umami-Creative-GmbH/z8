"use client";

import { ManualTimeEntryDialog } from "@/components/time-tracking/manual-time-entry-dialog";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { DisplayContext } from "@/lib/datetime/temporal-format";
import { ClockOutOnBehalfDialog } from "./clock-out-on-behalf-dialog";
import { DeleteWorkPeriodDialog } from "./delete-work-period-dialog";
import { EventDetailsPanel } from "./event-details-panel";
import { SplitWorkPeriodDialog } from "./split-work-period-dialog";
import { WorkPeriodEditDialog } from "./work-period-edit-dialog";

interface ManualEntryDefaults {
	date: string;
	clockInTime: string;
	clockOutTime: string;
}

interface CalendarEventDialogsProps {
	currentEmployeeId?: string;
	selectedEmployeeId: string | null;
	selectedEmployeeName: string | null;
	calendarTimezone: string;
	manualEntryOpen: boolean;
	manualEntryDefaults: ManualEntryDefaults | null;
	onManualEntryOpenChange: (open: boolean) => void;
	onManualEntrySuccess: () => void;
	pendingClockOut: boolean;
	isClockOutPending: boolean;
	onClockOutOpenChange: (open: boolean) => void;
	onConfirmClockOut: () => void;
	selectedEvent: CalendarEvent | null;
	showSplitDialog: boolean;
	showDeleteDialog: boolean;
	displayContext: DisplayContext;
	onCloseDetails: () => void;
	onSplitClick: () => void;
	onDeleteClick: () => void;
	onSplitDialogOpenChange: (open: boolean) => void;
	onDeleteDialogOpenChange: (open: boolean) => void;
	onSplitComplete: () => void;
	onDeleteComplete: () => void;
	onNotesUpdated: () => void;
	onTimesUpdated: () => void;
}

export function CalendarEventDialogs({
	currentEmployeeId,
	selectedEmployeeId,
	selectedEmployeeName,
	calendarTimezone,
	manualEntryOpen,
	manualEntryDefaults,
	onManualEntryOpenChange,
	onManualEntrySuccess,
	pendingClockOut,
	isClockOutPending,
	onClockOutOpenChange,
	onConfirmClockOut,
	selectedEvent,
	showSplitDialog,
	showDeleteDialog,
	displayContext,
	onCloseDetails,
	onSplitClick,
	onDeleteClick,
	onSplitDialogOpenChange,
	onDeleteDialogOpenChange,
	onSplitComplete,
	onDeleteComplete,
	onNotesUpdated,
	onTimesUpdated,
}: CalendarEventDialogsProps) {
	const selectedWorkPeriod = selectedEvent?.type === "work_period" ? selectedEvent : null;

	return (
		<>
			<ManualTimeEntryDialog
				employeeId={selectedEmployeeId ?? currentEmployeeId ?? ""}
				employeeTimezone={calendarTimezone}
				hasManager={false}
				targetEmployeeId={
					selectedEmployeeId && selectedEmployeeId !== currentEmployeeId
						? selectedEmployeeId
						: undefined
				}
				targetEmployeeName={selectedEmployeeName ?? undefined}
				defaultDate={manualEntryDefaults?.date}
				defaultClockInTime={manualEntryDefaults?.clockInTime}
				defaultClockOutTime={manualEntryDefaults?.clockOutTime}
				open={manualEntryOpen}
				onOpenChange={onManualEntryOpenChange}
				hideTrigger
				onSuccess={onManualEntrySuccess}
			/>
			<ClockOutOnBehalfDialog
				open={pendingClockOut}
				isPending={isClockOutPending}
				onOpenChange={onClockOutOpenChange}
				onConfirm={onConfirmClockOut}
			/>
			{selectedEvent && selectedEvent.type !== "work_period" ? (
				<EventDetailsPanel event={selectedEvent} onClose={onCloseDetails} />
			) : null}
			{selectedWorkPeriod ? (
				<WorkPeriodDialogs
					event={selectedWorkPeriod}
					showSplitDialog={showSplitDialog}
					showDeleteDialog={showDeleteDialog}
					displayContext={displayContext}
					onCloseDetails={onCloseDetails}
					onSplitClick={onSplitClick}
					onDeleteClick={onDeleteClick}
					onSplitDialogOpenChange={onSplitDialogOpenChange}
					onDeleteDialogOpenChange={onDeleteDialogOpenChange}
					onSplitComplete={onSplitComplete}
					onDeleteComplete={onDeleteComplete}
					onNotesUpdated={onNotesUpdated}
					onTimesUpdated={onTimesUpdated}
				/>
			) : null}
		</>
	);
}

type WorkPeriodDialogsProps = Pick<
	CalendarEventDialogsProps,
	| "showSplitDialog"
	| "showDeleteDialog"
	| "displayContext"
	| "onCloseDetails"
	| "onSplitClick"
	| "onDeleteClick"
	| "onSplitDialogOpenChange"
	| "onDeleteDialogOpenChange"
	| "onSplitComplete"
	| "onDeleteComplete"
	| "onNotesUpdated"
	| "onTimesUpdated"
> & { event: CalendarEvent };

function WorkPeriodDialogs({
	event,
	showSplitDialog,
	showDeleteDialog,
	displayContext,
	onCloseDetails,
	onSplitClick,
	onDeleteClick,
	onSplitDialogOpenChange,
	onDeleteDialogOpenChange,
	onSplitComplete,
	onDeleteComplete,
	onNotesUpdated,
	onTimesUpdated,
}: WorkPeriodDialogsProps) {
	if (showSplitDialog) {
		return (
			<SplitWorkPeriodDialog
				event={event}
				open
				displayContext={displayContext}
				onOpenChange={onSplitDialogOpenChange}
				onSplitComplete={onSplitComplete}
			/>
		);
	}

	if (showDeleteDialog) {
		return (
			<DeleteWorkPeriodDialog
				event={event}
				open
				displayContext={displayContext}
				onOpenChange={onDeleteDialogOpenChange}
				onDeleteComplete={onDeleteComplete}
			/>
		);
	}

	return (
		<WorkPeriodEditDialog
			event={event}
			open
			onOpenChange={(open) => !open && onCloseDetails()}
			onNotesUpdated={onNotesUpdated}
			onTimesUpdated={onTimesUpdated}
			onSplitClick={onSplitClick}
			onDeleteClick={onDeleteClick}
			displayContext={displayContext}
		/>
	);
}
