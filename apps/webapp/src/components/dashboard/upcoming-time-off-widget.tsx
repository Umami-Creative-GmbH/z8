"use client";

import { IconCalendar, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Link } from "@/navigation";
import { format, differenceInDays } from "@/lib/datetime/luxon-utils";
import { getUpcomingAbsences } from "./actions";

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
	const [absences, setAbsences] = useState<UpcomingAbsence[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadData() {
			try {
				const result = await getUpcomingAbsences(5);
				if (result.success && result.data) {
					setAbsences(result.data);
				}
			} catch (error) {
				toast.error("Failed to load upcoming time off");
			} finally {
				setLoading(false);
			}
		}
		loadData();
	}, []);

	// Auto-hide when no upcoming absences
	if (!loading && absences.length === 0) {
		return null;
	}

	if (loading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconCalendar className="size-5" />
						Upcoming Time Off
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<IconCalendar className="size-5" />
							Upcoming Time Off
						</CardTitle>
						<CardDescription>
							Next {absences.length} upcoming absence
							{absences.length !== 1 ? "s" : ""}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{absences.map((absence) => {
						const daysUntil = differenceInDays(
							new Date(absence.startDate),
							new Date(),
						);
						const duration =
							differenceInDays(
								new Date(absence.endDate),
								new Date(absence.startDate),
							) + 1;

						return (
							<div
								key={absence.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex-1">
									<div className="font-medium">
										{absence.employee.user.name || "Unknown"}
									</div>
									<div className="text-xs text-muted-foreground">
										{format(new Date(absence.startDate), "MMM d")} -{" "}
										{format(new Date(absence.endDate), "MMM d, yyyy")}
										<span className="ml-2">
											({duration} day{duration !== 1 ? "s" : ""})
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
			</CardContent>
		</Card>
	);
}
