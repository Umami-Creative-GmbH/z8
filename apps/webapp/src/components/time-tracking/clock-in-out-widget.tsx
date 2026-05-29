"use client";

import {
	ComplianceAlertBanner,
	RestPeriodBlocker,
} from "@/components/compliance/compliance-alert-banner";
import { ExceptionRequestDialog } from "@/components/compliance/exception-request-dialog";
import {
	ActiveSessionSummary,
	ClockActionButton,
	PostClockOutNotesForm,
	RestPeriodWarnBanner,
	WorkLocationSelector,
} from "@/components/time-tracking/clock-in-out-widget-parts";
import { QuickBreakPopover } from "@/components/time-tracking/quick-break-popover";
import { SessionReminderPanel } from "@/components/time-tracking/session-reminder-panel";
import { TimezoneMismatchDialog } from "@/components/time-tracking/timezone-mismatch-dialog";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TimeFormat } from "@/lib/user-preferences/time-format";

interface ActiveWorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
}

interface Props {
	activeWorkPeriod: ActiveWorkPeriodData | null;
	employeeName: string;
	timeFormat: TimeFormat;
}

export function ClockInOutWidget({ activeWorkPeriod, employeeName, timeFormat }: Props) {
	const widget = useClockInOutWidget(activeWorkPeriod);

	return (
		<Card className="@container/widget">
			<CardHeader>
				<CardTitle>{widget.t("timeTracking.title", "Time Tracking")}</CardTitle>
				<CardDescription>
					{widget.isClockedIn
						? widget.t("timeTracking.currentlyClockedIn", "You're currently clocked in")
						: widget.t("timeTracking.welcomeBack", "Welcome back, {name}", {
								name: employeeName,
							})}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{widget.isClockedIn && widget.activeWorkPeriod ? (
					<ActiveSessionSummary
						elapsedSeconds={widget.elapsedSeconds}
						startTime={widget.activeWorkPeriod.startTime}
						t={widget.t}
						timeFormat={timeFormat}
					/>
				) : null}

				{widget.isClockedIn && widget.alerts.length > 0 ? (
					<ComplianceAlertBanner
						alerts={widget.alerts}
						onRequestException={widget.handleRequestException}
						compact
					/>
				) : null}

				{!widget.isClockedIn &&
				!widget.canClockIn &&
				widget.restPeriodEnforcement === "block" &&
				widget.minutesUntilAllowed &&
				widget.nextAllowedClockIn ? (
					<RestPeriodBlocker
						minutesUntilAllowed={widget.minutesUntilAllowed}
						nextAllowedClockIn={widget.nextAllowedClockIn}
						onRequestException={() => widget.handleRequestException("rest_period")}
						hasApprovedExceptions={widget.approvedExceptions.length > 0}
					/>
				) : null}

				{!widget.isClockedIn &&
				!widget.canClockIn &&
				widget.restPeriodEnforcement === "warn" &&
				widget.minutesUntilAllowed ? (
					<RestPeriodWarnBanner t={widget.t} />
				) : null}

				<SessionReminderPanel
					isClockedIn={widget.isClockedIn}
					sessionStartTime={widget.activeWorkPeriod?.startTime ?? null}
				/>

				{!widget.isClockedIn && !widget.uiState.showNotesInput ? (
					<WorkLocationSelector
						value={widget.uiState.workLocationType}
						onChange={widget.setWorkLocationType}
						t={widget.t}
					/>
				) : null}

				{!widget.uiState.showNotesInput ? (
					<div className="flex gap-2">
						<div className={widget.isClockedIn ? "min-w-0 basis-2/3" : "w-full"}>
							<ClockActionButton
								isClockedIn={widget.isClockedIn}
								isMutating={widget.isMutating}
								isClockingOut={widget.isClockingOut}
								onClick={widget.isClockedIn ? widget.handleClockOut : widget.handleClockIn}
								t={widget.t}
							/>
						</div>
						{widget.isClockedIn ? (
							<QuickBreakPopover
								onAddBreak={widget.handleAddBreak}
								isAddingBreak={widget.isAddingBreak}
								isDisabled={widget.isMutating}
								t={widget.t}
								buttonClassName="min-w-0 basis-1/3 px-3"
							/>
						) : null}
					</div>
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
			</CardContent>

			<ExceptionRequestDialog
				open={widget.uiState.exceptionDialogOpen}
				onOpenChange={widget.setExceptionDialogOpen}
				defaultExceptionType={widget.uiState.exceptionType}
			/>
			{widget.timezoneMismatch ? (
				<TimezoneMismatchDialog
					open
					savedTimezone={widget.timezoneMismatch.savedTimezone}
					browserTimezone={widget.timezoneMismatch.browserTimezone}
					isPending={widget.isTimezoneContinuationPending}
					onUpdateAndContinue={widget.handleTimezoneMismatchUpdateAndContinue}
					onContinueOnce={widget.handleTimezoneMismatchContinueOnce}
					onCancel={widget.handleTimezoneMismatchCancel}
				/>
			) : null}
		</Card>
	);
}
