"use client";

import {
	IconAlertTriangle,
	IconArrowRight,
	IconCalendarCheck,
	IconChecklist,
	IconClockExclamation,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

type EmployeeRole = "admin" | "manager" | "employee";

const focusItems = [
	{
		icon: IconClockExclamation,
		labelKey: "dashboard.manager-today.missing-clock-ins",
		fallback: "Missing clock-ins",
	},
	{
		icon: IconChecklist,
		labelKey: "dashboard.manager-today.approvals",
		fallback: "Open approvals",
	},
	{
		icon: IconAlertTriangle,
		labelKey: "dashboard.manager-today.payroll-risks",
		fallback: "Coverage, overtime, and payroll risks",
	},
] as const;

export function ManagerTodayWidget() {
	const { t } = useTranslate();
	const currentEmployeeQuery = useQuery({
		queryKey: ["dashboard", "manager-today", "current-employee"],
		queryFn: async () => {
			const current = await getCurrentEmployee();
			return { role: (current?.role ?? null) as EmployeeRole | null };
		},
	});

	const role = currentEmployeeQuery.data?.role ?? null;
	const loading = currentEmployeeQuery.isLoading;

	if (!loading && role !== "admin" && role !== "manager") {
		return null;
	}

	return (
		<DashboardWidget id="manager-today">
			<WidgetCard
				title={t("dashboard.manager-today.title", "Manager Today")}
				description={t(
					"dashboard.manager-today.description",
					"Review today before small issues affect payroll or coverage.",
				)}
				icon={<IconCalendarCheck className="size-4 text-blue-500" aria-hidden="true" />}
				loading={loading}
				action={
					<Button variant="default" size="sm" asChild>
						<Link href="/today">
							{t("dashboard.manager-today.open", "Open Brief")}
							<IconArrowRight className="ml-1 size-3" aria-hidden="true" />
						</Link>
					</Button>
				}
			>
				<div className="space-y-4">
					<p className="text-sm text-muted-foreground">
						{t(
							"dashboard.manager-today.summary",
							"Start with absences, missing punches, approvals, coverage risks, overtime, and other payroll-impacting issues.",
						)}
					</p>

					<div className="grid gap-2">
						{focusItems.map((item) => {
							const Icon = item.icon;

							return (
								<div
									key={item.labelKey}
									className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm"
								>
									<Icon className="size-4 text-blue-500" aria-hidden="true" />
									<span>{t(item.labelKey, item.fallback)}</span>
								</div>
							);
						})}
					</div>
				</div>
			</WidgetCard>
		</DashboardWidget>
	);
}
