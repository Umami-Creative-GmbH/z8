"use client";

import { IconAlertTriangle, IconCircleCheck, IconHistory } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useDisplayContext } from "@/hooks/use-display-context";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import type { ManualConfirmation } from "@/lib/implementation-checklist/confirmation/freshness";
import { cn } from "@/lib/utils";

/** Whether a stored confirmation no longer counts and should be confirmed again. */
export function manualConfirmationLapsed(confirmation: ManualConfirmation | null | undefined) {
	return confirmation?.freshness === "stale" || confirmation?.freshness === "unchecked";
}

/**
 * When a manual confirmation was made and whether it still vouches for the
 * settings it covers (#1516).
 */
export function ManualConfirmationNote({ confirmation }: { confirmation: ManualConfirmation }) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	if (!confirmation.confirmedAt) return null;

	const date = formatInstant(parseInstant(confirmation.confirmedAt), displayContext, "dateMedium");
	const lapsed = manualConfirmationLapsed(confirmation);
	const Icon = lapsed
		? IconAlertTriangle
		: confirmation.freshness === "before-change-tracking"
			? IconHistory
			: IconCircleCheck;

	return (
		<p
			className={cn(
				"flex items-center gap-2 text-sm",
				lapsed ? "font-medium text-destructive" : "text-muted-foreground",
			)}
		>
			<Icon aria-hidden="true" className="size-4 shrink-0" />
			<span>{confirmationText(confirmation, date, t)}</span>
		</p>
	);
}

function confirmationText(
	confirmation: ManualConfirmation,
	date: string,
	t: ReturnType<typeof useTranslate>["t"],
) {
	switch (confirmation.freshness) {
		case "current":
			return t("settings.implementationChecklist.confirmation.current", "Confirmed {date}", {
				date,
			});
		case "before-change-tracking":
			return t(
				"settings.implementationChecklist.confirmation.beforeChangeTracking",
				"Confirmed {date}, before change tracking",
				{ date },
			);
		case "stale":
			return t(
				"settings.implementationChecklist.confirmation.stale",
				"Settings changed since confirmed on {date}",
				{ date },
			);
		case "unchecked":
			return t(
				"settings.implementationChecklist.confirmation.unchecked",
				"Couldn't check for settings changes since confirmed on {date}",
				{ date },
			);
	}
}
