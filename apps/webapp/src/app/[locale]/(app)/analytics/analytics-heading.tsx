"use client";

import { useTranslate } from "@tolgee/react";
import type { ComponentProps } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { normalizeAppPath } from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

/** The admitting layout keeps the task title in every arrival state. */
export function AnalyticsHeading(props: ComponentProps<typeof PageHeader>) {
	const pathname = usePathname();
	const { t } = useTranslate();
	if (normalizeAppPath(pathname) === "/analytics/work-hours") {
		return (
			<PageHeader
				{...props}
				scope={props.title}
				title={t("analytics.layout.tabs.workHours", "Work Hours")}
				description={
					props.description
						? t(
								"analytics.workHours.employeeComparison.description",
								"Total hours and variance from expected by employee",
							)
						: undefined
				}
			/>
		);
	}
	if (normalizeAppPath(pathname) === "/analytics/team-performance") {
		return (
			<PageHeader
				{...props}
				scope={props.title}
				title={t("analytics.layout.tabs.teamPerformance", "Team Performance")}
				description={
					props.description
						? t(
								"analytics.teamPerformance.comparison.description",
								"Total work hours by team for the selected period",
							)
						: undefined
				}
			/>
		);
	}
	if (normalizeAppPath(pathname) === "/analytics/vacation-trends") {
		return (
			<PageHeader
				{...props}
				scope={props.title}
				title={t("analytics.layout.tabs.absencesAndVacation", "Absences & Vacation")}
				description={
					props.description
						? t(
								"analytics.vacationTrends.description",
								"Compare vacation usage, employee balances, and absence patterns for the selected organization period.",
							)
						: undefined
				}
			/>
		);
	}
	if (normalizeAppPath(pathname) !== "/analytics/overtime-burn-down") {
		return <PageHeader {...props} />;
	}
	return (
		<PageHeader
			{...props}
			scope={props.title}
			title={t("analytics.overtimeBurnDown.title", "Overtime Burn-Down")}
			description={
				props.description
					? t(
							"analytics.overtimeBurnDown.description",
							"Track weekly overtime reduction across teams.",
						)
					: undefined
			}
		/>
	);
}
