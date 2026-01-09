"use client";

import { IconCalendar } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { differenceInDays, format } from "@/lib/datetime/luxon-utils";
import { pluralize } from "@/lib/utils";
import { Link } from "@/navigation";
import { getUpcomingAbsences } from "./actions";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type UpcomingAbsence = {
	id: string;
	startDate: Date;
	endDate: Date;
	employee: {
		user: {
			name: string | null;
		};
	};
	category: {
		name: string;
		color: string | null;
	};
};

export function UpcomingTimeOffWidget() {
	const {
		data: absences,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<UpcomingAbsence[]>(() => getUpcomingAbsences(5), {
		errorMessage: "Failed to load upcoming time off",
	});

	if (!loading && (!absences || absences.length === 0)) return null;

	return (
		<WidgetCard
			title="Upcoming Time Off"
			description={
				absences
					? `Next ${absences.length} upcoming ${pluralize(absences.length, "absence")}`
					: "Scheduled team absences"
			}
			icon={<IconCalendar className="size-4 text-muted-foreground" />}
			loading={loading}
			refreshing={refreshing}
			onRefresh={refetch}
		>
			{absences && (
				<div className="space-y-3">
					{absences.map((absence) => {
						const daysUntil = differenceInDays(new Date(absence.startDate), new Date());
						const duration =
							differenceInDays(new Date(absence.endDate), new Date(absence.startDate)) + 1;

						return (
							<div
								key={absence.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex-1">
									<div className="font-medium">{absence.employee.user.name || "Unknown"}</div>
									<div className="text-xs text-muted-foreground">
										{format(new Date(absence.startDate), "MMM d")} -{" "}
										{format(new Date(absence.endDate), "MMM d, yyyy")}
										<span className="ml-2">
											({duration} {pluralize(duration, "day")})
										</span>
									</div>
									{daysUntil >= 0 && (
										<div className="mt-1 text-xs text-muted-foreground">
											{daysUntil === 0
												? "Starts today"
												: daysUntil === 1
													? "Starts tomorrow"
													: `Starts in ${daysUntil} days`}
										</div>
									)}
								</div>
								<Badge
									style={{
										backgroundColor: absence.category.color || undefined,
									}}
									className="ml-3"
								>
									{absence.category.name}
								</Badge>
							</div>
						);
					})}
					<Button className="w-full" variant="outline" asChild>
						<Link href="/calendar">View Full Calendar</Link>
					</Button>
				</div>
			)}
		</WidgetCard>
	);
}
