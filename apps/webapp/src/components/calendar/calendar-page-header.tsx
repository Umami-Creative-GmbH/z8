"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

export function CalendarPageHeader() {
	const { t } = useTranslate();
	return (
		<PageHeader
			title={t("calendar.title", "Calendar")}
			className="shrink-0"
		/>
	);
}
