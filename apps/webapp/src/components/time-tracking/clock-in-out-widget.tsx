"use client";

import {
	ComplianceAlertBanner,
	RestPeriodBlocker,
} from "@/components/compliance/compliance-alert-banner";
import { ExceptionRequestDialog } from "@/components/compliance/exception-request-dialog";
import { DrivingAuthorizationAdvisory } from "@/components/driving-licence/operational-status";
import { ClockCaptureControls } from "@/components/offline/offline-capture-actions";
import {
	BreakConnectionNote,
	OnBreakActions,
	StartBreakButton,
} from "@/components/time-tracking/break-in-progress-actions";
import { BreakInProgressNotice } from "@/components/time-tracking/break-in-progress-notice";
import { ClockConnectionNotice } from "@/components/time-tracking/clock-connection-notice";
import {
	ActiveSessionSummary,
	ClockActionButton,
	PostClockOutNotesForm,
	RestPeriodWarnBanner,
	WorkLocationSelector,
} from "@/components/time-tracking/clock-in-out-widget-parts";
import {
	BreakVehicleReading,
	ClockInVehicleUse,
	ClockOutVehicleUse,
} from "@/components/time-tracking/clock-vehicle-use";
import { QuickBreakPopover } from "@/components/time-tracking/quick-break-popover";
import { SessionReminderPanel } from "@/components/time-tracking/session-reminder-panel";
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { TimeFormat } from "@/lib/user-preferences/time-format";

interface ActiveWorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
	breakStartedAt?: Date | null;
	breakStartedZone?: string | null;
}

interface Props {
	activeWorkPeriod: ActiveWorkPeriodData | null;
	employeeName: string;
	timeFormat: TimeFormat;
}

function ClockComplianceNotices({
	widget,
}: {
	widget: ReturnType<typeof useClockInOutWidget>;
}) {
	if (widget.isClockedIn) {
		return widget.alerts.length > 0 ? (
			<ComplianceAlertBanner
				alerts={widget.alerts}
				onRequestException={widget.handleRequestException}
				compact
			/>
		) : null;
	}
	if (widget.canClockIn || !widget.minutesUntilAllowed) return null;
	if (widget.restPeriodEnforcement === "block" && widget.nextAllowedClockIn) {
		return (
			<RestPeriodBlocker
				minutesUntilAllowed={widget.minutesUntilAllowed}
				nextAllowedClockIn={widget.nextAllowedClockIn}
				onRequestException={() => widget.handleRequestException("rest_period")}
				hasApprovedExceptions={widget.approvedExceptions.length > 0}
			/>
		);
	}
	return widget.restPeriodEnforcement === "warn" ? (
		<RestPeriodWarnBanner t={widget.t} />
	) : null;
}

type ClockWidget = ReturnType<typeof useClockInOutWidget>;

function isOnBreak(widget: ClockWidget) {
	return widget.isClockedIn && !!widget.activeWorkPeriod?.breakStartedAt;
}

function ClockWidgetDescription({
	widget,
	employeeName,
}: {
	widget: ClockWidget;
	employeeName: string;
}) {
	if (isOnBreak(widget)) {
		return widget.t(
			"timeTracking.breakInProgress.description",
			"You're on a break",
		);
	}
	if (widget.isClockedIn) {
		return widget.t(
			"timeTracking.currentlyClockedIn",
			"You're currently clocked in",
		);
	}
	return widget.t("timeTracking.welcomeBack", "Welcome back, {name}", {
		name: employeeName,
	});
}

function ClockSessionStatus({
	widget,
	timeFormat,
}: {
	widget: ClockWidget;
	timeFormat: TimeFormat;
}) {
	const activeWorkPeriod = widget.isClockedIn ? widget.activeWorkPeriod : null;
	const breakStartedAt = activeWorkPeriod?.breakStartedAt;

	return (
		<>
			{activeWorkPeriod ? (
				<ActiveSessionSummary
					elapsedSeconds={widget.elapsedSeconds}
					startTime={activeWorkPeriod.startTime}
					t={widget.t}
					timeFormat={timeFormat}
				/>
			) : null}
			{breakStartedAt ? (
				<BreakInProgressNotice
					since={breakStartedAt}
					zone={activeWorkPeriod?.breakStartedZone ?? null}
					timeFormat={timeFormat}
				/>
			) : null}
		</>
	);
}

function ClockBookingChoices({ widget }: { widget: ClockWidget }) {
	const showsNotes = widget.uiState.showNotesInput;
	const asksVehicleUse = !showsNotes && widget.captureMode !== "local-review";
	const VehicleUse = widget.isClockedIn
		? ClockOutVehicleUse
		: ClockInVehicleUse;

	return (
		<>
			{(widget.captureMode !== "server" || !widget.isClockedIn) &&
			!showsNotes ? (
				<WorkLocationSelector
					value={widget.uiState.workLocationType}
					onChange={widget.setWorkLocationType}
					t={widget.t}
				/>
			) : null}

			{/* Vehicle use per the employee's mode (#1122); the legacy review queue keeps none. */}
			{asksVehicleUse ? (
				<VehicleUse
					state={widget.vehicleUse}
					disabled={widget.isMutating}
					t={widget.t}
				/>
			) : null}
		</>
	);
}

function ClockActionRow({ widget }: { widget: ClockWidget }) {
	const { isClockedIn } = widget;

	// A break in progress ends by its resume, here or anywhere else, or by ending
	// the day at its start (#888); no other break runs meanwhile.
	if (isOnBreak(widget)) {
		return (
			<OnBreakActions
				onResume={() => void widget.handleResumeBreak()}
				onEndDay={() => void widget.handleClockOut()}
				disabled={widget.isMutating}
				resumeDisabled={widget.isOffline}
				isResuming={widget.isResumingBreak}
				isEndingDay={widget.isClockingOut}
				size="lg"
				t={widget.t}
			/>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-2">
				<div className={isClockedIn ? "min-w-0 basis-2/3" : "w-full"}>
					<ClockActionButton
						isClockedIn={isClockedIn}
						isMutating={widget.isMutating}
						isClockingOut={widget.isClockingOut}
						onClick={isClockedIn ? widget.handleClockOut : widget.handleClockIn}
						t={widget.t}
					/>
				</div>
				{isClockedIn ? (
					<QuickBreakPopover
						onAddBreak={widget.handleAddBreak}
						isAddingBreak={widget.isAddingBreak}
						isDisabled={widget.isMutating}
						t={widget.t}
						buttonClassName="min-w-0 basis-1/3 px-3"
					>
						<BreakVehicleReading
							state={widget.vehicleUse}
							disabled={widget.isAddingBreak}
							t={widget.t}
						/>
					</QuickBreakPopover>
				) : null}
			</div>
			{isClockedIn ? (
				<StartBreakButton
					onClick={() => void widget.handleStartBreak()}
					disabled={widget.isMutating || widget.isOffline}
					pending={widget.isStartingBreak}
					t={widget.t}
				/>
			) : null}
		</div>
	);
}

function ClockWidgetControls({ widget }: { widget: ClockWidget }) {
	return (
		<ClockCaptureControls
			mode={widget.captureMode}
			onClockIn={widget.handleClockIn}
			onClockOut={widget.handleClockOut}
			disabled={widget.isMutating}
		>
			{!widget.uiState.showNotesInput ? (
				<ClockActionRow widget={widget} />
			) : (
				<PostClockOutNotesForm
					notes={widget.uiState.notesText}
					onChange={widget.setNotesText}
					onSave={widget.handleSaveNotes}
					onSkip={widget.handleDismissNotes}
					isSaving={widget.isUpdatingNotes}
					t={widget.t}
				/>
			)}
		</ClockCaptureControls>
	);
}

function ClockTimezoneMismatchPrompt({ widget }: { widget: ClockWidget }) {
	if (!widget.timezoneMismatch) return null;

	return (
		<TimezoneMismatchDialog
			open
			savedTimezone={widget.timezoneMismatch.savedTimezone}
			browserTimezone={widget.timezoneMismatch.browserTimezone}
			isPending={widget.isTimezoneContinuationPending}
			onUpdateAndContinue={widget.handleTimezoneMismatchUpdateAndContinue}
			onContinueOnce={widget.handleTimezoneMismatchContinueOnce}
			onCancel={widget.handleTimezoneMismatchCancel}
		/>
	);
}

export function ClockInOutWidget({
	activeWorkPeriod,
	employeeName,
	timeFormat,
}: Props) {
	const widget = useClockInOutWidget(activeWorkPeriod);

	return (
		<Card className="@container/widget">
			<CardHeader>
				<CardTitle>{widget.t("timeTracking.title", "Time Tracking")}</CardTitle>
				<CardDescription>
					<ClockWidgetDescription widget={widget} employeeName={employeeName} />
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<ClockSessionStatus widget={widget} timeFormat={timeFormat} />

				<ClockComplianceNotices widget={widget} />

				<SessionReminderPanel
					isClockedIn={widget.isClockedIn}
					sessionStartTime={widget.activeWorkPeriod?.startTime ?? null}
				/>

				<ClockBookingChoices widget={widget} />

				<DrivingAuthorizationAdvisory />
				<ClockConnectionNotice show={widget.connectionRequired} />

				<ClockWidgetControls widget={widget} />
				<BreakConnectionNote show={widget.isOffline && widget.isClockedIn} t={widget.t} />
			</CardContent>

			<ExceptionRequestDialog
				open={widget.uiState.exceptionDialogOpen}
				onOpenChange={widget.setExceptionDialogOpen}
				defaultExceptionType={widget.uiState.exceptionType}
			/>
			<ClockTimezoneMismatchPrompt widget={widget} />
		</Card>
	);
}
