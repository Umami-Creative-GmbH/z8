"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

export function PlatformAnalyticsHeading() {
	const { t } = useTranslate();
	return (
		<PageHeader
			title={t("admin:admin.analytics.title", "Platform Analytics")}
			description={t(
				"admin:admin.analytics.description",
				"Monitor platform growth, engagement, operational activity, and billing trends.",
			)}
		/>
	);
}
