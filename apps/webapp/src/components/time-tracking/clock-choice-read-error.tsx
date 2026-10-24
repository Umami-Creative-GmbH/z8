"use client";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
export function ClockChoiceReadError({ label, retry }: { label: string; retry?: () => void }) {
	const { t } = useTranslate();
	return (
		<div role="alert" className="space-y-2 break-words text-sm">
			<p>{t("timeTracking.choices.unavailable", "{choice} unavailable", { choice: label })}</p>
			{retry && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-auto min-h-9 max-w-full whitespace-normal"
					onClick={retry}
				>
					{t("timeTracking.choices.retry", "Retry {choice}", { choice: label })}
				</Button>
			)}
		</div>
	);
}
