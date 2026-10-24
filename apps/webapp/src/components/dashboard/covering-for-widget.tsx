"use client";

import { IconUserShare } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { DashboardWidgetData, DashboardWidgetSnapshot } from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

function CategoryBadge({
	category,
}: {
	category: DashboardWidgetData["covering-for"]["running"][number]["category"];
}) {
	if (!category) return null;
	return (
		<Badge
			variant="secondary"
			className="shrink-0 text-xs font-medium"
			style={{
				backgroundColor: category.color ? `${category.color}20` : undefined,
				color: category.color || undefined,
				borderColor: category.color ? `${category.color}40` : undefined,
			}}
		>
			{category.name}
		</Badge>
	);
}

/**
 * "Covering for" (#1012): the absences the signed-in employee is deputy on,
 * running now or starting within 14 days. Hidden for nobody's deputy.
 */
export function CoveringForWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData["covering-for"]>;
} = {}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const { data, loading, refreshing, refetch, error, role } = useDashboardWidget(
		"covering-for",
		initialSnapshot,
	);
	const formatDate = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");

	if (!loading && !error && data && data.running.length === 0 && data.upcoming.length === 0) {
		return null;
	}

	return (
		<DashboardWidget id="covering-for">
			<WidgetCard
				title={t("dashboard.covering-for.title", "Covering for")}
				description={t(
					"dashboard.covering-for.description",
					"Colleagues you are the deputy for while they are away",
				)}
				icon={<IconUserShare className="size-4 text-teal-500" aria-hidden="true" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{error ? (
					<WidgetReadError
						title={t("dashboard.covering-for.title", "Covering for")}
						message={error}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : data ? (
					<ul className="space-y-2">
						{data.running.map((duty) => (
							<li
								key={duty.absenceId}
								className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3"
							>
								<span className="text-sm">
									{t("dashboard.covering-for.running", "Covering for {name} until {date}", {
										name: duty.employeeName,
										date: formatDate(duty.endDate),
									})}
								</span>
								<CategoryBadge category={data.viewerRole === role ? duty.category : null} />
							</li>
						))}
						{data.upcoming.map((duty) => (
							<li
								key={duty.absenceId}
								className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-3"
							>
								<span className="text-muted-foreground text-sm">
									{t(
										"dashboard.covering-for.upcoming",
										"Upcoming: covering for {name} from {start} to {end}",
										{
											name: duty.employeeName,
											start: formatDate(duty.startDate),
											end: formatDate(duty.endDate),
										},
									)}
								</span>
								<CategoryBadge category={data.viewerRole === role ? duty.category : null} />
							</li>
						))}
					</ul>
				) : null}
			</WidgetCard>
		</DashboardWidget>
	);
}
