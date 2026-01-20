"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useOrganizationDeletedAt, useOrganizationSettings } from "@/stores/organization-settings-store";

/**
 * Banner that displays to all users when their organization is scheduled for deletion.
 * Shows remaining time until permanent deletion.
 */
export function OrganizationDeletionBanner() {
	const { t } = useTranslate();
	const deletedAt = useOrganizationDeletedAt();
	const isHydrated = useOrganizationSettings((state) => state.isHydrated);

	// Don't render if store is not hydrated or organization is not deleted
	if (!isHydrated || !deletedAt) {
		return null;
	}

	// Calculate remaining time until permanent deletion (5 days from deletedAt)
	const permanentDeletionDate = DateTime.fromISO(deletedAt).plus({ days: 5 });
	const remainingDays = Math.max(0, Math.ceil(permanentDeletionDate.diffNow("days").days));

	return (
		<Alert variant="destructive" className="rounded-none border-x-0 border-t-0 bg-amber-50 dark:bg-amber-950/50 border-amber-500/50">
			<IconAlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
			<AlertTitle className="text-amber-800 dark:text-amber-200">
				{t("organization.delete.bannerTitle", "Organization Scheduled for Deletion")}
			</AlertTitle>
			<AlertDescription className="text-amber-700 dark:text-amber-300">
				{t(
					"organization.delete.bannerDescription",
					"This organization will be permanently deleted in {count, plural, one {# day} other {# days}}. Contact your administrator if you believe this is a mistake.",
					{ count: remainingDays }
				)}{" "}
				<Link
					href="/settings/organizations"
					className="font-medium underline underline-offset-4 hover:text-amber-900 dark:hover:text-amber-100"
				>
					{t("organization.delete.bannerLearnMore", "Learn more")}
				</Link>
			</AlertDescription>
		</Alert>
	);
}
