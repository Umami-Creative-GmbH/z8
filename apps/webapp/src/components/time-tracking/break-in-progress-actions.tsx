"use client";

import {
	IconLoader2,
	IconPlayerPause,
	IconPlayerPlay,
	IconPlayerStop,
	IconWifiOff,
} from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Start Break, Resume and End Day for the employee's own clock (#888, Time
 * Tracking ADR 0007). A break in progress is server state: both clock surfaces
 * read it, and so do kiosks and the employee's other devices. Their feedback
 * lives in `break-in-progress-handlers`.
 */

export function StartBreakButton({
	onClick,
	disabled,
	pending,
	size = "default",
	t,
}: {
	onClick: () => void;
	disabled: boolean;
	pending: boolean;
	size?: "default" | "lg";
	t: TFnType;
}) {
	return (
		<Button
			type="button"
			variant="outline"
			size={size}
			onClick={onClick}
			disabled={disabled}
			className="w-full"
		>
			{/* A break pauses the work; Resume plays it again and End day stops it. */}
			{pending ? (
				<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
			) : (
				<IconPlayerPause aria-hidden="true" className="size-4" />
			)}
			{t("timeTracking.breakInProgress.start", "Start break")}
		</Button>
	);
}

/** Start Break as an icon in the header clock, beside Clock Out (#1573). */
export function HeaderStartBreakButton({
	onClick,
	disabled,
	pending,
	isOffline,
	className,
	t,
}: {
	onClick: () => void;
	disabled: boolean;
	pending: boolean;
	isOffline: boolean;
	className?: string;
	t: TFnType;
}) {
	const label = t("timeTracking.breakInProgress.start", "Start break");
	return (
		<Tooltip>
			{/* A disabled button takes no hover, so its wrapper still explains why. */}
			<TooltipTrigger asChild>
				<span className={cn("inline-flex", className)} tabIndex={isOffline ? 0 : undefined}>
					<Button
						type="button"
						size="sm"
						onClick={onClick}
						disabled={disabled || isOffline}
						aria-label={label}
						className="h-8 rounded-none bg-amber-200 px-2.5 text-amber-900 hover:bg-amber-300 dark:bg-amber-300/80 dark:text-amber-950 dark:hover:bg-amber-300"
					>
						{pending ? (
							<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
						) : (
							<IconPlayerPause aria-hidden="true" className="size-4" />
						)}
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{isOffline
					? t(
							"timeTracking.breakInProgress.connectionRequired",
							"Starting or resuming a break needs a connection.",
						)
					: label}
			</TooltipContent>
		</Tooltip>
	);
}

/** While on break: resume the work, or end the day at the break's start. */
export function OnBreakActions({
	onResume,
	onEndDay,
	disabled,
	resumeDisabled,
	endDayDisabled,
	isResuming,
	isEndingDay,
	size = "default",
	t,
}: {
	onResume: () => void;
	onEndDay: () => void;
	disabled: boolean;
	/** Resuming needs a connection (#888). */
	resumeDisabled?: boolean;
	/** Ending the day is a clock-out and keeps its own holds, such as a required task. */
	endDayDisabled?: boolean;
	isResuming: boolean;
	isEndingDay: boolean;
	size?: "default" | "lg";
	t: TFnType;
}) {
	return (
		// Side by side where they fit, stacked in a narrow clock; never clipped.
		<div className="flex flex-wrap gap-2">
			<Button
				type="button"
				size={size}
				onClick={onResume}
				disabled={disabled || resumeDisabled}
				className="min-w-0 flex-[3_1_7rem]"
			>
				{isResuming ? (
					<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
				) : (
					<IconPlayerPlay aria-hidden="true" className="size-4" />
				)}
				{t("timeTracking.breakInProgress.resume", "Resume")}
			</Button>
			<Button
				type="button"
				size={size}
				variant="destructive"
				onClick={onEndDay}
				disabled={disabled || endDayDisabled}
				className="min-w-0 flex-[2_1_6rem]"
			>
				{isEndingDay ? (
					<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
				) : (
					<IconPlayerStop aria-hidden="true" className="size-4" />
				)}
				{t("timeTracking.breakInProgress.endDay", "End day")}
			</Button>
		</div>
	);
}

/** Start Break and Resume are online only in this release (#888). */
export function BreakConnectionNote({ show, t }: { show: boolean; t: TFnType }) {
	if (!show) return null;
	return (
		<p className="flex items-start gap-2 text-muted-foreground text-sm">
			<IconWifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			<span>
				{t(
					"timeTracking.breakInProgress.connectionRequired",
					"Starting or resuming a break needs a connection.",
				)}
			</span>
		</p>
	);
}
