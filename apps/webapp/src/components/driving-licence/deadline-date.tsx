"use client";
import { useTolgee, useTranslate } from "@tolgee/react";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";

/** A date-only driving limit in its saved deadline zone, never the viewer's zone. */
export function DrivingDeadlineDate({
	validThrough,
	timezone,
}: {
	validThrough: string;
	timezone: string;
}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	return (
		<time dateTime={validThrough}>
			{t("drivingLicence.checks.deadline", "{date} ({timezone})", {
				date: formatPlainDate(parsePlainDate(validThrough), locale, "dateMedium"),
				timezone,
			})}
		</time>
	);
}
