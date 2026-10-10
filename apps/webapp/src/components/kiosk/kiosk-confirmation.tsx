"use client";

import { IconCircleCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface KioskConfirmationProps {
	name: string;
	action: string;
	time: string;
	note: string | null;
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
	returnsInMs,
	onHome,
}: KioskConfirmationProps) {
	const { t } = useTranslate();
	const [secondsLeft, setSecondsLeft] = useState(Math.ceil(returnsInMs / 1000));

	useEffect(() => {
		const timer = window.setInterval(
			() => setSecondsLeft((seconds) => Math.max(0, seconds - 1)),
			1000,
		);
		return () => window.clearInterval(timer);
	}, []);

	return (
		// The whole screen is a tap target; the button is its accessible equivalent.
		// biome-ignore lint/a11y/noStaticElementInteractions: the Done button offers the same action
		// biome-ignore lint/a11y/useKeyWithClickEvents: the Done button offers the same action
		<div className="flex flex-1 cursor-pointer flex-col" onClick={onHome}>
			<output
				aria-label={t("timeTracking.kiosk.done.title", "Done")}
				className="m-auto flex max-w-xl flex-col items-center gap-5 text-center"
			>
				<IconCircleCheck
					className="size-24 text-emerald-600 dark:text-emerald-400"
					aria-hidden="true"
				/>
				<span className="text-3xl font-semibold break-words">{name}</span>
				<span className="text-2xl">{action}</span>
				<span className="text-5xl font-semibold tabular-nums">{time}</span>
				{note ? <span className="text-lg text-muted-foreground">{note}</span> : null}
				<Button size="lg" className="mt-4 h-16 min-w-48 text-xl" onClick={onHome}>
					{t("timeTracking.kiosk.done.button", "Done")}
				</Button>
				<span className="text-muted-foreground">
					{t("timeTracking.kiosk.done.returning", "Back to the start in {seconds} s", {
						seconds: secondsLeft,
					})}
				</span>
			</output>
		</div>
	);
}
