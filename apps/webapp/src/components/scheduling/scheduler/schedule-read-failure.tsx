"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";

/** Data stays with its query owner; failure never turns an unloaded day into a free day. */
export function ScheduleReadFailure({
	children,
	onRetry,
	pending,
}: {
	children: React.ReactNode;
	onRetry: () => void;
	pending: boolean;
}) {
	const { t } = useTranslate();
	return (
		<div
			role="alert"
			className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3 text-sm"
		>
			<p>{children}</p>
			<Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={pending}>
				{t("scheduling:scheduling.scheduler.retry", "Retry")}
			</Button>
		</div>
	);
}
