"use client";

import { useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TimezonePicker } from "./timezone-picker";

interface TimezoneSettingsProps {
	currentTimezone?: string;
	onUpdate: (timezone: string) => Promise<{ success: boolean; error?: string }>;
}

export function TimezoneSettings({ currentTimezone = "UTC", onUpdate }: TimezoneSettingsProps) {
	const [timezone, setTimezone] = useState(currentTimezone);
	const [isLoading, setIsLoading] = useState(false);

	const handleSave = async () => {
		setIsLoading(true);
		try {
			const result = await onUpdate(timezone);
			if (result.success) {
				toast.success("Timezone updated successfully");
			} else {
				toast.error(result.error || "Failed to update timezone");
			}
		} catch (error) {
			toast.error("An error occurred while updating timezone");
		} finally {
			setIsLoading(false);
		}
	};

	const hasChanged = timezone !== currentTimezone;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Timezone</CardTitle>
				<CardDescription>
					Set your timezone for accurate date and time display across the application
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<TimezonePicker
						value={timezone}
						onChange={setTimezone}
						disabled={isLoading}
					/>
					<p className="text-sm text-muted-foreground">
						Current time in {timezone}:{" "}
						{new Date().toLocaleString("en-US", {
							timeZone: timezone,
							dateStyle: "medium",
							timeStyle: "short",
						})}
					</p>
				</div>

				{hasChanged && (
					<Button onClick={handleSave} disabled={isLoading} className="w-full">
						{isLoading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
						Save Timezone
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
