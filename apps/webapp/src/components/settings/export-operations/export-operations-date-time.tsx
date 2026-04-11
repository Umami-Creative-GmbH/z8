"use client";

import { useLocale } from "next-intl";

interface ExportOperationsDateTimeProps {
	value: Date | string | null;
	emptyLabel?: string;
}

export function ExportOperationsDateTime({
	value,
	emptyLabel = "",
}: ExportOperationsDateTimeProps) {
	const locale = useLocale();

	if (!value) {
		return <>{emptyLabel}</>;
	}

	const date = typeof value === "string" ? new Date(value) : value;

	if (Number.isNaN(date.getTime())) {
		return <>{emptyLabel}</>;
	}

	return (
		<>
			{new Intl.DateTimeFormat(locale, {
				dateStyle: "medium",
				timeStyle: "short",
			}).format(date)}
		</>
	);
}
