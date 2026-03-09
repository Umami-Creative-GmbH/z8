"use client";

import {
	ComplianceAlertBanner,
	RestPeriodBlocker,
} from "@/components/compliance/compliance-alert-banner";
import { ExceptionRequestDialog } from "@/components/compliance/exception-request-dialog";
import { BreakReminder } from "@/components/time-tracking/break-reminder";
import {
	ActiveSessionSummary,
	ClockActionButton,
	PostClockOutNotesForm,
	RestPeriodWarnBanner,
	WorkLocationSelector,
} from "@/components/time-tracking/clock-in-out-widget-parts";
import { useClockInOutWidget } from "@/components/time-tracking/use-clock-in-out-widget";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WaterReminder } from "@/components/wellness/water-reminder";

interface ActiveWorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
}

interface Props {
	activeWorkPeriod: ActiveWorkPeriodData | null;
	employeeName: string;
}

export function ClockInOutWidget({ activeWorkPeriod, employeeName }: Props) {
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

				<BreakReminder
					isClockedIn={widget.isClockedIn}
					sessionStartTime={widget.activeWorkPeriod?.startTime ?? null}
				/>

				<WaterReminder
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
					<ClockActionButton
						isClockedIn={widget.isClockedIn}
						isMutating={widget.isMutating}
						isClockingOut={widget.isClockingOut}
						onClick={widget.isClockedIn ? widget.handleClockOut : widget.handleClockIn}
						t={widget.t}
					/>
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
		</Card>
	);
}
