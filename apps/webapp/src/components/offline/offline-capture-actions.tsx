"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Both endpoints stay available without inventing an active server period. */
export function ClockCaptureControls({
	mode,
	onClockIn,
	onClockOut,
	disabled,
	children,
}: {
	mode: "local-review" | "server";
	children: ReactNode;
	onClockIn: () => Promise<void>;
	onClockOut: () => Promise<void>;
	disabled: boolean;
}) {
	const { t } = useTranslate();
	if (mode !== "local-review") return children;
	return (
		<div className="space-y-3">
			<p className="text-sm text-muted-foreground">
				{t(
					"common:offline.capture.description",
					"Save the event on this device for review. Server clock status will not change.",
				)}
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					disabled={disabled}
					onClick={() => void onClockIn()}
				>
					{t("common:offline.capture.start", "Save clock-in for review")}
				</Button>
				<Button
					variant="outline"
					disabled={disabled}
					onClick={() => void onClockOut()}
				>
					{t("common:offline.capture.end", "Save clock-out for review")}
				</Button>
			</div>
		</div>
	);
}
