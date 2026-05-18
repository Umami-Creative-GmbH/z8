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
	normalizeTimeFormat,
	TIME_FORMAT_OPTIONS,
	type TimeFormat,
} from "@/lib/user-preferences/time-format";
import { useRouter } from "@/navigation";

interface TimeFormatSettingsProps {
	currentTimeFormat?: string | null;
	onUpdate: (timeFormat: TimeFormat) => Promise<ServerActionResult<void>>;
}

export function TimeFormatSettings({ currentTimeFormat, onUpdate }: TimeFormatSettingsProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const normalizedCurrent = normalizeTimeFormat(currentTimeFormat);
	const [timeFormat, setTimeFormat] = useState<TimeFormat>(normalizedCurrent);
	const [isLoading, setIsLoading] = useState(false);
	const hasChanged = timeFormat !== normalizedCurrent;

	const handleSave = async () => {
		setIsLoading(true);
		const result = await onUpdate(timeFormat).then(
			(response) => response,
			() => null,
		);

		if (!result) {
			toast.error(
				t("settings.timeFormat.updateError", "An error occurred while updating time format"),
			);
			setIsLoading(false);
			return;
		}

		if (result.success) {
			toast.success(t("settings.timeFormat.updateSuccess", "Time format updated successfully"));
			refresh();
		} else {
			toast.error(
				result.error || t("settings.timeFormat.updateFailed", "Failed to update time format"),
			);
		}

		setIsLoading(false);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.timeFormat.title", "Time Format")}</CardTitle>
				<CardDescription>
					{t("settings.timeFormat.description", "Choose how clock times are shown across the app.")}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="time-format">{t("settings.timeFormat.label", "Time format")}</Label>
					<Select
						value={timeFormat}
						onValueChange={(value) => setTimeFormat(normalizeTimeFormat(value))}
						disabled={isLoading}
					>
						<SelectTrigger id="time-format" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{TIME_FORMAT_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.value === "24h"
										? t("settings.timeFormat.options.24h", "24-hour (08:00)")
										: t("settings.timeFormat.options.12h", "12-hour (8:00 AM)")}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{hasChanged && (
					<Button onClick={handleSave} disabled={isLoading} className="w-full">
						{isLoading && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
						{t("settings.timeFormat.save", "Save Time Format")}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
