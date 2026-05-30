"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ServerActionResult } from "@/lib/effect/result";
import { TimezonePicker } from "./timezone-picker";

interface TimezoneSettingsProps {
	currentTimezone?: string;
	onUpdate: (timezone: string) => Promise<ServerActionResult<void>>;
}

export function TimezoneSettings({ currentTimezone = "UTC", onUpdate }: TimezoneSettingsProps) {
	const { t } = useTranslate();
	const [timezone, setTimezone] = useState(currentTimezone);
	const [isLoading, setIsLoading] = useState(false);
	const [currentTime, setCurrentTime] = useState<string | null>(null);

	useEffect(() => {
		setCurrentTime(
			DateTime.now().setZone(timezone).setLocale("en-US").toLocaleString(DateTime.DATETIME_MED),
		);
	}, [timezone]);

	const handleSave = async () => {
		setIsLoading(true);
		const result = await onUpdate(timezone).then(
			(response) => response,
			() => null,
		);

		if (!result) {
			toast.error(t("settings.timezone.updateError", "An error occurred while updating timezone"));
			setIsLoading(false);
			return;
		}

		if (result.success) {
			toast.success(t("settings.timezone.updateSuccess", "Timezone updated successfully"));
		} else {
			toast.error(result.error || t("settings.timezone.updateFailed", "Failed to update timezone"));
		}

		setIsLoading(false);
	};

	const hasChanged = timezone !== currentTimezone;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.timezone.title", "Timezone")}</CardTitle>
				<CardDescription>
					{t(
						"settings.timezone.description",
						"Set your timezone for accurate date and time display across the application",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<TimezonePicker value={timezone} onChange={setTimezone} disabled={isLoading} />
					<p className="text-sm text-muted-foreground">
						{t("settings.timezone.currentTimePrefix", "Current time in {timezone}:", {
							timezone,
						})}
						{currentTime ? ` ${currentTime}` : null}
					</p>
				</div>

				{hasChanged && (
					<Button onClick={handleSave} disabled={isLoading} className="w-full">
						{isLoading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("settings.timezone.save", "Save Timezone")}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
