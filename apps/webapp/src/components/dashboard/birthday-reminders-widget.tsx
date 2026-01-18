"use client";

import { IconCake, IconConfetti, IconGift, IconSparkles } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import { format } from "@/lib/datetime/luxon-utils";
import { cn, pluralize } from "@/lib/utils";
import { getUpcomingBirthdays } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
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

function useDaysLabel() {
	const { t } = useTranslate();
	return (days: number): string => {
		if (days === 0) return t("dashboard.birthday.today", "Today!");
		if (days === 1) return t("dashboard.birthday.tomorrow", "Tomorrow");
		return t("dashboard.birthday.in-days", "In {days} days", { days });
	};
}

function BirthdayCard({ birthday, isToday }: { birthday: UpcomingBirthday; isToday: boolean }) {
	const { t } = useTranslate();
	const getDaysLabel = useDaysLabel();
	const name = birthday.user.name || t("common.unknown", "Unknown");

	return (
		<div
			className={cn(
				"relative flex items-center gap-3 rounded-xl p-3 transition-all",
				isToday
					? "bg-gradient-to-r from-pink-50 via-purple-50 to-indigo-50 dark:from-pink-950/30 dark:via-purple-950/30 dark:to-indigo-950/30 border border-pink-200/50 dark:border-pink-800/30"
					: "border bg-card hover:bg-accent/50",
			)}
		>
			{/* Decorative sparkles for today's birthdays */}
			{isToday && (
				<>
					<div className="absolute -top-1 -right-1">
						<IconSparkles className="size-4 text-amber-400 animate-pulse" />
					</div>
					<div className="absolute -bottom-1 -left-1">
						<IconConfetti className="size-3 text-pink-400" />
					</div>
				</>
			)}

			{/* Avatar with celebration ring for today */}
			<div className={cn("relative", isToday && "ring-2 ring-pink-400 ring-offset-2 rounded-full")}>
				<UserAvatar seed={birthday.userId} image={birthday.image} name={name} size="sm" />
				{isToday && (
					<div className="absolute -bottom-1 -right-1 rounded-full bg-pink-500 p-0.5">
						<IconCake className="size-3 text-white" />
					</div>
				)}
			</div>

			{/* Info */}
			<div className="flex-1 min-w-0">
				<div
					className={cn(
						"font-medium text-sm truncate",
						isToday && "text-pink-700 dark:text-pink-300",
					)}
				>
					{name}
				</div>
				<div className="text-xs text-muted-foreground">
					{format(new Date(birthday.nextBirthday), "MMMM d")}
				</div>
			</div>

			{/* Days badge */}
			<Badge
				variant={isToday ? "default" : "secondary"}
				className={cn(
					"shrink-0 text-xs font-medium",
					isToday && "bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0",
				)}
			>
				{isToday && <IconGift className="mr-1 size-3" />}
				{getDaysLabel(birthday.daysUntil)}
			</Badge>
		</div>
	);
}

function TodaysCelebration({ count }: { count: number }) {
	const { t } = useTranslate();
	return (
		<div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 px-3 py-2 text-white shadow-lg shadow-purple-500/25">
			<div className="flex items-center justify-center rounded-full bg-white/20 p-1.5">
				<IconCake className="size-4" />
			</div>
			<span className="font-medium">
				{t("dashboard.birthday.count-today", "{count} {birthday} today!", { count, birthday: count > 1 ? t("dashboard.birthday.birthdays", "birthdays") : t("dashboard.birthday.birthday", "birthday") })}
			</span>
			<IconSparkles className="ml-auto size-4 animate-pulse" />
		</div>
	);
}

export function BirthdayRemindersWidget() {
	const { t } = useTranslate();
	const { data: birthdays, loading } = useWidgetData<UpcomingBirthday[]>(
		() => getUpcomingBirthdays(30),
		{ errorMessage: t("dashboard.birthday.error", "Failed to load upcoming birthdays") },
	);

	if (!loading && (!birthdays || birthdays.length === 0)) return null;

	const todayBirthdays = birthdays?.filter((b) => b.daysUntil === 0) ?? [];
	const upcomingBirthdays = birthdays?.filter((b) => b.daysUntil > 0).slice(0, 5) ?? [];
	const displayBirthdays = [...todayBirthdays, ...upcomingBirthdays];

	return (
		<DashboardWidget id="birthday-reminders">
			<WidgetCard
				title={t("dashboard.birthday.title", "Upcoming Birthdays")}
				description={
					birthdays
						? t("dashboard.birthday.description-count", "{count} {celebration} in the next 30 days", { count: birthdays.length, celebration: pluralize(birthdays.length, "celebration") })
						: t("dashboard.birthday.description", "Celebrations in the next 30 days")
				}
				icon={<IconCake className="size-4 text-pink-500" />}
				loading={loading}
			>
				{birthdays && (
					<div className="space-y-3">
						{/* Today's celebration banner */}
						{todayBirthdays.length > 0 && <TodaysCelebration count={todayBirthdays.length} />}

						{/* Birthday list */}
						<div className="space-y-2">
							{displayBirthdays.map((birthday) => (
								<BirthdayCard
									key={birthday.id}
									birthday={birthday}
									isToday={birthday.daysUntil === 0}
								/>
							))}
						</div>

						{/* More indicator */}
						{birthdays.length > 5 + todayBirthdays.length && (
							<div className="flex items-center justify-center gap-2 rounded-lg bg-muted/50 py-2 text-xs text-muted-foreground">
								<IconGift className="size-3" />
								<span>{t("dashboard.birthday.more-celebrations", "+{count} more celebrations", { count: birthdays.length - 5 - todayBirthdays.length })}</span>
							</div>
						)}
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
