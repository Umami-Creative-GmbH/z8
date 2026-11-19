"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

export function CalendarPageHeader() {
	const { t } = useTranslate();
	return (
		<PageHeader
			// The navigation's translated name; the page and its menu entry read the same.
			title={t("nav.calendar", "Calendar")}
			className="shrink-0"
		/>
	);
}
