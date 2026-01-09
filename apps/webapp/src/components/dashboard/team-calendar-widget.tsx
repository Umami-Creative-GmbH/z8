"use client";

import { IconCalendar, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format, isSameDay } from "@/lib/datetime/luxon-utils";
import { pluralize } from "@/lib/utils";
import { getTeamCalendarData } from "./actions";
import { WidgetCard } from "./widget-card";

type AbsenceDay = {
	date: Date;
	employees: Array<{
		id: string;
		name: string;
	}>;
	count: number;
};

type TeamCalendarData = {
	month: number;
	year: number;
	absenceDays: AbsenceDay[];
};

export function TeamCalendarWidget() {
	const [calendarData, setCalendarData] = useState<TeamCalendarData | null>(null);
	const [loading, setLoading] = useState(true);
	const [currentDate, setCurrentDate] = useState(new Date());

	useEffect(() => {
		async function loadData() {
			try {
				setLoading(true);
				const month = currentDate.getMonth() + 1;
				const year = currentDate.getFullYear();
				const result = await getTeamCalendarData(month, year);
				if (result.success && result.data) {
					setCalendarData(result.data);
				}
			} catch {
				toast.error("Failed to load team calendar");
			} finally {
				setLoading(false);
			}
		}
		loadData();
	}, [currentDate]);

	if (!loading && calendarData && calendarData.absenceDays.length === 0) {
		return null;
	}

	const goToPreviousMonth = () => {
		setCurrentDate((prev) => {
			const newDate = new Date(prev);
			newDate.setMonth(prev.getMonth() - 1);
			return newDate;
		});
	};

	const goToNextMonth = () => {
		setCurrentDate((prev) => {
			const newDate = new Date(prev);
			newDate.setMonth(prev.getMonth() + 1);
			return newDate;
		});
	};

	const goToCurrentMonth = () => {
		setCurrentDate(new Date());
	};

	const getAbsenceForDate = (date: Date): AbsenceDay | undefined => {
		return calendarData?.absenceDays.find((absence) => isSameDay(new Date(absence.date), date));
	};

	return (
		<WidgetCard
			title="Team Calendar"
			description={
				calendarData
					? `${calendarData.absenceDays.length} ${pluralize(calendarData.absenceDays.length, "day")} with absences`
					: "Monthly absence overview"
			}
			icon={<IconCalendar className="size-4 text-muted-foreground" />}
			loading={loading}
		>
			{calendarData && (
				<div className="space-y-4">
					{/* Month Navigation */}
					<div className="flex items-center justify-between">
						<Button
							variant="outline"
							size="icon"
							onClick={goToPreviousMonth}
							aria-label="Previous month"
						>
							<IconChevronLeft className="size-4" />
						</Button>
						<div className="flex flex-col items-center">
							<div className="font-semibold">{format(currentDate, "MMMM yyyy")}</div>
							<Button
								variant="ghost"
								size="sm"
								onClick={goToCurrentMonth}
								className="h-auto py-1 text-xs text-muted-foreground"
							>
								Today
							</Button>
						</div>
						<Button variant="outline" size="icon" onClick={goToNextMonth} aria-label="Next month">
							<IconChevronRight className="size-4" />
						</Button>
					</div>

					{/* Calendar with highlighted absence days */}
					<TooltipProvider>
						<Calendar
							mode="single"
							month={currentDate}
							onMonthChange={setCurrentDate}
							className="rounded-md border"
							modifiers={{
								hasAbsences: (date) => !!getAbsenceForDate(date),
							}}
							modifiersClassNames={{
								hasAbsences: "bg-orange-100 dark:bg-orange-900/20 font-bold",
							}}
							components={{
								Day: ({ date, ...props }) => {
									const absence = getAbsenceForDate(date);

									if (absence) {
										return (
											<Tooltip>
												<TooltipTrigger asChild>
													<div className="relative">
														<button {...props} className="relative">
															{format(date, "d")}
															<Badge
																variant="secondary"
																className="absolute -top-1 -right-1 h-4 w-4 p-0 text-xs flex items-center justify-center"
															>
																{absence.count}
															</Badge>
														</button>
													</div>
												</TooltipTrigger>
												<TooltipContent>
													<div className="space-y-1">
														<div className="font-medium">
															{absence.count} team {pluralize(absence.count, "member")} out
														</div>
														<ul className="text-xs space-y-0.5">
															{absence.employees.map((emp) => (
																<li key={emp.id}>{emp.name}</li>
															))}
														</ul>
													</div>
												</TooltipContent>
											</Tooltip>
										);
									}

									return <button {...props}>{format(date, "d")}</button>;
								},
							}}
						/>
					</TooltipProvider>

					{/* Legend */}
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<div className="flex items-center gap-1">
							<div className="size-3 rounded bg-orange-100 dark:bg-orange-900/20" />
							<span>Team absences</span>
						</div>
					</div>
				</div>
			)}
		</WidgetCard>
	);
}
