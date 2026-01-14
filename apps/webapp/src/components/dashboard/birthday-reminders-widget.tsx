"use client";

import { IconCake } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { format } from "@/lib/datetime/luxon-utils";
import { pluralize } from "@/lib/utils";
import { getUpcomingBirthdays } from "./actions";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type UpcomingBirthday = {
	id: string;
	userId: string;
	image: string | null;
	user: {
		name: string | null;
	};
	birthday: Date;
	nextBirthday: Date;
	daysUntil: number;
};

function getDaysLabel(days: number): string {
	if (days === 0) return "Today";
	if (days === 1) return "Tomorrow";
	return `${days} days`;
}

export function BirthdayRemindersWidget() {
	const { data: birthdays, loading } = useWidgetData<UpcomingBirthday[]>(
		() => getUpcomingBirthdays(30),
		{ errorMessage: "Failed to load upcoming birthdays" },
	);

	if (!loading && (!birthdays || birthdays.length === 0)) return null;

	const todayBirthdays = birthdays?.filter((b) => b.daysUntil === 0) ?? [];
	const upcomingBirthdays = birthdays?.filter((b) => b.daysUntil > 0).slice(0, 5) ?? [];
	const displayBirthdays = [...todayBirthdays, ...upcomingBirthdays];

	return (
		<WidgetCard
			title="Upcoming Birthdays"
			description={
				birthdays
					? `${birthdays.length} ${pluralize(birthdays.length, "celebration")} in the next 30 days`
					: "Celebrations in the next 30 days"
			}
			icon={<IconCake className="size-4 text-muted-foreground" />}
			loading={loading}
			action={todayBirthdays.length > 0 ? <Badge>{todayBirthdays.length} Today</Badge> : undefined}
		>
			{birthdays && (
				<div className="space-y-2">
					{displayBirthdays.map((birthday) => {
						const name = birthday.user.name || "Unknown";

						return (
							<div
								key={birthday.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex items-center gap-3">
									<UserAvatar seed={birthday.userId} image={birthday.image} name={name} size="sm" />
									<div>
										<div className="font-medium text-sm">{name}</div>
										<div className="text-xs text-muted-foreground">
											{format(new Date(birthday.nextBirthday), "MMMM d")}
										</div>
									</div>
								</div>
								<Badge variant="secondary" className="text-xs">
									{getDaysLabel(birthday.daysUntil)}
								</Badge>
							</div>
						);
					})}

					{birthdays.length > 5 + todayBirthdays.length && (
						<div className="flex items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
							<span>+{birthdays.length - 5 - todayBirthdays.length} more</span>
						</div>
					)}
				</div>
			)}
		</WidgetCard>
	);
}
