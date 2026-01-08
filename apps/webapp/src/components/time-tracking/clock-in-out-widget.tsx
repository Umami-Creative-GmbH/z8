"use client";

import { IconClock, IconClockPause, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { clockIn, clockOut } from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export function ClockInOutWidget({ activeWorkPeriod: initial, employeeName }: Props) {
	const { t } = useTranslate();
	const [activeWorkPeriod, _setActiveWorkPeriod] = useState(initial);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const [loading, setLoading] = useState(false);

	// Real-time elapsed time counter - runs only on client to avoid hydration mismatch
	useEffect(() => {
		if (!activeWorkPeriod) return;

		// Calculate initial elapsed time on client
		const calculateElapsed = () => {
			const start = new Date(activeWorkPeriod.startTime);
			return Math.floor((Date.now() - start.getTime()) / 1000);
		};

		setElapsedSeconds(calculateElapsed());

		const interval = setInterval(() => {
			setElapsedSeconds(calculateElapsed());
		}, 1000);

		return () => clearInterval(interval);
	}, [activeWorkPeriod]);

	const handleClockIn = async () => {
		setLoading(true);
		const result = await clockIn();

		if (result.success) {
			toast.success(t("timeTracking.clockInSuccess", "Clocked in successfully"));
			window.location.reload();
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
			setLoading(false);
		}
	};

	const handleClockOut = async () => {
		setLoading(true);
		const result = await clockOut();

		if (result.success) {
			toast.success(t("timeTracking.clockOutSuccess", "Clocked out successfully"));
			window.location.reload();
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
			setLoading(false);
		}
	};

	const isClockedIn = !!activeWorkPeriod;

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
				{isClockedIn && (
					<div className="flex flex-col gap-2">
						<div className="font-bold text-3xl tabular-nums">{formatDurationWithSeconds(elapsedSeconds)}</div>
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
					disabled={loading}
					className="w-full"
				>
					{loading ? (
						<>
							<IconLoader2 className="size-5 animate-spin" />
							{isClockedIn
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
