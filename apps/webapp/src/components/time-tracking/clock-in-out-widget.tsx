"use client";

import type { ReactNode } from "react";
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
	WorkLocationField,
} from "@/components/time-tracking/clock-in-out-widget-parts";
import {
	BreakVehicleReading,
	ClockInVehicleUse,
	ClockOutVehicleUse,
} from "@/components/time-tracking/clock-vehicle-use";
import { QuickBreakPopover } from "@/components/time-tracking/quick-break-popover";
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { cn } from "@/lib/utils";

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
	daySummary?: ReactNode;
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

/**
 * The clock's state leads the card; the site header already names the page. A dot marks
 * working (green) and a break (amber) at a glance.
 */
function ClockWidgetHeading({
	widget,
	employeeName,
}: {
	widget: ClockWidget;
	employeeName: string;
}) {
	const { t } = widget;
	if (widget.isClockedIn) {
		const onBreak = isOnBreak(widget);
		return (
			<CardTitle className="flex items-center gap-2 text-base">
				<span
					aria-hidden="true"
					className={cn(
						"size-2.5 shrink-0 rounded-full",
						onBreak
							? "bg-amber-300"
							: "bg-emerald-500 motion-safe:animate-pulse",
					)}
				/>
				{onBreak
					? t("timeTracking.breakInProgress.description", "You're on a break")
					: t("timeTracking.currentlyClockedIn", "You're currently clocked in")}
			</CardTitle>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			<CardTitle className="flex items-center gap-2 text-base">
				<span
					aria-hidden="true"
					className="size-2 shrink-0 rounded-full bg-muted-foreground"
				/>
				{t("timeTracking.clockStatus.clockedOut", "Not clocked in")}
			</CardTitle>
			<p className="text-sm text-muted-foreground">{employeeName}</p>
		</div>
	);
}

/** Today's total beside the live session: both answer "how long", so they share one row. */
function ClockSessionStatus({
	widget,
	timeFormat,
	daySummary,
}: {
	widget: ClockWidget;
	timeFormat: TimeFormat;
	daySummary?: ReactNode;
}) {
	const activeWorkPeriod = widget.isClockedIn ? widget.activeWorkPeriod : null;
	const breakStartedAt = activeWorkPeriod?.breakStartedAt;

	return (
		<>
			<div className="flex flex-wrap items-start gap-x-12 gap-y-4 empty:hidden">
				{daySummary}
				{activeWorkPeriod ? (
					<ActiveSessionSummary
						elapsedSeconds={widget.elapsedSeconds}
						startTime={activeWorkPeriod.startTime}
						t={widget.t}
						timeFormat={timeFormat}
					/>
				) : null}
			</div>
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
				<WorkLocationField
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

	// Clock Out beside the icon-only quick break for a break already taken; below
	// them, Start break across the whole card, so its label always fits.
	return (
		<div className="flex flex-col gap-2">
			<div className="flex gap-2">
				<div className="min-w-0 flex-1">
					<ClockActionButton
						isClockedIn={isClockedIn}
						isMutating={widget.isMutating}
						isClockingOut={widget.isClockingOut}
						isClocking={
							widget.isMutating &&
							!widget.isStartingBreak &&
							!widget.isAddingBreak
						}
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
						buttonClassName="shrink-0 px-3"
						iconOnly
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
					size="lg"
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
	daySummary,
}: Props) {
	const widget = useClockInOutWidget(activeWorkPeriod);

	// Wide cards put the state beside the controls, so Clock In stays a button-sized target
	// instead of a bar across the page; narrow cards stack them.
	return (
		<Card className="@container/widget rounded-xl shadow-none">
			<CardContent className="grid gap-6 @3xl/widget:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @3xl/widget:items-center @3xl/widget:gap-x-8">
				<div className="flex min-w-0 flex-col gap-4">
					<ClockWidgetHeading widget={widget} employeeName={employeeName} />
					<ClockSessionStatus
						widget={widget}
						timeFormat={timeFormat}
						daySummary={daySummary}
					/>

					<ClockComplianceNotices widget={widget} />
				</div>

				{/* Its own widget container: the location options size to this column, not the card. */}
				<div className="@container/widget grid min-w-0 gap-4 @3xl/widget:grid-cols-[minmax(0,1fr)_minmax(10rem,14rem)] @3xl/widget:items-end">
					<div className="min-w-0">
						<ClockBookingChoices widget={widget} />
					</div>

					<div className="min-w-0 space-y-3">
						<ClockConnectionNotice show={widget.connectionRequired} />
						<ClockWidgetControls widget={widget} />
						<BreakConnectionNote
							show={widget.isOffline && widget.isClockedIn}
							t={widget.t}
						/>
					</div>
					<div className="col-span-full">
						<DrivingAuthorizationAdvisory />
					</div>
				</div>
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
