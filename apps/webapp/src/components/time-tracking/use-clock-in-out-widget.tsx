"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useReducer } from "react";
import { toast } from "sonner";
import { useComplianceStatus } from "@/hooks/use-compliance-status";
import { type TimeClockState, useElapsedTimer, useTimeClock } from "@/lib/query";

type WorkLocationType = "office" | "home" | "field" | "other";

interface ActiveWorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
}

interface ClockInOutWidgetState {
	workLocationType: WorkLocationType;
	showNotesInput: boolean;
	lastClockOutEntryId: string | null;
	notesText: string;
	exceptionDialogOpen: boolean;
	exceptionType: string;
}

type ClockInOutWidgetAction =
	| { type: "setWorkLocationType"; value: WorkLocationType }
	| { type: "setNotesText"; value: string }
	| { type: "openNotesInput"; entryId: string }
	| { type: "closeNotesInput" }
	| { type: "openExceptionDialog"; exceptionType: string }
	| { type: "setExceptionDialogOpen"; value: boolean };

function getInitialWorkLocationType(): WorkLocationType {
	if (typeof window === "undefined") {
		return "office";
	}

	return (localStorage.getItem("z8-work-location-type") as WorkLocationType) ?? "office";
}

function createInitialWidgetState(): ClockInOutWidgetState {
	return {
		workLocationType: getInitialWorkLocationType(),
		showNotesInput: false,
		lastClockOutEntryId: null,
		notesText: "",
		exceptionDialogOpen: false,
		exceptionType: "rest_period",
	};
}

function clockInOutWidgetReducer(
	state: ClockInOutWidgetState,
	action: ClockInOutWidgetAction,
): ClockInOutWidgetState {
	switch (action.type) {
		case "setWorkLocationType":
			return { ...state, workLocationType: action.value };
		case "setNotesText":
			return { ...state, notesText: action.value };
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
		case "openExceptionDialog":
			return {
				...state,
				exceptionDialogOpen: true,
				exceptionType: action.exceptionType,
			};
		case "setExceptionDialogOpen":
			return { ...state, exceptionDialogOpen: action.value };
	}
}

export function useClockInOutWidget(initialWorkPeriod: ActiveWorkPeriodData | null) {
	const { t } = useTranslate();
	const [uiState, dispatch] = useReducer(
		clockInOutWidgetReducer,
		undefined,
		createInitialWidgetState,
	);

	const initialData: TimeClockState = {
		hasEmployee: true,
		employeeId: null,
		isClockedIn: !!initialWorkPeriod,
		activeWorkPeriod: initialWorkPeriod
			? { id: initialWorkPeriod.id, startTime: initialWorkPeriod.startTime }
			: null,
	};

	const timeClock = useTimeClock({ initialData });
	const elapsedSeconds = useElapsedTimer(timeClock.activeWorkPeriod?.startTime ?? null);

	useEffect(() => {
		localStorage.setItem("z8-work-location-type", uiState.workLocationType);
	}, [uiState.workLocationType]);

	const compliance = useComplianceStatus({
		currentSessionMinutes: Math.floor(elapsedSeconds / 60),
		enabled: true,
		enablePolling: timeClock.isClockedIn,
		pollingInterval: 60000,
	});

	const handleRequestException = (exceptionType = "rest_period") => {
		dispatch({ type: "openExceptionDialog", exceptionType });
	};

	const handleClockIn = async () => {
		if (compliance.restPeriodEnforcement === "block" && !compliance.canClockIn) {
			const exceptionResult = await compliance.checkException("rest_period");
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

		const result = await timeClock.clockIn({ workLocationType: uiState.workLocationType });
		if (result.success) {
			if ("queued" in result && result.queued) {
				toast.info(t("timeTracking.clockInQueued", "Clock-in queued for sync"));
				return;
			}

			toast.success(t("timeTracking.clockInSuccess", "Clocked in successfully"));
			return;
		}

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
	};

	const handleClockOut = async () => {
		const result = await timeClock.clockOut(undefined);
		if (result.success) {
			if ("queued" in result && result.queued) {
				toast.info(t("timeTracking.clockOutQueued", "Clock-out queued for sync"));
				return;
			}

			toast.success(t("timeTracking.clockOutSuccess", "Clocked out successfully"));
			if ("data" in result && result.data) {
				for (const warning of result.data.complianceWarnings ?? []) {
					if (warning.severity === "violation") {
						toast.warning(t("timeTracking.compliance.violation", "Compliance Violation"), {
							description: warning.message,
							duration: 8000,
							icon: <IconAlertTriangle className="size-5 text-orange-500" />,
						});
					} else {
						toast.info(t("timeTracking.compliance.warning", "Compliance Notice"), {
							description: warning.message,
							duration: 6000,
						});
					}
				}

				if (result.data.breakAdjustment) {
					toast.info(
						t("timeTracking.autoAdjusted.toast.title", "Break auto-added for compliance"),
						{
							description: t(
								"timeTracking.autoAdjusted.toast.description",
								"A {breakMinutes}-minute break was added to comply with time regulations.",
								{ breakMinutes: result.data.breakAdjustment.breakMinutes },
							),
							duration: 8000,
						},
					);
				}

				if (result.data.id) {
					dispatch({ type: "openNotesInput", entryId: result.data.id });
				}
			}

			return;
		}

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
	};

	const handleSaveNotes = async () => {
		const trimmedNotes = uiState.notesText.trim();
		if (!uiState.lastClockOutEntryId || !trimmedNotes) {
			dispatch({ type: "closeNotesInput" });
			return;
		}

		const result = await timeClock.updateNotes({
			entryId: uiState.lastClockOutEntryId,
			notes: trimmedNotes,
		});

		if (result.success) {
			toast.success(t("timeTracking.notesSaved", "Notes saved"));
		} else {
			toast.error(result.error || t("timeTracking.errors.notesSaveFailed", "Failed to save notes"));
		}

		dispatch({ type: "closeNotesInput" });
	};

	return {
		t,
		uiState,
		elapsedSeconds,
		...timeClock,
		...compliance,
		handleClockIn,
		handleClockOut,
		handleSaveNotes,
		handleDismissNotes: () => dispatch({ type: "closeNotesInput" }),
		handleRequestException,
		setWorkLocationType: (value: WorkLocationType) =>
			dispatch({ type: "setWorkLocationType", value }),
		setNotesText: (value: string) => dispatch({ type: "setNotesText", value }),
		setExceptionDialogOpen: (value: boolean) => dispatch({ type: "setExceptionDialogOpen", value }),
	};
}
