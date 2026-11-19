"use client";

import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Temporal } from "temporal-polyfill";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
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
		<PageHeader
			scope={
				<time dateTime={date}>
					{Temporal.PlainDate.from(date).toLocaleString(locale, {
						weekday: "long",
						day: "numeric",
						month: "long",
						year: "numeric",
					})}
				</time>
			}
			title={
				name
					? t("dashboard.refresh.greeting", "Good day, {name}.", {
							name: name.split(" ")[0],
						})
					: t("dashboard.refresh.overview", "Your work at a glance")
			}
			actions={
				<DashboardHeaderCustomize
					trigger={
						<Button variant="outline" className="gap-2">
							<IconAdjustmentsHorizontal
								className="size-4"
								aria-hidden="true"
							/>
							{t("dashboard.customize.trigger", "Customize dashboard")}
						</Button>
					}
				/>
			}
		/>
	);
}
