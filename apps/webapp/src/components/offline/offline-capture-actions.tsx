"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * - `server`: normal controls against the current server status.
 * - `local-queue`: offline, actions are frozen on this device and sent later (#279).
 * - `local-review`: offline, actions are only saved as evidence for review.
 */
export type ClockCaptureMode = "server" | "local-queue" | "local-review";

/** Both endpoints stay available without inventing an active server period. */
export function ClockCaptureControls({
	mode,
	onClockIn,
	onClockOut,
	disabled,
	children,
}: {
	mode: ClockCaptureMode;
	children: ReactNode;
	onClockIn: () => Promise<void>;
	onClockOut: () => Promise<void>;
	disabled: boolean;
}) {
	const { t } = useTranslate();
	if (mode === "server") return children;
	const queued = mode === "local-queue";
	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				{queued
					? t(
							"common:offline.capture.queueDescription",
							"You're offline. Clock actions are saved on this device and sent automatically when you're back online.",
						)
					: t(
							"common:offline.capture.description",
							"Save the event on this device for review. Server clock status will not change.",
						)}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button variant="outline" disabled={disabled} onClick={() => void onClockIn()}>
					{queued
						? t("common:offline.capture.queueStart", "Save clock-in")
						: t("common:offline.capture.start", "Save clock-in for review")}
				</Button>
				<Button variant="outline" disabled={disabled} onClick={() => void onClockOut()}>
					{queued
						? t("common:offline.capture.queueEnd", "Save clock-out")
						: t("common:offline.capture.end", "Save clock-out for review")}
				</Button>
			</div>
		</div>
	);
}
