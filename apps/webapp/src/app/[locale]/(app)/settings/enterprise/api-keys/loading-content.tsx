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
			<LoadingRegion label={{ labelKey: "settings.loading", labelDefault: "Loading settings" }}>
				<Skeleton className="h-10 w-full" />
				<Skeleton className="mt-4 h-48 w-full" />
			</LoadingRegion>
		</div>
	);
}
