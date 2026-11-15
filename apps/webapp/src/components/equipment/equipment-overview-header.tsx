"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

/** Scope comes from the authorized read, never from the visible list filters. */
export function EquipmentOverviewHeader({
	actions,
	calendar,
}: {
	actions?: ReactNode;
	calendar?: { today: string; timezone: string };
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<PageHeader
			className="px-4 lg:px-6"
			title={t("settings.equipment.title", "Equipment")}
			scope={
				calendar ? (
					<div className="flex flex-wrap gap-x-3 gap-y-1">
						<span>
							{t(
								"settings.equipment.overview.scope",
								"Your authorized equipment records",
							)}
						</span>
						<span className="tabular-nums">
							{t(
								"settings.equipment.overview.asOf",
								"As of {date} ({timezone})",
								{
									date: parsePlainDate(calendar.today).toLocaleString(locale, {
										dateStyle: "medium",
									}),
									timezone: calendar.timezone,
								},
							)}
						</span>
					</div>
				) : undefined
			}
			description={t(
				"settings.equipment.overview.description",
				"Who holds each item, what must come back, and every recorded handover.",
			)}
			actions={actions}
		/>
	);
}
