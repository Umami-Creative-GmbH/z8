"use client";

import { useLocale } from "next-intl";
import { useSyncExternalStore } from "react";

interface ExportOperationsDateTimeProps {
	value: Date | string | null;
	emptyLabel?: string;
}

export function ExportOperationsDateTime({
	value,
	emptyLabel = "",
}: ExportOperationsDateTimeProps) {
	const locale = useLocale();
	const isMounted = useSyncExternalStore(subscribeToMount, getClientSnapshot, getServerSnapshot);

	if (!value) {
		return <>{emptyLabel}</>;
	}

	const date = typeof value === "string" ? new Date(value) : value;

	if (Number.isNaN(date.getTime())) {
		return <>{emptyLabel}</>;
	}

	const formattedValue = isMounted
		? formatBrowserDateTime(date, locale)
		: formatServerDateTime(date, locale);

	return <span suppressHydrationWarning>{formattedValue}</span>;
}

function formatBrowserDateTime(date: Date, locale: string) {
	return Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function formatServerDateTime(date: Date, locale: string) {
	return Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date);
}

function subscribeToMount(callback: () => void) {
	const timeout = setTimeout(callback, 0);
	return () => clearTimeout(timeout);
}

function getClientSnapshot() {
	return true;
}

function getServerSnapshot() {
	return false;
}
