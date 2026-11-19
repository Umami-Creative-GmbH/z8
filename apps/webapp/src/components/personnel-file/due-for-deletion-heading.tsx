"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";

/** Safe title while the route's independent access check is pending. */
export function DueForDeletionHeading() {
	const { t } = useTranslate();
	return <PageHeader title={t("settings.personnelFiles.due.title", "Due for deletion")} />;
}
