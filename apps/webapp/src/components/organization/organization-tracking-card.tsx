"use client";

import { useTranslate } from "@tolgee/react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { OrganizationTrackingSettings } from "@/lib/organization/tracking-settings";

export function OrganizationTrackingCard({
	settings,
}: {
	settings: OrganizationTrackingSettings;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("organization.tracking.title", "Time tracking start")}
				</CardTitle>
				<CardDescription>
					{t(
						"organization.tracking.description",
						"This date controls required time and accumulated work balances. Employees’ actual employment dates determine their vacation allowance.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{settings.active && settings.trackingStartDate ? (
					<dl className="space-y-1">
						<dt className="text-sm text-muted-foreground">
							{t(
								"organization.tracking.start-date",
								"Time tracking start date",
							)}
						</dt>
						<dd className="font-medium tabular-nums">
							<time dateTime={settings.trackingStartDate}>
								{settings.trackingStartDate}
							</time>
						</dd>
					</dl>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"organization.tracking.legacy",
							"Your current work-balance calculation is still in use. No time tracking start date has been activated.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
