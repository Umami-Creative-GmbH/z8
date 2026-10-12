"use client";

import { useTranslate } from "@tolgee/react";
import type { ApiKeyScope, RateLimitWindow } from "@/lib/validations/api-key";

/** Translated key scope labels, one static key per scope so the extractor finds them. */
export function useApiKeyScopeLabels(): Record<ApiKeyScope, string> {
	const { t } = useTranslate();
	return {
		"time-entries:read": t("settings.apiKeys.scopeLabel.timeEntriesRead", "Read time entries"),
		"absences:read": t("settings.apiKeys.scopeLabel.absencesRead", "Read absences"),
		"absences:read-health": t(
			"settings.apiKeys.scopeLabel.absencesReadHealth",
			"Read absence health detail",
		),
		"employees:read": t("settings.apiKeys.scopeLabel.employeesRead", "Read employees"),
		"projects:read": t("settings.apiKeys.scopeLabel.projectsRead", "Read projects"),
		"customers:read": t("settings.apiKeys.scopeLabel.customersRead", "Read customers"),
	};
}

/** Translated rate-limit window labels ("per minute"). */
export function useRateLimitWindowLabels(): Record<RateLimitWindow, string> {
	const { t } = useTranslate();
	return {
		1000: t("settings.apiKeys.form.rateLimitWindowSecond", "per second"),
		60000: t("settings.apiKeys.form.rateLimitWindowMinute", "per minute"),
		3600000: t("settings.apiKeys.form.rateLimitWindowHour", "per hour"),
	};
}
