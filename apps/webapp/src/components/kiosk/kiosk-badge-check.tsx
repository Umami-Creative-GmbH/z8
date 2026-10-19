"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";

/**
 * A scanned kiosk badge is being checked (#1366). Nothing about anyone shows
 * until Z8 answered; the scan itself records nothing.
 */
export function KioskBadgeCheck() {
	const { t } = useTranslate();
	return (
		<div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 text-center">
			<output aria-live="polite" aria-busy="true" className="flex flex-col items-center gap-5">
				<IconLoader2
					className="size-16 animate-spin text-muted-foreground motion-reduce:animate-none"
					aria-hidden="true"
				/>
				<span className="text-2xl font-semibold">
					{t("timeTracking.kiosk.badge.checking", "Checking your badge…")}
				</span>
			</output>
		</div>
	);
}
