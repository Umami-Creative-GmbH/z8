"use client";

import { IconClock, IconClockPause, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTimeClock } from "@/lib/query";
import { formatDurationWithSeconds } from "@/lib/time-tracking/time-utils";

export function TimeClockPopover() {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);

	const {
		hasEmployee,
		isClockedIn,
		activeWorkPeriod,
		elapsedSeconds,
		isLoading,
		clockIn,
		clockOut,
		isClockingOut,
		isMutating,
	} = useTimeClock();

	const handleClockIn = async () => {
		const result = await clockIn();

		if (result.success) {
			toast.success(t("timeTracking.clockInSuccess", "Clocked in successfully"));
			setOpen(false);
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
			setOpen(false);
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

	// Don't render if still loading initial state
	if (isLoading) {
		return (
			<Button size="sm" disabled>
				<IconLoader2 className="size-4 animate-spin" />
				<span className="hidden sm:inline">{t("header.clock-in", "Clock In")}</span>
			</Button>
		);
	}

	// Don't render if user doesn't have an employee profile
	if (!hasEmployee) {
		return null;
	}

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button size="sm" variant={isClockedIn ? "destructive" : "default"}>
					{isClockedIn ? <IconClockPause className="size-4" /> : <IconClock className="size-4" />}
					<span className="hidden sm:inline">
						{isClockedIn ? t("header.clock-out", "Clock Out") : t("header.clock-in", "Clock In")}
					</span>
					{isClockedIn && (
						<span className="hidden md:inline text-xs opacity-80">
							{formatDurationWithSeconds(elapsedSeconds)}
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-64" align="end">
				<div className="flex flex-col gap-3">
					<div className="font-medium">
						{isClockedIn
							? t("timeTracking.currentlyClockedIn", "You're currently clocked in")
							: t("timeTracking.readyToClockIn", "Ready to start working?")}
					</div>

					{isClockedIn && activeWorkPeriod && (
						<div className="flex flex-col gap-1">
							<div className="font-bold text-2xl tabular-nums">
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
						size="default"
						variant={isClockedIn ? "destructive" : "default"}
						onClick={isClockedIn ? handleClockOut : handleClockIn}
						disabled={isMutating}
						className="w-full"
					>
						{isMutating ? (
							<>
								<IconLoader2 className="size-4 animate-spin" />
								{isClockingOut
									? t("timeTracking.clockingOut", "Clocking Out...")
									: t("timeTracking.clockingIn", "Clocking In...")}
							</>
						) : isClockedIn ? (
							<>
								<IconClockPause className="size-4" />
								{t("timeTracking.clockOut", "Clock Out")}
							</>
						) : (
							<>
								<IconClock className="size-4" />
								{t("timeTracking.clockIn", "Clock In")}
							</>
						)}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
