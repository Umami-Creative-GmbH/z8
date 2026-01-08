"use client";

import { IconClock, IconClockPause, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type TimeClockState, useTimeClock } from "@/lib/query";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";

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
		isClockedIn: !!initialWorkPeriod,
		activeWorkPeriod: initialWorkPeriod
			? { id: initialWorkPeriod.id, startTime: initialWorkPeriod.startTime }
			: null,
	};

	const {
		isClockedIn,
		activeWorkPeriod,
		elapsedSeconds,
		clockIn,
		clockOut,
		isClockingOut,
		isMutating,
	} = useTimeClock({ initialData });

	const handleClockIn = async () => {
		const result = await clockIn();

		if (result.success) {
			toast.success(t("timeTracking.clockInSuccess", "Clocked in successfully"));
		} else {
			const errorMessage = result.holidayName
				? t("timeTracking.errors.holidayBlocked", "Cannot clock in on {holidayName}", {
						holidayName: result.holidayName,
					})
				: result.error || t("timeTracking.errors.clockInFailed", "Failed to clock in");

			toast.error(errorMessage, {
				description: result.holidayName
					? t(
							"timeTracking.errors.holidayBlockedDesc",
							"This day is marked as a holiday and time entries are not allowed",
						)
					: undefined,
			});
		}
	};

	const handleClockOut = async () => {
		const result = await clockOut();

		if (result.success) {
			toast.success(t("timeTracking.clockOutSuccess", "Clocked out successfully"));
		} else {
			const errorMessage = result.holidayName
				? t("timeTracking.errors.holidayBlocked", "Cannot clock out on {holidayName}", {
						holidayName: result.holidayName,
					})
				: result.error || t("timeTracking.errors.clockOutFailed", "Failed to clock out");

			toast.error(errorMessage, {
				description: result.holidayName
					? t(
							"timeTracking.errors.holidayBlockedDesc",
							"This day is marked as a holiday and time entries are not allowed",
						)
					: undefined,
			});
		}
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
							{new Date(activeWorkPeriod.startTime).toLocaleTimeString("en-US", {
								hour: "2-digit",
								minute: "2-digit",
							})}
						</div>
					</div>
				)}

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
								? t("timeTracking.clockingOut", "Clocking Out...")
								: t("timeTracking.clockingIn", "Clocking In...")}
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
			</CardContent>
		</Card>
	);
}
