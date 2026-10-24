"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";

export function WidgetReadError({
	title,
	message,
	retry,
	refreshing,
}: {
	title: string;
	message: string;
	retry: () => unknown;
	refreshing: boolean;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-3">
			<p
				role="alert"
				className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
			>
				{message}
			</p>
			<Button
				variant="outline"
				size="sm"
				onClick={() => {
					void retry();
				}}
				disabled={refreshing}
				aria-label={t("dashboard.widgets.retry", "Retry {widget}", {
					widget: title,
				})}
			>
				{t("common.retry", "Retry")}
			</Button>
		</div>
	);
}
