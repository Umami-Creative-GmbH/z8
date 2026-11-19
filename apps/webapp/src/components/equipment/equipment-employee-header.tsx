"use client";

import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { FormerEmployeeBadge } from "@/components/former-employees/former-employee-ui";
import { PageHeader } from "@/components/ui/page-header";
import { parsePlainDate } from "@/lib/datetime/temporal-core";

/** Identity and calendar come only from this employee's independently authorized read. */
export function EquipmentEmployeeHeader({
	name,
	former,
	calendar,
	description,
	actions,
}: {
	name?: string;
	former?: boolean;
	calendar?: { today: string; timezone: string };
	description?: ReactNode;
	actions?: ReactNode;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<PageHeader
			className="min-w-0 flex-1"
			title={
				<span className="flex flex-wrap items-center gap-2">
					{name || t("settings.equipment.employee.title", "Employee equipment")}
					{former ? <FormerEmployeeBadge /> : null}
				</span>
			}
			scope={
				calendar ? (
					<div className="flex flex-wrap gap-x-3 gap-y-1">
						<span>
							{t(
								"settings.equipment.employee.scope",
								"Authorized equipment for this employee",
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
			description={description}
			actions={actions}
		/>
	);
}
