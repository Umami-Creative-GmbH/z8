"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "@/navigation";
import {
	useOrganizationDeletedAt,
	useOrganizationSettings,
} from "@/stores/organization-settings-store";

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

	// Warning tokens: the tinted surface and icon carry the attention state, while
	// the copy stays on the foreground token so it keeps body-text contrast in
	// both themes (the warning hue itself is too light for text in dark mode).
	// The Alert's own `[&>svg]:text-current` outranks a class on the icon, so the
	// icon colour is set through the same child selector.
	return (
		<Alert className="rounded-none border-x-0 border-t-0 border-warning/40 bg-warning/10 text-foreground [&>svg]:text-warning">
			<IconAlertTriangle className="size-4" aria-hidden="true" />
			<AlertTitle>
				{t("organization.delete.bannerTitle", "Organization Scheduled for Deletion")}
			</AlertTitle>
			<AlertDescription className="text-foreground">
				{t(
					"organization.delete.bannerDescription",
					"This organization will be permanently deleted in {count, plural, one {# day} other {# days}}. Contact your administrator if you believe this is a mistake.",
					{ count: remainingDays },
				)}{" "}
				<Link
					href="/settings/organization"
					className="rounded-sm font-medium underline underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{t("organization.delete.bannerLearnMore", "Learn more")}
				</Link>
			</AlertDescription>
		</Alert>
	);
}
