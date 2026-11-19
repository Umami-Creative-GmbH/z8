"use client";
import { useTranslate } from "@tolgee/react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export function DeveloperAccessLoading() {
	const { t } = useTranslate();
	return (
		<div className="page-frame space-y-6">
			<PageHeader title={t("settings.navigation.developerAccess.title", "Developer Access")} />
			<LoadingRegion
				className="space-y-4"
				label={{ labelKey: "settings.loading", labelDefault: "Loading settings" }}
			>
				<Skeleton aria-hidden="true" className="h-9 w-56 max-w-full" />
				<Skeleton aria-hidden="true" className="h-10 w-full" />
				<Skeleton aria-hidden="true" className="h-48 w-full rounded-xl" />
			</LoadingRegion>
		</div>
	);
}
