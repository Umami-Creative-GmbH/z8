"use client";

import { IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { CLOCK_CONNECTION_REQUIRED_MESSAGE } from "@/lib/time-tracking/browser-clock-command";

/**
 * The inline outcome of a clock action refused offline in an organization that
 * is not adopted (#845): nothing was saved, so it reads as advice, not an error.
 */
export function ClockConnectionNotice({ show }: { show: boolean }) {
	const { t } = useTranslate();
	if (!show) return null;
	return (
		<p role="alert" className="flex items-start gap-2 text-sm text-muted-foreground">
			<IconWifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>{t(...CLOCK_CONNECTION_REQUIRED_MESSAGE)}</span>
		</p>
	);
}
