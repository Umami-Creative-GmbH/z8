"use client";

import { useTolgee, useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { PersonalDetailsHistory } from "@/lib/organization/personal-details/types";

/** A plain calendar day in the viewer's language. */
export function useFormatDay() {
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	return (day: string) => formatPlainDate(parsePlainDate(day), locale, "dateMedium");
}

/**
 * Every entry of a part's history, latest valid-from first: each value as
 * `describe` words it, an end as "Ended", the one in force and upcoming ones marked.
 */
export function PersonalDetailsHistoryList<Value>({
	history,
	on,
	describe,
}: {
	history: PersonalDetailsHistory<Value>;
	on: string;
	describe: (value: Value) => ReactNode;
}) {
	const { t } = useTranslate();
	const formatDay = useFormatDay();
	if (history.history.length === 0) return null;
	return (
		<div className="space-y-1">
			<h4 className="text-sm font-medium">
				{t("settings.personalDetails.history.title", "History")}
			</h4>
			<ul className="divide-y">
				{history.history.map((entry) => (
					<li
						key={entry.validFrom}
						className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:gap-4"
					>
						<span className="w-32 shrink-0 tabular-nums text-muted-foreground">
							{t("settings.personalDetails.history.from", "From {date}", {
								date: formatDay(entry.validFrom),
							})}
						</span>
						{entry.value !== null ? (
							<span className="min-w-0 flex-1 break-words">{describe(entry.value)}</span>
						) : (
							<span className="flex-1 text-muted-foreground">
								{t("settings.personalDetails.history.ended", "Ended")}
							</span>
						)}
						{history.current?.validFrom === entry.validFrom ? (
							<Badge variant="secondary">
								{t("settings.personalDetails.history.inForce", "In force")}
							</Badge>
						) : entry.validFrom > on ? (
							<Badge variant="outline">
								{t("settings.personalDetails.history.upcoming", "Upcoming")}
							</Badge>
						) : null}
					</li>
				))}
			</ul>
		</div>
	);
}
