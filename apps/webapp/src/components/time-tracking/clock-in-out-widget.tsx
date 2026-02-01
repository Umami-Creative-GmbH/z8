"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconClock,
	IconClockPause,
	IconLoader2,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { BreakReminder } from "@/components/time-tracking/break-reminder";
import { WaterReminder } from "@/components/wellness/water-reminder";
import {
	ComplianceAlertBanner,
	RestPeriodBlocker,
} from "@/components/compliance/compliance-alert-banner";
import { ExceptionRequestDialog } from "@/components/compliance/exception-request-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useComplianceStatus } from "@/hooks/use-compliance-status";
import { type TimeClockState, useElapsedTimer, useTimeClock } from "@/lib/query";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";

// Hoist DateTimeFormat to avoid recreation on each render (js-hoist-regexp)
const timeFormatter = new Intl.DateTimeFormat(undefined, {
	hour: "2-digit",
	minute: "2-digit",
});

interface ActiveWorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
}

interface Props {
	activeWorkPeriod: ActiveWorkPeriodData | null;
	employeeName: string;
}

export function ClockInOutWidget({ activeWorkPeriod: initialWorkPeriod, employeeName }: Props) {
	const { t } = useTranslate();

	// Construct initial state from server-rendered props
	const initialData: TimeClockState = {
		hasEmployee: true, // Widget is only rendered for employees
		employeeId: null, // Will be fetched when status updates
		isClockedIn: !!initialWorkPeriod,
		activeWorkPeriod: initialWorkPeriod
			? { id: initialWorkPeriod.id, startTime: initialWorkPeriod.startTime }
			: null,
	};

	const {
		isClockedIn,
		activeWorkPeriod,
		clockIn,
		clockOut,
		updateNotes,
		isClockingOut,
		isUpdatingNotes,
		isMutating,
	} = useTimeClock({ initialData });

	// Separate timer hook to isolate per-second re-renders to this component only
	const elapsedSeconds = useElapsedTimer(activeWorkPeriod?.startTime ?? null);

	// State for showing notes input after clock-out
	const [showNotesInput, setShowNotesInput] = useState(false);
	const [lastClockOutEntryId, setLastClockOutEntryId] = useState<string | null>(null);
	const [notesText, setNotesText] = useState("");

	// Exception request dialog state
	const [exceptionDialogOpen, setExceptionDialogOpen] = useState(false);
	const [exceptionType, setExceptionType] = useState<string>("rest_period");

	// Compliance status (proactive alerts)
	const {
		restPeriodCheck,
		canClockIn,
		restPeriodEnforcement,
		minutesUntilAllowed,
		nextAllowedClockIn,
		alerts,
		hasCriticalAlerts,
		approvedExceptions,
		checkException,
	} = useComplianceStatus({
		currentSessionMinutes: Math.floor(elapsedSeconds / 60),
		enabled: true,
		enablePolling: isClockedIn, // Only poll when clocked in
		pollingInterval: 60000, // Check every minute
	});

	const handleClockIn = async () => {
		// Check for rest period compliance if enforcement is "block"
		if (restPeriodEnforcement === "block" && !canClockIn) {
			// Check if they have an approved exception
			const exceptionResult = await checkException("rest_period");
			if (!exceptionResult.hasException) {
				toast.error(t("timeTracking.errors.restPeriodBlocked", "Rest period not complete"), {
					description: t(
						"timeTracking.errors.restPeriodBlockedDesc",
						"You must complete the required rest period before clocking in. Request an exception if needed.",
					),
				});
				return;
			}
		}

		const result = await clockIn();

		if (result.success) {
			// Check if this was an offline queued request
			if ("queued" in result && result.queued) {
				toast.info(t("timeTracking.clockInQueued", "Clock-in queued for sync"));
			} else {
				toast.success(t("timeTracking.clockInSuccess", "Clocked in successfully"));
			}
		} else {
			const holidayName = "holidayName" in result ? result.holidayName : undefined;
			const errorMessage = holidayName
				? t("timeTracking.errors.holidayBlocked", "Cannot clock in on {holidayName}", {
						holidayName,
					})
				: result.error || t("timeTracking.errors.clockInFailed", "Failed to clock in");

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

	const handleRequestException = (type?: string) => {
		setExceptionType(type || "rest_period");
		setExceptionDialogOpen(true);
	};

	const handleClockOut = async () => {
		const result = await clockOut(undefined);

		if (result.success) {
			// Check if this was an offline queued request
			if ("queued" in result && result.queued) {
				toast.info(t("timeTracking.clockOutQueued", "Clock-out queued for sync"));
				return;
			}

			toast.success(t("timeTracking.clockOutSuccess", "Clocked out successfully"));

			// Only process data-related features if we have data (not queued)
			if ("data" in result && result.data) {
				// Show compliance warnings if any
				const warnings = result.data.complianceWarnings;
				if (warnings && warnings.length > 0) {
					// Show each warning as a separate toast
					for (const warning of warnings) {
						const isViolation = warning.severity === "violation";

						if (isViolation) {
							toast.warning(t("timeTracking.compliance.violation", "Compliance Violation"), {
								description: warning.message,
								duration: 8000, // Show longer for violations
								icon: <IconAlertTriangle className="size-5 text-orange-500" />,
							});
						} else {
							toast.info(t("timeTracking.compliance.warning", "Compliance Notice"), {
								description: warning.message,
								duration: 6000,
							});
						}
					}
				}

				// Show break adjustment notification if a break was auto-added
				const breakAdjustment = result.data.breakAdjustment;
				if (breakAdjustment) {
					toast.info(t("timeTracking.autoAdjusted.toast.title", "Break auto-added for compliance"), {
						description: t(
							"timeTracking.autoAdjusted.toast.description",
							"A {breakMinutes}-minute break was added to comply with time regulations.",
							{ breakMinutes: breakAdjustment.breakMinutes },
						),
						duration: 8000,
					});
				}

				// Show notes input and store the entry ID for patching
				if (result.data.id) {
					setLastClockOutEntryId(result.data.id);
					setShowNotesInput(true);
					setNotesText("");
				}
			}
		} else {
			const holidayName = "holidayName" in result ? result.holidayName : undefined;
			const errorMessage = holidayName
				? t("timeTracking.errors.holidayBlocked", "Cannot clock out on {holidayName}", {
						holidayName,
					})
				: result.error || t("timeTracking.errors.clockOutFailed", "Failed to clock out");

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
		if (!lastClockOutEntryId || !notesText.trim()) {
			setShowNotesInput(false);
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
	};

	const handleDismissNotes = () => {
		setShowNotesInput(false);
		setLastClockOutEntryId(null);
		setNotesText("");
	};

	return (
		<Card className="@container/widget">
			<CardHeader>
				<CardTitle>{t("timeTracking.title", "Time Tracking")}</CardTitle>
				<CardDescription>
					{isClockedIn
						? t("timeTracking.currentlyClockedIn", "You're currently clocked in")
						: t("timeTracking.welcomeBack", "Welcome back, {name}", { name: employeeName })}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{isClockedIn && activeWorkPeriod && (
					<div className="flex flex-col gap-2">
						<div className="font-bold text-3xl tabular-nums">
							{formatDurationWithSeconds(elapsedSeconds)}
						</div>
						<div className="text-muted-foreground text-sm">
							{t("timeTracking.startedAt", "Started at")}{" "}
							{timeFormatter.format(new Date(activeWorkPeriod.startTime))}
						</div>
					</div>
				)}

				{/* Compliance alerts when clocked in */}
				{isClockedIn && alerts.length > 0 && (
					<ComplianceAlertBanner
						alerts={alerts}
						onRequestException={handleRequestException}
						compact
					/>
				)}

				{/* Rest period blocker when not clocked in */}
				{!isClockedIn && !canClockIn && restPeriodEnforcement === "block" && minutesUntilAllowed && nextAllowedClockIn && (
					<RestPeriodBlocker
						minutesUntilAllowed={minutesUntilAllowed}
						nextAllowedClockIn={nextAllowedClockIn}
						onRequestException={() => handleRequestException("rest_period")}
						hasApprovedExceptions={approvedExceptions.length > 0}
					/>
				)}

				{/* Warning banner for rest period (warn mode) */}
				{!isClockedIn && !canClockIn && restPeriodEnforcement === "warn" && minutesUntilAllowed && (
					<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
						<div className="flex items-center gap-2">
							<IconAlertTriangle className="size-4" />
							<span className="font-medium">
								{t("timeTracking.restPeriodWarning", "Rest Period Warning")}
							</span>
						</div>
						<p className="mt-1 text-xs">
							{t(
								"timeTracking.restPeriodWarningMessage",
								"You have not completed the required rest period. Clocking in now will be logged as a violation.",
							)}
						</p>
					</div>
				)}

				{/* Break reminder when clocked in */}
				<BreakReminder
					isClockedIn={isClockedIn}
					sessionStartTime={activeWorkPeriod?.startTime ?? null}
				/>

				{/* Water reminder when clocked in */}
				<WaterReminder
					isClockedIn={isClockedIn}
					sessionStartTime={activeWorkPeriod?.startTime ?? null}
				/>

				{!showNotesInput && (
					<Button
						size="lg"
						variant={isClockedIn ? "destructive" : "default"}
						onClick={isClockedIn ? handleClockOut : handleClockIn}
						disabled={isMutating}
						className="w-full"
					>
						{isMutating ? (
							<>
								<IconLoader2 className="size-5 animate-spin" />
								{isClockingOut
									? t("timeTracking.clockingOut", "Clocking Out…")
									: t("timeTracking.clockingIn", "Clocking In…")}
							</>
						) : isClockedIn ? (
							<>
								<IconClockPause className="size-5" />
								{t("timeTracking.clockOut", "Clock Out")}
							</>
						) : (
							<>
								<IconClock className="size-5" />
								{t("timeTracking.clockIn", "Clock In")}
							</>
						)}
					</Button>
				)}

				{/* Notes input after clock-out */}
				{showNotesInput && (
					<div className="flex flex-col gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200">
						<div className="text-sm text-muted-foreground">
							{t("timeTracking.addNotePrompt", "Add a note about your work (optional)")}
						</div>
						<Textarea
							name="notes"
							autoComplete="off"
							placeholder={t("timeTracking.notesPlaceholder", "What did you work on…")}
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
				)}
			</CardContent>

			{/* Exception request dialog */}
			<ExceptionRequestDialog
				open={exceptionDialogOpen}
				onOpenChange={setExceptionDialogOpen}
				defaultExceptionType={exceptionType}
			/>
		</Card>
	);
}
