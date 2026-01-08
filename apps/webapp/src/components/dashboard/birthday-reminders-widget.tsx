"use client";

import { IconCake, IconLoader2, IconConfetti, IconGift, IconSparkles } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { format } from "@/lib/datetime/luxon-utils";
import { cn } from "@/lib/utils";
import { getUpcomingBirthdays } from "./actions";

type UpcomingBirthday = {
	id: string;
	user: {
		name: string | null;
	};
	birthday: Date;
	nextBirthday: Date;
	daysUntil: number;
};

const avatarGradients = [
	"from-pink-500 to-rose-500",
	"from-violet-500 to-purple-500",
	"from-blue-500 to-cyan-500",
	"from-emerald-500 to-teal-500",
	"from-amber-500 to-orange-500",
];

function getAvatarGradient(id: string) {
	const hash = id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
	return avatarGradients[hash % avatarGradients.length];
}

function getDaysLabel(days: number): { text: string; variant: "today" | "tomorrow" | "thisWeek" | "later" } {
	if (days === 0) return { text: "Today!", variant: "today" };
	if (days === 1) return { text: "Tomorrow", variant: "tomorrow" };
	if (days <= 7) return { text: `${days} days`, variant: "thisWeek" };
	return { text: `${days} days`, variant: "later" };
}

export function BirthdayRemindersWidget() {
	const [birthdays, setBirthdays] = useState<UpcomingBirthday[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		async function loadData() {
			try {
				const result = await getUpcomingBirthdays(30);
				if (result.success && result.data) {
					setBirthdays(result.data);
				}
			} catch (error) {
				toast.error("Failed to load upcoming birthdays");
			} finally {
				setLoading(false);
			}
		}
		loadData();
	}, []);

	if (!loading && birthdays.length === 0) {
		return null;
	}

	if (loading) {
		return (
			<Card className="overflow-hidden gap-0 py-0">
				<CardHeader className="bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-violet-500/10 py-4">
					<CardTitle className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-purple-500 text-white">
							<IconCake className="size-4" />
						</div>
						Upcoming Birthdays
					</CardTitle>
					<CardDescription className="mt-1.5">
						Celebrations in the next 30 days
					</CardDescription>
				</CardHeader>
				<CardContent className="py-4">
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</CardContent>
			</Card>
		);
	}

	const todayBirthdays = birthdays.filter((b) => b.daysUntil === 0);
	const upcomingBirthdays = birthdays.filter((b) => b.daysUntil > 0).slice(0, 5);

	return (
		<Card className="overflow-hidden gap-0 py-0">
			<CardHeader className="bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-violet-500/10 py-4">
				<div className="flex items-start justify-between">
					<div>
						<CardTitle className="flex items-center gap-2">
							<div className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-purple-500 text-white">
								<IconCake className="size-4" />
							</div>
							Upcoming Birthdays
						</CardTitle>
						<CardDescription className="mt-1.5">
							{birthdays.length} celebration{birthdays.length !== 1 ? "s" : ""} in the next 30 days
						</CardDescription>
					</div>
					{todayBirthdays.length > 0 && (
						<Badge className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0 animate-pulse">
							<IconSparkles className="mr-1 size-3" />
							{todayBirthdays.length} Today
						</Badge>
					)}
				</div>
			</CardHeader>
			<CardContent className="py-4">
				<div className="space-y-3">
					{/* Today's birthdays - highlighted */}
					{todayBirthdays.map((birthday) => {
						const name = birthday.user.name || "Unknown";
						const initials = name
							.split(" ")
							.map((n) => n[0])
							.join("")
							.toUpperCase()
							.slice(0, 2);

						return (
							<div
								key={birthday.id}
								className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-pink-500/20 via-purple-500/20 to-violet-500/20 p-4 ring-1 ring-pink-500/30"
							>
								<div className="absolute -right-4 -top-4 text-pink-500/10">
									<IconConfetti className="size-24" />
								</div>
								<div className="relative flex items-center gap-4">
									<div className="relative">
										<Avatar className={cn("size-12 ring-2 ring-white shadow-lg bg-gradient-to-br", getAvatarGradient(birthday.id))}>
											<AvatarFallback className="bg-transparent text-white font-semibold">
												{initials}
											</AvatarFallback>
										</Avatar>
										<div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-gradient-to-br from-pink-500 to-purple-500 text-white ring-2 ring-white">
											<IconCake className="size-3" />
										</div>
									</div>
									<div className="flex-1 min-w-0">
										<div className="flex items-center gap-2">
											<span className="font-semibold truncate">{name}</span>
											<IconSparkles className="size-4 text-amber-500 animate-pulse" />
										</div>
										<div className="text-sm text-muted-foreground">
											{format(new Date(birthday.nextBirthday), "MMMM d")}
										</div>
									</div>
									<Badge className="bg-gradient-to-r from-pink-500 to-purple-500 text-white border-0 shadow-lg">
										<IconConfetti className="mr-1 size-3" />
										Today!
									</Badge>
								</div>
							</div>
						);
					})}

					{/* Upcoming birthdays */}
					{upcomingBirthdays.length > 0 && (
						<div className="space-y-1">
							{upcomingBirthdays.map((birthday) => {
								const name = birthday.user.name || "Unknown";
								const initials = name
									.split(" ")
									.map((n) => n[0])
									.join("")
									.toUpperCase()
									.slice(0, 2);
								const { text, variant } = getDaysLabel(birthday.daysUntil);

								return (
									<div
										key={birthday.id}
										className={cn(
											"group flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/50",
											variant === "tomorrow" && "bg-amber-500/5"
										)}
									>
										<Avatar className={cn("size-9 bg-gradient-to-br", getAvatarGradient(birthday.id))}>
											<AvatarFallback className="bg-transparent text-white text-sm font-medium">
												{initials}
											</AvatarFallback>
										</Avatar>
										<div className="flex-1 min-w-0">
											<div className="font-medium truncate text-sm">{name}</div>
											<div className="text-xs text-muted-foreground">
												{format(new Date(birthday.nextBirthday), "MMMM d")}
											</div>
										</div>
										<Badge
											variant={variant === "tomorrow" ? "default" : "secondary"}
											className={cn(
												"text-xs shrink-0",
												variant === "tomorrow" && "bg-amber-500 hover:bg-amber-500/90"
											)}
										>
											{variant === "tomorrow" && <IconGift className="mr-1 size-3" />}
											{text}
										</Badge>
									</div>
								);
							})}
						</div>
					)}

					{/* More indicator */}
					{birthdays.length > 5 + todayBirthdays.length && (
						<div className="flex items-center justify-center gap-2 pt-1 text-xs text-muted-foreground">
							<span>+{birthdays.length - 5 - todayBirthdays.length} more</span>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
