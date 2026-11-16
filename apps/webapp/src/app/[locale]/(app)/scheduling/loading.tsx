"use client";

import { useTranslate } from "@tolgee/react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export default function SchedulingPageLoading() {
	const { t } = useTranslate();
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.shiftSchedule",
				labelDefault: "Loading shift schedule",
			}}
			className="@container/main flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6"
		>
			<PageHeader title={t("common.loadingRegions.shiftSchedule", "Loading shift schedule")} />
			<Skeleton aria-hidden="true" className="h-[32rem] w-full" />
		</LoadingRegion>
	);
}
