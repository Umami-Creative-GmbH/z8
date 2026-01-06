"use client";

import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CalendarEvent } from "@/lib/calendar/types";

interface DayDetailsProps {
	selectedDate: Date | null;
	events: CalendarEvent[];
}

export function DayDetails({ selectedDate, events }: DayDetailsProps) {
	const { t } = useTranslate();

	if (!selectedDate) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="text-sm">{t("calendar.dayDetails.title", "Day Details")}</CardTitle>
				</CardHeader>
				<CardContent>
					<p className="text-sm text-muted-foreground">
						{t("calendar.dayDetails.selectDate", "Select a date to view details")}
					</p>
				</CardContent>
			</Card>
		);
	}

	const dateKey = selectedDate.toISOString().split("T")[0];
	const dayEvents = events.filter((event) => event.date.toISOString().split("T")[0] === dateKey);

	const formattedDate = selectedDate.toLocaleDateString("default", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{formattedDate}</CardTitle>
			</CardHeader>
			<CardContent>
				{dayEvents.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("calendar.dayDetails.noEvents", "No events for this day")}
					</p>
				) : (
					<div className="space-y-3">
						{dayEvents.map((event) => (
							<div key={event.id} className="space-y-1">
								<div className="flex items-center gap-2">
									<div className="h-2 w-2 rounded-full" style={{ backgroundColor: event.color }} />
									<span className="text-sm font-medium">{event.title}</span>
									<Badge variant="secondary" className="text-xs">
										{event.type}
									</Badge>
								</div>
								{event.description && (
									<p className="text-xs text-muted-foreground pl-4">{event.description}</p>
								)}
								{event.metadata && Object.keys(event.metadata).length > 0 && (
									<div className="text-xs text-muted-foreground pl-4 space-y-1">
										{event.type === "holiday" && (
											<>
												<div>
													{t("calendar.dayDetails.category", "Category")}:{" "}
													{event.metadata.categoryName}
												</div>
												{event.metadata.blocksTimeEntry && (
													<div className="text-amber-600">
														{t("calendar.dayDetails.blocksTimeEntry", "Time entries blocked")}
													</div>
												)}
												{event.metadata.isRecurring && (
													<div>{t("calendar.dayDetails.recurring", "Recurring holiday")}</div>
												)}
											</>
										)}
										{event.type === "absence" && (
											<>
												<div>
													{t("calendar.dayDetails.employee", "Employee")}:{" "}
													{event.metadata.employeeName}
												</div>
												<div>
													{t("calendar.dayDetails.status", "Status")}:{" "}
													<Badge variant="outline" className="text-xs">
														{event.metadata.status}
													</Badge>
												</div>
											</>
										)}
										{event.type === "work_period" && (
											<>
												<div>
													{t("calendar.dayDetails.employee", "Employee")}:{" "}
													{event.metadata.employeeName}
												</div>
												<div>
													{t("calendar.dayDetails.duration", "Duration")}:{" "}
													{Math.floor(event.metadata.durationMinutes / 60)}h{" "}
													{event.metadata.durationMinutes % 60}m
												</div>
											</>
										)}
									</div>
								)}
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
