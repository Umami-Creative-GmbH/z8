"use client";

import { useEffect, useState } from "react";
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
	const [isMounted, setIsMounted] = useState(false);

	useEffect(() => {
		setIsMounted(true);
	}, []);

	if (!value) {
		return <>{emptyLabel}</>;
	}

	const date = typeof value === "string" ? new Date(value) : value;

	if (Number.isNaN(date.getTime())) {
		return <>{emptyLabel}</>;
	}

	const formattedValue = isMounted ? formatBrowserDateTime(date, locale) : formatServerDateTime(date, locale);

	return (
		<span suppressHydrationWarning>{formattedValue}</span>
	);
}

function formatBrowserDateTime(date: Date, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function formatServerDateTime(date: Date, locale: string) {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date);
}
