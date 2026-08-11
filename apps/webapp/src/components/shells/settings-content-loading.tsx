"use client";

import { useTranslate } from "@tolgee/react";

import { Skeleton } from "@/components/ui/skeleton";

export function SettingsContentLoading() {
	const { t } = useTranslate();

	return (
		<div
			aria-busy="true"
			aria-label={t("common:loading.settings", "Loading settings")}
			className="space-y-6 p-4 sm:p-6"
			role="status"
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-56 max-w-full" />
				<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			</div>
			<div className="grid gap-4 lg:grid-cols-2">
				<Skeleton aria-hidden="true" className="h-40 w-full" />
				<Skeleton aria-hidden="true" className="h-40 w-full" />
				<Skeleton aria-hidden="true" className="h-40 w-full" />
			</div>
		</div>
	);
}
