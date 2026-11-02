"use client";

import { IconAlertTriangle, IconCircleCheck, IconCloudUpload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A kiosk confirmation screen's frame: the whole screen is a tap target that
 * returns home, with its content, a Done button as the accessible equivalent,
 * then `footer`. Used after a kiosk action and (#1505) a fob registration.
 */
export function KioskConfirmationShell({
	label,
	onHome,
	children,
	footer = null,
}: {
	label: string;
	onHome: () => void;
	children: ReactNode;
	footer?: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		// The whole screen is a tap target; the button is its accessible equivalent.
		// biome-ignore lint/a11y/noStaticElementInteractions: the Done button offers the same action
		// biome-ignore lint/a11y/useKeyWithClickEvents: the Done button offers the same action
		<div className="flex flex-1 cursor-pointer flex-col" onClick={onHome}>
			<output
				aria-label={label}
				className="m-auto flex max-w-xl flex-col items-center gap-5 text-center"
			>
				{children}
				<Button size="lg" className="mt-4 h-16 min-w-48 text-xl" onClick={onHome}>
					{t("timeTracking.kiosk.done.button", "Done")}
				</Button>
				{footer}
			</output>
		</div>
	);
}

interface KioskConfirmationProps {
	name: string;
	action: string;
	time: string;
	note: string | null;
	/** Something the employee should know went wrong, e.g. vehicle use not recorded (#1123). */
	warning?: string | null;
	/**
	 * Saved on an offline kiosk, not yet confirmed by Z8 (#1292): what to tell the
	 * employee instead of a plain success. The PIN is checked when the kiosk reconnects.
	 */
	unconfirmed?: string | null;
	/** When the kiosk returns home on its own, in milliseconds from now. */
	returnsInMs: number;
	onHome: () => void;
}

/**
 * The confirmation after a kiosk action (#862): the employee's name, the
 * action and its time. Any tap returns home at once; otherwise the kiosk
 * returns on its own after about 10 seconds.
 */
export function KioskConfirmation({
	name,
	action,
	time,
	note,
	warning = null,
	unconfirmed = null,
	returnsInMs,
	onHome,
}: KioskConfirmationProps) {
	const { t } = useTranslate();
	const [secondsLeft, setSecondsLeft] = useState(() => Math.ceil(returnsInMs / 1000));

	// Counted from a deadline, so a throttled timer never lets the countdown drift from the return.
	useEffect(() => {
		const deadline = Date.now() + returnsInMs;
		const timer = window.setInterval(
			() => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
			250,
		);
		return () => window.clearInterval(timer);
	}, [returnsInMs]);

	return (
		<KioskConfirmationShell
			label={t("timeTracking.kiosk.done.title", "Done")}
			onHome={onHome}
			footer={
				<span className="text-muted-foreground">
					{t("timeTracking.kiosk.done.returning", "Back to the start in {seconds} s", {
						seconds: secondsLeft,
					})}
				</span>
			}
		>
			{unconfirmed ? (
				<IconCloudUpload
					className="size-24 text-amber-600 dark:text-amber-400"
					aria-hidden="true"
				/>
			) : (
				<IconCircleCheck
					className="size-24 text-emerald-600 dark:text-emerald-400"
					aria-hidden="true"
				/>
			)}
			<span className="text-3xl font-semibold break-words">{name}</span>
			<span className="text-2xl">{action}</span>
			<span className="text-5xl font-semibold tabular-nums">{time}</span>
			{note ? <span className="text-lg text-muted-foreground">{note}</span> : null}
			{unconfirmed ? (
				<span role="status" className="text-lg text-amber-900 dark:text-amber-200">
					{unconfirmed}
				</span>
			) : null}
			{warning ? (
				<span
					role="status"
					className="flex items-center gap-2 text-lg text-amber-900 dark:text-amber-200"
				>
					<IconAlertTriangle className="size-6 shrink-0" aria-hidden="true" />
					{warning}
				</span>
			) : null}
		</KioskConfirmationShell>
	);
}
