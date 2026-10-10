"use client";

import {
	IconArrowLeft,
	IconClockPause,
	IconClockPlay,
	IconLoader2,
	IconLogin2,
	IconLogout2,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ComponentType, SVGProps } from "react";
import { Button } from "@/components/ui/button";
import { formatKioskDuration, formatKioskTime } from "@/lib/kiosk/display";
import type { KioskClockAction, KioskEmployeeSnapshot } from "@/lib/kiosk/protocol";

/** What the panel offers; `end_day` is a clock-out while on a break (it ends at the break's start). */
export type KioskPanelAction =
	| "clock_in"
	| "start_break"
	| "clock_out"
	| "resume_break"
	| "end_day";

export const KIOSK_ACTION_REQUEST: Record<KioskPanelAction, KioskClockAction> = {
	clock_in: "clock_in",
	start_break: "start_break",
	clock_out: "clock_out",
	resume_break: "resume_break",
	end_day: "clock_out",
};

/** Only the actions valid for the employee's state. */
function actionsFor(state: KioskEmployeeSnapshot["state"]): KioskPanelAction[] {
	switch (state.status) {
		case "clocked_out":
			return ["clock_in"];
		case "clocked_in":
			return ["start_break", "clock_out"];
		case "on_break":
			return ["resume_break", "end_day"];
	}
}

const ACTION_ICONS: Record<KioskPanelAction, ComponentType<SVGProps<SVGSVGElement>>> = {
	clock_in: IconLogin2,
	start_break: IconClockPause,
	clock_out: IconLogout2,
	resume_break: IconClockPlay,
	end_day: IconLogout2,
};

export function useKioskActionLabels() {
	const { t } = useTranslate();
	return {
		buttons: {
			clock_in: t("timeTracking.kiosk.action.clockIn", "Clock in"),
			start_break: t("timeTracking.kiosk.action.startBreak", "Start break"),
			clock_out: t("timeTracking.kiosk.action.clockOut", "Clock out"),
			resume_break: t("timeTracking.kiosk.action.resume", "Resume work"),
			end_day: t("timeTracking.kiosk.action.endDay", "End day"),
		} satisfies Record<KioskPanelAction, string>,
		done: {
			clock_in: t("timeTracking.kiosk.done.clockIn", "Clocked in"),
			start_break: t("timeTracking.kiosk.done.startBreak", "Break started"),
			clock_out: t("timeTracking.kiosk.done.clockOut", "Clocked out"),
			resume_break: t("timeTracking.kiosk.done.resume", "Back to work"),
			end_day: t("timeTracking.kiosk.done.endDay", "Day ended"),
		} satisfies Record<KioskPanelAction, string>,
	};
}

interface KioskEmployeePanelProps {
	snapshot: KioskEmployeeSnapshot;
	zone: string;
	locale: string;
	/** The action being sent, if any. */
	pending: KioskPanelAction | null;
	disabled: boolean;
	error: string | null;
	onAction: (action: KioskPanelAction) => void;
	onBack: () => void;
}

/**
 * An employee's turn after a verified PIN (#862): their state and today's day
 * total, and only the actions valid for that state. No history, corrections,
 * projects or work categories.
 */
export function KioskEmployeePanel({
	snapshot,
	zone,
	locale,
	pending,
	disabled,
	error,
	onAction,
	onBack,
}: KioskEmployeePanelProps) {
	const { t } = useTranslate();
	const labels = useKioskActionLabels();
	const { state } = snapshot;

	const stateText =
		state.status === "clocked_out"
			? t("timeTracking.kiosk.state.clockedOut", "Not clocked in")
			: state.status === "clocked_in"
				? t("timeTracking.kiosk.state.clockedIn", "Clocked in since {time}", {
						time: formatKioskTime(state.since, zone, locale),
					})
				: t("timeTracking.kiosk.state.onBreak", "On break since {time}", {
						time: formatKioskTime(state.breakSince, state.breakZone || zone, locale),
					});

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
			<Button
				variant="ghost"
				size="lg"
				className="h-14 self-start text-lg"
				disabled={pending !== null}
				onClick={onBack}
			>
				<IconArrowLeft className="size-6" aria-hidden="true" />
				{t("timeTracking.kiosk.employee.back", "Cancel")}
			</Button>
			<div className="space-y-3 text-center">
				<h1 className="text-3xl font-semibold break-words">{snapshot.employee.name}</h1>
				<p className="text-2xl">{stateText}</p>
				<p className="text-lg text-muted-foreground">
					{t("timeTracking.kiosk.employee.today", "Today: {duration}", {
						duration: formatKioskDuration(snapshot.dayTotal.todayMinutes, locale),
					})}
				</p>
			</div>
			{error ? (
				<p
					role="alert"
					className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-center text-lg text-destructive"
				>
					{error}
				</p>
			) : null}
			<div className="grid gap-4 sm:grid-cols-2">
				{actionsFor(state).map((action, index) => {
					const Icon = ACTION_ICONS[action];
					return (
						<Button
							key={action}
							size="lg"
							variant={index === 0 ? "default" : "outline"}
							className="h-24 text-2xl first:sm:col-span-1 only:sm:col-span-2"
							disabled={disabled || pending !== null}
							onClick={() => onAction(action)}
						>
							{pending === action ? (
								<IconLoader2
									className="size-7 animate-spin motion-reduce:animate-none"
									aria-hidden="true"
								/>
							) : (
								<Icon className="size-7" aria-hidden="true" />
							)}
							{labels.buttons[action]}
						</Button>
					);
				})}
			</div>
			{state.status === "on_break" ? (
				<p className="text-center text-muted-foreground">
					{t(
						"timeTracking.kiosk.employee.endDayHint",
						"Ending the day now ends your work at the start of your break.",
					)}
				</p>
			) : null}
		</div>
	);
}
