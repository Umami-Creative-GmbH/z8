"use client";
import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";
export function TodayTitle() {
	const { t } = useTranslate();
	return <PageHeader title={t("today.briefing.title", "Manager Daily Briefing")} />;
}
