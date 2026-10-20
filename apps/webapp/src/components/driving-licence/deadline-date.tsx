"use client";
import { useTranslate } from "@tolgee/react";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { formatDateOnly } from "@/components/ui/date-picker-utils";

/**
 * The one date-only format of driving licence screens (#1418): the app locale's medium date,
 * as the date picker shows it.
 */
export function useDrivingDateOnly() {
	const locale = useAppLocale();
	return (value: string) => formatDateOnly(value, locale);
}

/** A date-only driving limit in its saved deadline zone, never the viewer's zone. */
export function DrivingDeadlineDate({
	validThrough,
	timezone,
}: {
	validThrough: string;
	timezone: string;
}) {
	const { t } = useTranslate();
	const format = useDrivingDateOnly();
	return (
		<time dateTime={validThrough}>
			{t("drivingLicence.checks.deadline", "{date} ({timezone})", {
				date: format(validThrough),
				timezone,
			})}
		</time>
	);
}
