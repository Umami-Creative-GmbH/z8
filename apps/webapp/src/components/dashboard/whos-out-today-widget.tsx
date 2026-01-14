"use client";

import { IconBeach, IconCalendar, IconUsers } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { pluralize } from "@/lib/utils";
import { Link } from "@/navigation";
import { getWhosOutToday } from "./actions";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type AbsentEmployee = {
	id: string;
	userId: string;
	name: string;
	image: string | null;
	category: string;
	categoryColor: string | null;
	endsToday: boolean;
	returnDate: string;
};

type WhosOutData = {
	outToday: AbsentEmployee[];
	returningTomorrow: AbsentEmployee[];
	totalOut: number;
};

export function WhosOutTodayWidget() {
	const { data, loading, refreshing, refetch } = useWidgetData<WhosOutData>(
		() => getWhosOutToday(),
		{
			errorMessage: "Failed to load today's absences",
		},
	);

	// Don't hide if no one is out - that's useful information!
	const isEmpty = !loading && data && data.totalOut === 0;

	return (
		<WidgetCard
			title="Who's Out Today"
			description={
				data
					? data.totalOut === 0
						? "Everyone's in!"
						: `${data.totalOut} team ${pluralize(data.totalOut, "member")} out`
					: "Team availability"
			}
			icon={<IconUsers className="size-4 text-muted-foreground" />}
			loading={loading}
			refreshing={refreshing}
			onRefresh={refetch}
		>
			{data && (
				<div className="space-y-4">
					{isEmpty ? (
						<div className="flex flex-col items-center justify-center py-6 text-center">
							<div className="rounded-full bg-green-100 p-3 dark:bg-green-900/20">
								<IconUsers className="size-6 text-green-600 dark:text-green-400" />
							</div>
							<p className="mt-3 text-sm font-medium">Full team available</p>
							<p className="text-xs text-muted-foreground">No one is out today</p>
						</div>
					) : (
						<>
							{/* Currently Out */}
							{data.outToday.length > 0 && (
								<div className="space-y-2">
									<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
										<IconBeach className="size-3.5" />
										<span>Out Today</span>
									</div>
									<div className="space-y-2">
										{data.outToday.slice(0, 5).map((emp) => (
											<div key={emp.id} className="flex items-center gap-3 rounded-lg border p-2.5">
												<UserAvatar seed={emp.userId} image={emp.image} name={emp.name} size="sm" />
												<div className="flex-1 min-w-0">
													<div className="font-medium text-sm truncate">{emp.name}</div>
													<div className="text-xs text-muted-foreground">
														{emp.endsToday ? "Returns tomorrow" : `Until ${emp.returnDate}`}
													</div>
												</div>
												<Badge
													variant="secondary"
													className="shrink-0 text-xs"
													style={{
														backgroundColor: emp.categoryColor || undefined,
														color: emp.categoryColor ? "#fff" : undefined,
													}}
												>
													{emp.category}
												</Badge>
											</div>
										))}
										{data.outToday.length > 5 && (
											<p className="text-xs text-muted-foreground text-center pt-1">
												+{data.outToday.length - 5} more
											</p>
										)}
									</div>
								</div>
							)}

							{/* Returning Tomorrow */}
							{data.returningTomorrow.length > 0 && (
								<div className="space-y-2">
									<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
										<IconCalendar className="size-3.5" />
										<span>Returning Tomorrow</span>
									</div>
									<div className="flex flex-wrap gap-2">
										{data.returningTomorrow.slice(0, 4).map((emp) => (
											<Badge key={emp.id} variant="outline" className="gap-1.5">
												<span className="size-1.5 rounded-full bg-green-500" />
												{emp.name.split(" ")[0]}
											</Badge>
										))}
										{data.returningTomorrow.length > 4 && (
											<Badge variant="outline">+{data.returningTomorrow.length - 4}</Badge>
										)}
									</div>
								</div>
							)}
						</>
					)}

					<Button className="w-full" variant="outline" size="sm" asChild>
						<Link href="/calendar">
							<IconCalendar className="mr-2 size-4" />
							View Full Calendar
						</Link>
					</Button>
				</div>
			)}
		</WidgetCard>
	);
}
