"use client";

import { IconCake, IconLoader2, IconConfetti } from "@tabler/icons-react";
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

	// Auto-hide when no upcoming birthdays
	if (!loading && birthdays.length === 0) {
		return null;
	}

	if (loading) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconCake className="size-5" />
						Upcoming Birthdays
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
				<div>
					<CardTitle className="flex items-center gap-2">
						<IconCake className="size-5" />
						Upcoming Birthdays
					</CardTitle>
					<CardDescription>
						{birthdays.length} birthday{birthdays.length !== 1 ? "s" : ""} in
						the next 30 days
					</CardDescription>
				</div>
			</CardHeader>
			<CardContent>
				<div className="space-y-3">
					{birthdays.slice(0, 5).map((birthday) => {
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
								className="flex items-center gap-3 rounded-lg border p-3"
							>
								<Avatar className="size-10">
									<AvatarFallback>{initials}</AvatarFallback>
								</Avatar>
								<div className="flex-1">
									<div className="font-medium">{name}</div>
									<div className="text-xs text-muted-foreground">
										{format(new Date(birthday.nextBirthday), "MMMM d")}
									</div>
								</div>
								{birthday.daysUntil === 0 ? (
									<Badge className="ml-2 bg-gradient-to-r from-pink-500 to-purple-500">
										<IconConfetti className="mr-1 size-3" />
										Today!
									</Badge>
								) : birthday.daysUntil === 1 ? (
									<Badge variant="secondary" className="ml-2">
										Tomorrow
									</Badge>
								) : (
									<span className="ml-2 text-xs text-muted-foreground">
										in {birthday.daysUntil} days
									</span>
								)}
							</div>
						);
					})}

					{birthdays.length > 5 && (
						<div className="text-xs text-center text-muted-foreground">
							and {birthdays.length - 5} more...
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
