"use client";

import {
	IconCoffee,
	IconDoorExit,
	IconLoader2,
	IconPlayerPlay,
	IconWifiOff,
} from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { BreakInProgressClientResult } from "@/lib/query/use-time-clock";

/**
 * Start Break, Resume and End Day for the employee's own clock (#888, Time
 * Tracking ADR 0007). A break in progress is server state: both clock surfaces
 * read it, and so do kiosks and the employee's other devices.
 */

type BreakCommands = {
	startBreak: () => Promise<BreakInProgressClientResult>;
	resumeBreak: () => Promise<BreakInProgressClientResult>;
};

/** Toasts a refusal; a lost or unconfirmed answer never reads as success. */
function toastBreakRefusal(
	result: Extract<BreakInProgressClientResult, { success: false }>,
	t: TFnType,
) {
	if (result.uncertain) {
		toast.warning(
			t("timeTracking.breakInProgress.uncertain", "Your break could not be confirmed"),
			{
				description: t(
					"timeTracking.breakInProgress.uncertainDescription",
					"Your clock has been refreshed. Check it before trying again.",
				),
			},
		);
		return;
	}
	switch (result.code) {
		case "connection_required":
			toast.error(
				t(
					"timeTracking.breakInProgress.connectionRequired",
					"Starting or resuming a break needs a connection.",
				),
			);
			return;
		case "pending_clock_actions":
			toast.error(
				t(
					"timeTracking.breakInProgress.pendingClockActions",
					"Saved clock actions are still being sent. Try again once they are synced.",
				),
			);
			return;
	}
	toast.error(
		result.error ||
			t(
				"timeTracking.breakInProgress.errors.refreshed",
				"Your clock changed. It now shows the current state.",
			),
	);
}

/** The clock surfaces' Start Break and Resume, with their feedback. */
export function breakInProgressHandlers(commands: BreakCommands, t: TFnType) {
	return {
		handleStartBreak: async () => {
			const result = await commands.startBreak();
			if (!result.success) return toastBreakRefusal(result, t);
			toast.success(t("timeTracking.breakInProgress.started", "Break started"), {
				description: t(
					"timeTracking.breakInProgress.startedDescription",
					"Resume when you are back, or end your day.",
				),
			});
		},
		handleResumeBreak: async () => {
			const result = await commands.resumeBreak();
			if (!result.success) return toastBreakRefusal(result, t);
			toast.success(t("timeTracking.breakInProgress.resumed", "Work resumed"));
		},
	};
}

export function StartBreakButton({
	onClick,
	disabled,
	pending,
	t,
}: {
	onClick: () => void;
	disabled: boolean;
	pending: boolean;
	t: TFnType;
}) {
	return (
		<Button
			type="button"
			variant="outline"
			onClick={onClick}
			disabled={disabled}
			className="w-full"
		>
			{pending ? (
				<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
			) : (
				<IconCoffee aria-hidden="true" className="size-4" />
			)}
			{t("timeTracking.breakInProgress.start", "Start break")}
		</Button>
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
		<div className="flex gap-2">
			<Button
				type="button"
				size={size}
				onClick={onResume}
				disabled={disabled || resumeDisabled}
				className="min-w-0 basis-3/5"
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
				className="min-w-0 basis-2/5"
			>
				{isEndingDay ? (
					<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
				) : (
					<IconDoorExit aria-hidden="true" className="size-4" />
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
