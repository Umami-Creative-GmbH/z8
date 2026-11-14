"use client";

import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { DashboardHeaderCustomize } from "./dashboard-header-customize";

export function DashboardHeading({
	name,
	date,
}: {
	name: string | null;
	date: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<div className="flex flex-wrap items-end justify-between gap-4 px-4 lg:px-6">
			<div className="space-y-2">
				<p className="text-sm text-muted-foreground">
					<time dateTime={date}>
						{Temporal.PlainDate.from(date).toLocaleString(locale, {
							weekday: "long",
							day: "numeric",
							month: "long",
							year: "numeric",
						})}
					</time>
				</p>
				<h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
					{name
						? t("dashboard.refresh.greeting", "Good day, {name}.", {
								name: name.split(" ")[0],
							})
						: t("dashboard.refresh.overview", "Your work at a glance")}
				</h1>
			</div>
			<DashboardHeaderCustomize
				trigger={
					<Button variant="outline" className="gap-2">
						<IconAdjustmentsHorizontal className="size-4" aria-hidden="true" />
						{t("dashboard.customize.trigger", "Customize dashboard")}
					</Button>
				}
			/>
		</div>
	);
}
