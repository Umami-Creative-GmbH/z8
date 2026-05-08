"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	normalizeWeekStartDay,
	WEEK_START_OPTIONS,
	type WeekStartDay,
} from "@/lib/user-preferences/week-start";
import { useRouter } from "@/navigation";

interface WeekStartSettingsProps {
	currentWeekStartDay?: string | null;
	onUpdate: (weekStartDay: WeekStartDay) => Promise<ServerActionResult<void>>;
}

export function WeekStartSettings({ currentWeekStartDay, onUpdate }: WeekStartSettingsProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const normalizedCurrent = normalizeWeekStartDay(currentWeekStartDay);
	const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(normalizedCurrent);
	const [isLoading, setIsLoading] = useState(false);
	const hasChanged = weekStartDay !== normalizedCurrent;

	const handleSave = async () => {
		setIsLoading(true);
		const result = await onUpdate(weekStartDay).then(
			(response) => response,
			() => null,
		);

		if (!result) {
			toast.error(
				t("settings.weekStart.updateError", "An error occurred while updating week start day"),
			);
			setIsLoading(false);
			return;
		}

		if (result.success) {
			toast.success(t("settings.weekStart.updateSuccess", "Week start day updated successfully"));
			refresh();
		} else {
			toast.error(
				result.error || t("settings.weekStart.updateFailed", "Failed to update week start day"),
			);
		}

		setIsLoading(false);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.weekStart.title", "Week Starts On")}</CardTitle>
				<CardDescription>
					{t(
						"settings.weekStart.description",
						"Choose whether calendars and weekly summaries start on Sunday or Monday.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="week-start-day">
						{t("settings.weekStart.label", "First day of the week")}
					</Label>
					<Select
						value={weekStartDay}
						onValueChange={(value) => setWeekStartDay(normalizeWeekStartDay(value))}
						disabled={isLoading}
					>
						<SelectTrigger id="week-start-day" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{WEEK_START_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.value === "sunday"
										? t("settings.weekStart.options.sunday", "Sunday")
										: t("settings.weekStart.options.monday", "Monday")}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{hasChanged && (
					<Button onClick={handleSave} disabled={isLoading} className="w-full">
						{isLoading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
						{t("settings.weekStart.save", "Save Week Start")}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
