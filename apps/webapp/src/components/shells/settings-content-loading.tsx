"use client";

import { useTranslate } from "@tolgee/react";

import { Skeleton } from "@/components/ui/skeleton";

/**
 * The settings content fallback. It uses the settings page frame and measure,
 * with a PageHeader-sized heading, so the title and first section do not move
 * when the page arrives. `variant="section"` stands in for a configuration page
 * with one main block instead of the settings card grid.
 */
export function SettingsContentLoading({
	variant = "grid",
}: {
	variant?: "grid" | "section";
} = {}) {
	const { t } = useTranslate();

	return (
		<div
			aria-busy="true"
			aria-label={t("common:loading.settings", "Loading settings")}
			className="page-frame flex-1"
			role="status"
		>
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-56 max-w-full sm:h-9" />
					<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
				</div>
				{variant === "section" ? (
					<Skeleton aria-hidden="true" className="h-64 w-full rounded-xl" />
				) : (
					<div className="grid gap-4 md:grid-cols-2">
						<Skeleton aria-hidden="true" className="h-32 w-full rounded-xl" />
						<Skeleton aria-hidden="true" className="h-32 w-full rounded-xl" />
						<Skeleton aria-hidden="true" className="h-32 w-full rounded-xl" />
					</div>
				)}
			</div>
		</div>
	);
}
