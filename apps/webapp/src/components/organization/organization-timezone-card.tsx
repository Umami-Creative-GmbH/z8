"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateOrganizationTimezone } from "@/app/[locale]/(app)/settings/organizations/actions";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

interface OrganizationTimezoneCardProps {
	organizationId: string;
	timezone: string;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationTimezoneCard({
	organizationId,
	timezone: initialTimezone,
	currentMemberRole,
}: OrganizationTimezoneCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [timezone, setTimezone] = useState(initialTimezone);
	const setOrgSettings = useOrganizationSettings((state) => state.setSettings);

	const canEdit = currentMemberRole === "owner";

	const handleTimezoneChange = async (newTimezone: string) => {
		if (!canEdit) return;

		const previousTimezone = timezone;

		// Optimistic update
		setTimezone(newTimezone);
		setOrgSettings({ timezone: newTimezone });

		const result = await updateOrganizationTimezone(organizationId, newTimezone);

		if (result.success) {
			toast.success(
				t("organization.timezone.updated", "Organization timezone updated to {timezone}", {
					timezone: newTimezone,
				}),
			);
			startTransition(() => {
				router.refresh();
			});
		} else {
			// Revert optimistic update
			setTimezone(previousTimezone);
			setOrgSettings({ timezone: previousTimezone });
			toast.error(
				result.error ||
					t("organization.timezone.update-failed", "Failed to update organization timezone"),
			);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.timezone.title", "Timezone")}</CardTitle>
				<CardDescription>
					{t(
						"organization.timezone.description",
						"Set the default timezone for your organization. This is used for absence tracking, reports, and other date-based features. Individual users can override this in their profile settings.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="timezone-picker">
							{t("organization.timezone.default", "Default Timezone")}
						</Label>
						{isPending && <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
					</div>
					<TimezonePicker
						value={timezone}
						onChange={handleTimezoneChange}
						disabled={!canEdit || isPending}
					/>
				</div>

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{t(
							"organization.timezone.owner-only",
							"Only organization owners can change the timezone setting.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
