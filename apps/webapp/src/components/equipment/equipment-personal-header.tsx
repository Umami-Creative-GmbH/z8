"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { PageHeader } from "@/components/ui/page-header";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

export function EquipmentPersonalHeader({
	calendar,
}: {
	calendar?: { today: string; timezone: string };
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<PageHeader
			title={t("settings.equipment.personal.title", "My equipment")}
			description={t(
				"settings.equipment.personal.description",
				"Equipment issued to you, what to return and by when, and every recorded handover.",
			)}
			scope={
				calendar ? (
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
				) : undefined
			}
		/>
	);
}
