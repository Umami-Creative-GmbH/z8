"use client";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
export function TravelExpenseLoadError({
	message,
	retry,
	isRetrying,
}: {
	message: string;
	retry: () => void;
	isRetrying: boolean;
}) {
	const { t } = useTranslate();
	return (
		<div
			role="alert"
			className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
		>
			<p className="text-sm">{message}</p>
			<Button variant="outline" onClick={retry} disabled={isRetrying}>
				{t("travelExpenses.actions.retry", "Retry")}
			</Button>
		</div>
	);
}
