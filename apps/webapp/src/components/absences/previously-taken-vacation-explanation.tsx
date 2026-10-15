"use client";
import { useTranslate } from "@tolgee/react";
/** Every vacation surface explains the same historical component of used days. */
export function PreviouslyTakenVacationExplanation({
	days,
	className,
}: {
	days?: number;
	className?: string;
}) {
	const { t } = useTranslate();
	if (!days) return null;
	return (
		<p className={className ?? "text-xs text-muted-foreground"}>
			{t(
				"common:vacationBalance.previouslyTaken",
				"Includes {days} days previously taken before tracking",
				{ days },
			)}
		</p>
	);
}
