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
import { formatKioskDuration, formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import { type KioskAction, kioskActionsFor } from "@/lib/time-tracking/kiosk/kiosk-actions";
import type { KioskEmployeeSnapshot } from "@/lib/time-tracking/kiosk/protocol";

/** What the panel offers: the kiosk's one action union (`kiosk-actions.ts`). */
export type KioskPanelAction = KioskAction;

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

/**
 * What the panel shows: after a live PIN check the state and today's day
 * total; on an offline-mode kiosk without a connection (#1291) the cached
 * state `asOf` the instant the server last told it, and never a day total.
 */
export type KioskPanelSnapshot = Pick<KioskEmployeeSnapshot, "employee" | "state"> &
	(
		| { dayTotal: KioskEmployeeSnapshot["dayTotal"]; asOf?: never }
		| { asOf: string; dayTotal?: never }
	);

interface KioskEmployeePanelProps {
	snapshot: KioskPanelSnapshot;
	zone: string;
	locale: string;
	/** The action being sent, if any. */
	pending: KioskPanelAction | null;
	disabled: boolean;
	error: string | null;
	/** Offline (#1292): that what the employee does is saved on this kiosk, not yet confirmed. */
	notice?: string | null;
	onAction: (action: KioskPanelAction) => void;
	onBack: () => void;
}

/**
 * An employee's turn after a verified PIN (#862): their state and today's day
 * total (or, offline, "as of" when the state was learned, #1291), and only the
 * actions valid for that state. No history, corrections, projects or work
 * categories.
 */
export function KioskEmployeePanel({
	snapshot,
	zone,
	locale,
	pending,
	disabled,
	error,
	notice = null,
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
					{snapshot.asOf !== undefined
						? t("timeTracking.kiosk.employee.asOf", "As of {time}", {
								time: formatKioskTime(snapshot.asOf, zone, locale),
							})
						: t("timeTracking.kiosk.employee.today", "Today: {duration}", {
								duration: formatKioskDuration(snapshot.dayTotal.minutes, locale),
							})}
				</p>
				{notice ? (
					<p className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 text-lg text-amber-900 dark:text-amber-100">
						{notice}
					</p>
				) : null}
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
				{kioskActionsFor(state).map((action, index) => {
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
